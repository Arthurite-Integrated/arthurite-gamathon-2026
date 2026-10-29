import { onGameMessage, sendGameMessage, type GameMessage, type GameTransport, type SyncedState } from './messages';
import { EMPTY_VIEW, canPlay, getRoles, type GameView } from './roles';
import { applyMove, createGame, isFinished } from './xo';

/** How often a player without a state asks for one. */
const SYNC_RETRY_MS = 1000;

/**
 * The game protocol, with no React in it. The backend only relays messages, so this is host-authoritative:
 *
 * - The host (X) owns the truth. It checks every `move`, applies it, raises `seq` by 1 and sends `state`.
 * - The guest (O) never changes its own board. It sends `move` to the host and shows the `state` it gets back.
 * - Every client keeps the state with the highest `seq` it has seen and ignores older or equal ones.
 * - A client with no state asks everyone with `sync`; anyone holding a state answers it.
 *
 * Use `getView`/`subscribe` with useSyncExternalStore (see useGame.ts). Call `attach` once to start listening.
 */
export class GameController {
  private view: GameView = EMPTY_VIEW;
  private readonly listeners = new Set<() => void>();
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly transport: GameTransport) {}

  // ---- State for React ----

  getView = (): GameView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private commit(view: GameView): void {
    this.view = view;
    this.listeners.forEach((listener) => listener());
  }

  /** Forgets the game. Called when the player leaves a room or joins a new one. */
  reset(): void {
    this.cancelSyncLoop();
    if (this.view !== EMPTY_VIEW) this.commit(EMPTY_VIEW);
  }

  // ---- Wiring ----

  /** Starts listening to the room. Returns a function that stops. */
  attach(): () => void {
    const t = this.transport;
    const offs = [
      onGameMessage(t, (message, from) => this.handleMessage(message, from)),
      t.on('room.created', () => this.reset()),
      t.on('room.left', () => this.reset()),
      t.on('room.joined', (payload) => {
        // After a reconnect the server has just seated us again, so this is the safe moment to ask for state.
        if (payload.reconnected === true) this.requestSync();
        else this.reset();
      }),
      t.on('game.started', () => this.handleGameStarted()),
      t.on('player.reconnected', (payload) => this.handlePlayerReconnected(String(payload.userId))),
      t.on('player.left', (payload) => this.handlePlayerLeft(String(payload.userId))),
      t.on('host.changed', (payload) => this.handleHostChanged(String(payload.userId))),
      t.on('client.reconnected', () => this.handleClientReconnected()),
    ];
    return () => {
      offs.forEach((off) => off());
      this.cancelSyncLoop();
    };
  }

  // ---- Local actions ----

  /**
   * The local player pressed a cell. The host applies the move and sends the new state.
   * The guest sends the move to the host and waits for the host's state. Returns true if something was done.
   */
  playCell(cell: number): boolean {
    const snapshot = this.transport.getSnapshot();
    const roles = getRoles(snapshot.room, snapshot.userId);
    const game = this.view.game;
    if (!roles || !snapshot.room || !game || !canPlay(this.view, snapshot)) return false;

    if (roles.myMark === 'X') {
      const result = applyMove(game, cell, 'X');
      if (!result.ok) return false;
      this.commit({ ...this.view, game: { ...result.state, seq: game.seq + 1 } });
      this.pushState(roles.opponent?.userId);
      return true;
    }

    // Guest: pre-check so an obviously illegal press is not sent. The host still decides.
    const check = applyMove(game, cell, 'O');
    if (!check.ok) return false;
    return this.trySend({ type: 'move', payload: { cell } }, snapshot.room.hostId);
  }

  // ---- Incoming messages ----

  private handleMessage(message: GameMessage, from: string): void {
    const snapshot = this.transport.getSnapshot();
    if (!snapshot.room || from === snapshot.userId) return;

    switch (message.type) {
      case 'move':
        this.handleMove(message.payload.cell, from);
        break;
      case 'state':
        this.acceptState(message.payload);
        break;
      case 'sync':
        // Answer only the player who asked.
        this.pushState(from);
        break;
    }
  }

  /** Host only: validate a guest's move, apply it, and publish the new state. Invalid moves are ignored. */
  private handleMove(cell: number, from: string): void {
    const { room, userId } = this.transport.getSnapshot();
    const roles = getRoles(room, userId);
    const game = this.view.game;
    if (!room || !roles || roles.myMark !== 'X' || !game || this.view.forfeit) return;
    if (room.status !== 'playing') return;
    if (!room.players.some((p) => p.userId === from)) return;

    const result = applyMove(game, cell, 'O');
    if (!result.ok) return;
    this.commit({ ...this.view, game: { ...result.state, seq: game.seq + 1 } });
    this.pushState(from);
  }

  /** Keeps a state only when it is newer than the one we hold. */
  private acceptState(state: SyncedState): void {
    const held = this.view.game;
    if (held && state.seq <= held.seq) return;
    this.cancelSyncLoop();
    this.commit({ ...this.view, game: state });
  }

  // ---- System events ----

  private handleGameStarted(): void {
    const { room, userId } = this.transport.getSnapshot();
    const roles = getRoles(room, userId);
    if (roles?.myMark === 'X') {
      this.commit({ game: { ...createGame(), seq: 0 }, forfeit: false });
      this.pushState(roles.opponent?.userId);
    } else {
      // The host's first state is on its way. If it does not show up, ask for it.
      this.startSyncLoop();
    }
  }

  private handlePlayerReconnected(playerId: string): void {
    const { room, userId } = this.transport.getSnapshot();
    if (room?.hostId === userId) this.pushState(playerId);
  }

  private handlePlayerLeft(playerId: string): void {
    const { room, userId } = this.transport.getSnapshot();
    if (playerId === userId || room?.status !== 'playing') return;
    if (this.view.game && isFinished(this.view.game)) return; // the result already stands
    if (!this.view.forfeit) this.commit({ ...this.view, forfeit: true });
  }

  private handleHostChanged(newHostId: string): void {
    const { room, userId } = this.transport.getSnapshot();
    if (newHostId !== userId) return;
    // We are the host now: carry on from the last state we hold.
    this.pushState(getRoles(room, userId)?.opponent?.userId);
  }

  private handleClientReconnected(): void {
    this.requestSync();
    // If we are the host, the opponent may have missed a state while we were offline.
    const { room, userId } = this.transport.getSnapshot();
    if (room?.hostId === userId) this.pushState(getRoles(room, userId)?.opponent?.userId);
  }

  // ---- Sending ----

  private trySend(message: GameMessage, to?: string): boolean {
    try {
      sendGameMessage(this.transport, message, to);
      return true;
    } catch {
      return false; // socket not open; the reconnect resync repairs any gap
    }
  }

  /** Sends the state we hold to one player. Does nothing if we hold none. */
  private pushState(to: string | undefined): void {
    const game = this.view.game;
    if (!game || !to) return;
    this.trySend({ type: 'state', payload: game }, to);
  }

  /** Asks everyone for their state. A client that has none keeps asking until one arrives. */
  private requestSync(): void {
    this.trySend({ type: 'sync', payload: {} });
    if (!this.view.game) this.startSyncLoop();
  }

  private startSyncLoop(): void {
    if (this.syncTimer || this.view.game) return;
    const tick = () => {
      this.syncTimer = null;
      const { room } = this.transport.getSnapshot();
      if (this.view.game || room?.status !== 'playing') return;
      this.trySend({ type: 'sync', payload: {} });
      // The answer may already have arrived (and ended the loop) while sending.
      if (!this.view.game) this.syncTimer = setTimeout(tick, SYNC_RETRY_MS);
    };
    this.syncTimer = setTimeout(tick, SYNC_RETRY_MS);
  }

  private cancelSyncLoop(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
  }
}
