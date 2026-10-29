import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot, Handler, RoomInfo } from '../../realtime/RoomClient';
import { GameController } from './controller';
import type { GameTransport } from './messages';
import { canPlay, getResult } from './roles';

interface Sent {
  from: string;
  to: string | undefined;
  type: string;
  payload: Record<string, unknown>;
}

/** One player's connection to the fake room. Behaves like RoomClient as far as the game can tell. */
class FakePlayer implements GameTransport {
  private readonly handlers = new Map<string, Set<Handler>>();
  online = true;
  snapshot: ClientSnapshot;

  constructor(
    readonly userId: string,
    private readonly hub: Hub,
  ) {
    this.snapshot = { connection: 'open', userId, room: hub.room, seed: null };
  }

  getSnapshot = (): ClientSnapshot => this.snapshot;

  on(type: string, handler: Handler): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  send(type: string, payload: Record<string, unknown> = {}, to?: string): void {
    if (!this.online) throw new Error('not_connected');
    this.hub.relay({ from: this.userId, to, type, payload });
  }

  /** Delivers an event to this player's handlers, as RoomClient does. */
  emit(type: string, payload: Record<string, unknown> = {}, from?: string): void {
    const message = { type, payload, ...(from ? { from } : {}) };
    this.handlers.get(type)?.forEach((h) => h(payload, message));
  }
}

/** A tiny stand-in for the backend: it only relays messages and announces room events. */
class Hub {
  room: RoomInfo = {
    code: 'ABCD',
    maxPlayers: 2,
    status: 'waiting',
    hostId: 'alice',
    players: [
      { userId: 'alice', displayName: 'Alice', connected: true, isHost: true },
      { userId: 'bob', displayName: 'Bob', connected: true, isHost: false },
    ],
  };
  readonly players = new Map<string, FakePlayer>();
  readonly log: Sent[] = [];

  add(userId: string): FakePlayer {
    const player = new FakePlayer(userId, this);
    this.players.set(userId, player);
    return player;
  }

  setRoom(room: RoomInfo): void {
    this.room = room;
    this.players.forEach((p) => {
      p.snapshot = { ...p.snapshot, room };
    });
  }

  relay(sent: Sent): void {
    this.log.push(sent);
    for (const player of this.players.values()) {
      if (player.userId === sent.from || !player.online) continue; // offline players miss messages
      if (sent.to !== undefined && sent.to !== player.userId) continue;
      player.emit(sent.type, sent.payload, sent.from);
    }
  }

  /** Mirrors the backend: the room locks and every player receives game.started. */
  start(order: string[] = ['alice', 'bob']): void {
    this.setRoom({ ...this.room, status: 'playing' });
    for (const id of order) this.players.get(id)?.emit('game.started', { seed: 1, room: this.room });
  }

  setConnected(userId: string, connected: boolean): void {
    this.setRoom({
      ...this.room,
      players: this.room.players.map((p) => (p.userId === userId ? { ...p, connected } : p)),
    });
  }

  /** A clean drop: the other player is told. */
  disconnect(userId: string): void {
    this.players.get(userId)!.online = false;
    this.setConnected(userId, false);
    for (const p of this.players.values()) {
      if (p.userId !== userId) p.emit('player.disconnected', { userId, graceMs: 30000 });
    }
  }

  /** Same order as the real client: client.reconnected first, then the server seats the player again. */
  reconnect(userId: string): void {
    const me = this.players.get(userId)!;
    me.online = true;
    me.emit('client.reconnected');
    this.setConnected(userId, true);
    for (const p of this.players.values()) if (p.userId !== userId) p.emit('player.reconnected', { userId });
    me.emit('room.joined', { room: this.room, you: userId, reconnected: true });
  }

  leave(userId: string, reason = 'left'): void {
    this.setRoom({ ...this.room, players: this.room.players.filter((p) => p.userId !== userId) });
    for (const p of this.players.values()) if (p.userId !== userId) p.emit('player.left', { userId, reason });
  }

  sentOfType(type: string): Sent[] {
    return this.log.filter((s) => s.type === type);
  }
}

function setup() {
  const hub = new Hub();
  const alice = hub.add('alice');
  const bob = hub.add('bob');
  const a = new GameController(alice);
  const b = new GameController(bob);
  const detach = [a.attach(), b.attach()];
  return { hub, alice, bob, a, b, detach };
}

/** Alice (host, X) and Bob (guest, O) with the game started. */
function started() {
  const ctx = setup();
  ctx.hub.start();
  return ctx;
}

const board = (c: GameController) => c.getView().game?.board;
const seq = (c: GameController) => c.getView().game?.seq;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('game start', () => {
  it('host creates the first state (seq 0) and sends it to the guest only', () => {
    const { hub, a, b } = started();
    expect(a.getView().game).toMatchObject({ turn: 'X', winner: null, winningLine: null, seq: 0 });
    expect(b.getView().game).toMatchObject({ turn: 'X', winner: null, seq: 0 });
    const states = hub.sentOfType('state');
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ from: 'alice', to: 'bob' });
  });

  it('works when the guest hears game.started before the host does', () => {
    const { a, b, hub } = setup();
    hub.start(['bob', 'alice']);
    expect(seq(a)).toBe(0);
    expect(seq(b)).toBe(0);
  });

  it('keeps a state that reaches the guest before its own game.started', () => {
    const { a, b, hub, alice, bob } = setup();
    hub.setRoom({ ...hub.room, status: 'playing' });
    alice.emit('game.started', { seed: 1, room: hub.room }); // host starts and sends state
    expect(seq(b)).toBe(0);
    bob.emit('game.started', { seed: 1, room: hub.room }); // guest hears it afterwards
    expect(seq(a)).toBe(0);
    expect(seq(b)).toBe(0);
  });
});

describe('moves', () => {
  it('a host move updates both players with seq +1', () => {
    const { a, b } = started();
    expect(a.playCell(4)).toBe(true);
    expect(board(a)?.[4]).toBe('X');
    expect(board(b)?.[4]).toBe('X');
    expect(seq(a)).toBe(1);
    expect(seq(b)).toBe(1);
    expect(b.getView().game?.turn).toBe('O');
  });

  it('a guest move goes only to the host, which answers with the new state', () => {
    const { hub, a, b } = started();
    a.playCell(4);
    hub.log.length = 0;

    expect(b.playCell(0)).toBe(true);
    const moves = hub.sentOfType('move');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ from: 'bob', to: 'alice', payload: { cell: 0 } });
    expect(board(a)?.[0]).toBe('O');
    expect(board(b)?.[0]).toBe('O');
    expect(seq(a)).toBe(2);
    expect(seq(b)).toBe(2);
  });

  it('the guest does not apply its own move locally', () => {
    const { a, b, alice } = started();
    a.playCell(4);
    alice.online = false; // the host cannot answer
    b.playCell(0);
    expect(board(b)?.[0]).toBeNull();
    expect(seq(b)).toBe(1);
  });

  it('refuses presses on the wrong turn or an occupied cell', () => {
    const { a, b } = started();
    expect(b.playCell(0)).toBe(false); // X moves first
    a.playCell(4);
    expect(a.playCell(0)).toBe(false); // now it is O's turn
    expect(b.playCell(4)).toBe(false); // occupied
    expect(seq(a)).toBe(1);
  });

  it('the host ignores invalid moves that arrive anyway', () => {
    const { a, bob, hub } = started();

    bob.send('move', { cell: 3 }); // not O's turn yet
    expect(seq(a)).toBe(0);

    a.playCell(4);
    bob.send('move', { cell: 4 }); // occupied
    bob.send('move', { cell: 12 }); // out of range
    bob.send('move', { cell: 'x' }); // wrong type
    bob.send('move', {}); // missing
    expect(seq(a)).toBe(1);
    expect(hub.sentOfType('state')).toHaveLength(2); // the start plus the one valid move
  });

  it('a guest ignores a move sent to it', () => {
    const { a, b, alice } = started();
    alice.send('move', { cell: 0 }, 'bob');
    expect(seq(a)).toBe(0);
    expect(seq(b)).toBe(0);
    expect(board(b)?.[0]).toBeNull();
  });

  it('ignores moves after the game is over', () => {
    const { a, b, bob } = started();
    a.playCell(0);
    b.playCell(3);
    a.playCell(1);
    b.playCell(4);
    a.playCell(2); // X completes the top row
    expect(a.getView().game).toMatchObject({ winner: 'X', winningLine: [0, 1, 2] });
    const finalSeq = seq(a);

    bob.send('move', { cell: 8 });
    expect(a.playCell(8)).toBe(false);
    expect(seq(a)).toBe(finalSeq);
    expect(b.getView().game).toMatchObject({ winner: 'X', seq: finalSeq });
  });
});

describe('state ordering', () => {
  it('accepts only a higher seq', () => {
    const { a, b, alice } = started();
    a.playCell(4); // seq 1
    b.playCell(0); // seq 2
    const current = b.getView().game!;
    expect(current.seq).toBe(2);

    alice.send('state', { ...current, seq: 1, board: Array(9).fill(null) }, 'bob'); // older
    expect(seq(b)).toBe(2);
    expect(board(b)?.[0]).toBe('O');

    alice.send('state', { ...current, board: Array(9).fill(null) }, 'bob'); // same seq
    expect(board(b)?.[0]).toBe('O');

    alice.send('state', { ...current, seq: 9 }, 'bob'); // newer
    expect(seq(b)).toBe(9);
  });

  it('ignores a malformed state', () => {
    const { b, alice } = started();
    alice.send('state', { board: [], turn: 'X', winner: null, winningLine: null, seq: 50 }, 'bob');
    expect(seq(b)).toBe(0);
  });
});

describe('sync', () => {
  it('a guest that missed the first state asks again and gets it', () => {
    const { hub, bob, b } = setup();
    bob.online = false; // the first state is lost on its way to the guest
    hub.start();
    expect(b.getView().game).toBeNull();

    bob.online = true;
    vi.advanceTimersByTime(1000);
    expect(hub.sentOfType('sync')).toHaveLength(1);
    expect(seq(b)).toBe(0);

    vi.advanceTimersByTime(5000); // it stops asking once it has a state
    expect(hub.sentOfType('sync')).toHaveLength(1);
  });

  it('keeps asking until someone answers', () => {
    const { hub, b } = setup();
    hub.start(['bob']); // the host never started, so nobody holds a state
    vi.advanceTimersByTime(3000);
    expect(hub.sentOfType('sync')).toHaveLength(3);
    expect(b.getView().game).toBeNull();
  });

  it('answers a sync only to the player who asked', () => {
    const { hub, bob } = started();
    hub.log.length = 0;
    bob.send('sync', {});
    const replies = hub.sentOfType('state');
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ from: 'alice', to: 'bob' });
  });

  it('a client without a state does not answer a sync', () => {
    const { hub, alice, b } = setup();
    hub.setRoom({ ...hub.room, status: 'playing' });
    alice.send('sync', {});
    expect(hub.sentOfType('state')).toHaveLength(0);
    expect(b.getView().game).toBeNull();
  });
});

describe('disconnects and reconnects', () => {
  it('pauses input while the opponent is disconnected and resumes when they return', () => {
    const { hub, a, alice } = started();
    hub.disconnect('bob');
    expect(canPlay(a.getView(), alice.getSnapshot())).toBe(false);
    expect(a.playCell(4)).toBe(false);
    hub.reconnect('bob');
    expect(canPlay(a.getView(), alice.getSnapshot())).toBe(true);
    expect(a.playCell(4)).toBe(true);
  });

  it('pauses input while my own connection is reconnecting', () => {
    const { a, alice } = started();
    alice.snapshot = { ...alice.snapshot, connection: 'reconnecting' };
    expect(canPlay(a.getView(), alice.getSnapshot())).toBe(false);
    expect(a.playCell(4)).toBe(false);
  });

  it('the host re-sends its state when the guest reconnects', () => {
    const { hub, a } = started();
    a.playCell(4);
    hub.disconnect('bob');
    hub.log.length = 0;
    hub.reconnect('bob');
    // One answer to the guest's sync and one from player.reconnected, at least.
    expect(hub.sentOfType('state').filter((s) => s.from === 'alice' && s.to === 'bob').length).toBeGreaterThanOrEqual(2);
    expect(hub.sentOfType('sync').some((s) => s.from === 'bob')).toBe(true);
  });

  it('a guest that missed a state while offline catches up after reconnecting', () => {
    const { hub, a, b, bob } = started();
    bob.online = false; // the host has not noticed yet, so it still plays
    a.playCell(4);
    expect(seq(b)).toBe(0);
    hub.reconnect('bob');
    expect(seq(b)).toBe(1);
    expect(board(b)?.[4]).toBe('X');
  });

  it('a host that reconnects re-sends the state its guest missed', () => {
    const { hub, a, b, alice } = started();
    alice.online = false; // the host moves just as its socket dies: the send fails
    expect(a.playCell(4)).toBe(true);
    expect(seq(a)).toBe(1);
    expect(seq(b)).toBe(0);
    hub.reconnect('alice');
    expect(seq(b)).toBe(1);
  });

  it('a failed send does not throw', () => {
    const { a, alice } = started();
    alice.online = false;
    expect(() => a.playCell(4)).not.toThrow();
  });

  it('a reconnecting guest with no state keeps asking until it gets one', () => {
    const { hub, bob, b } = setup();
    hub.setRoom({ ...hub.room, status: 'playing' });
    bob.emit('client.reconnected');
    vi.advanceTimersByTime(2000);
    expect(hub.sentOfType('sync').length).toBeGreaterThanOrEqual(3);
    expect(b.getView().game).toBeNull();
  });
});

describe('leaving and forfeit', () => {
  it('the remaining player wins when the opponent leaves mid-game', () => {
    const { hub, a } = started();
    a.playCell(4);
    hub.leave('bob');
    expect(a.getView().forfeit).toBe(true);
    expect(getResult(a.getView(), 'X')).toBe('win');
  });

  it('also wins when the opponent times out', () => {
    const { hub, b } = started();
    hub.leave('alice', 'timeout');
    expect(b.getView().forfeit).toBe(true);
    expect(getResult(b.getView(), 'O')).toBe('win');
  });

  it('does not overturn a finished game when someone leaves afterwards', () => {
    const { hub, a, b } = started();
    a.playCell(0);
    b.playCell(3);
    a.playCell(1);
    b.playCell(4);
    a.playCell(2); // X wins
    hub.leave('bob');
    expect(a.getView().forfeit).toBe(false);
    expect(getResult(a.getView(), 'X')).toBe('win');
    expect(getResult(b.getView(), 'O')).toBe('lose');
  });

  it('a player leaving the waiting room is not a forfeit', () => {
    const { hub, a } = setup();
    hub.leave('bob');
    expect(a.getView().forfeit).toBe(false);
  });
});

describe('host change', () => {
  it('the new host sends the state it holds and carries on from it', () => {
    const { hub, a, b, bob } = started();
    a.playCell(4);
    hub.log.length = 0;

    hub.setRoom({
      ...hub.room,
      hostId: 'bob',
      players: hub.room.players.map((p) => ({ ...p, isHost: p.userId === 'bob' })),
    });
    bob.emit('host.changed', { userId: 'bob' });

    expect(hub.sentOfType('state').some((s) => s.from === 'bob' && s.to === 'alice')).toBe(true);
    expect(seq(b)).toBe(1);
    expect(board(b)?.[4]).toBe('X');
  });

  it('a host change to someone else sends nothing', () => {
    const { hub, alice } = started();
    hub.log.length = 0;
    alice.emit('host.changed', { userId: 'bob' });
    expect(hub.log).toHaveLength(0);
  });
});

describe('lifecycle', () => {
  it('reset forgets the game', () => {
    const { a } = started();
    a.reset();
    expect(a.getView()).toEqual({ game: null, forfeit: false });
  });

  it('forgets the game when the room is left', () => {
    const { alice, a } = started();
    alice.emit('room.left', { code: 'ABCD' });
    expect(a.getView().game).toBeNull();
  });

  it('forgets the game when a new room is joined, but not when rejoining after a drop', () => {
    const { alice, a } = started();
    alice.emit('room.joined', { reconnected: true });
    expect(a.getView().game).not.toBeNull();
    alice.emit('room.joined', { reconnected: false });
    expect(a.getView().game).toBeNull();
  });

  it('stops listening after detach', () => {
    const { hub, a, b, detach } = setup();
    detach.forEach((d) => d());
    hub.start();
    expect(a.getView().game).toBeNull();
    expect(b.getView().game).toBeNull();
  });

  it('notifies subscribers when the view changes, and not after unsubscribing', () => {
    const { hub, a } = setup();
    const listener = vi.fn();
    const off = a.subscribe(listener);
    hub.start();
    expect(listener).toHaveBeenCalled();
    const calls = listener.mock.calls.length;
    off();
    a.playCell(4);
    expect(listener.mock.calls.length).toBe(calls);
  });
});
