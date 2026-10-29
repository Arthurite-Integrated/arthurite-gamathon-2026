/**
 * RoomClient: the one integration point between ANY frontend and the realtime rooms backend.
 *
 *   const client = new RoomClient({ url: config.wsUrl, getToken: getAuthToken });
 *   await client.connect();
 *   await client.createRoom({ maxPlayers: 2 });      // or: await client.joinRoom('ABCD')
 *   client.on('move', (payload, msg) => ...);        // messages from other players
 *   client.send('move', { x: 1 });                   // goes to everyone else in the room
 *   await client.start();                            // host only; everyone gets the same seed
 *
 * The backend never reads your messages, so game rules live in your app. See
 * docs/REALTIME-PROTOCOL.md for every message and error code.
 */

export interface PlayerInfo {
  userId: string;
  displayName: string;
  connected: boolean;
  isHost: boolean;
}

export interface RoomInfo {
  code: string;
  maxPlayers: number;
  status: 'waiting' | 'playing';
  hostId: string;
  players: PlayerInfo[];
}

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Immutable view of the client for rendering. A new object is created on every change. */
export interface ClientSnapshot {
  connection: ConnectionState;
  userId: string | null;
  room: RoomInfo | null;
  /** The shared random seed from the last game.started, or null before a game starts. */
  seed: number | null;
}

export interface ServerMessage {
  type: string;
  payload: Record<string, unknown>;
  /** userId of the player who sent an app message */
  from?: string;
}

export type Handler = (payload: Record<string, unknown>, message: ServerMessage) => void;

/** A failure reported by the backend (`code` is stable, see the protocol doc) or by the client itself. */
export class RoomClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RoomClientError';
  }
}

export interface RoomClientOptions {
  /** wss://... URL from the stack output WebSocketUrl (VITE_WS_URL). */
  url: string;
  /** Returns a fresh Cognito ID token (or a dev token in local mode). Called on every (re)connect. */
  getToken: () => Promise<string>;
  /** Keep-alive and cleanup ping. Default 20s. */
  pingIntervalMs?: number;
  /** How long createRoom/joinRoom/leaveRoom/start wait for a reply. Default 10s. */
  requestTimeoutMs?: number;
  /** How long to keep trying to reconnect after a drop. Keep below the server grace period (30s). Default 25s. */
  maxReconnectMs?: number;
  /** Override for tests. */
  createSocket?: (url: string) => WebSocket;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class RoomClient {
  private readonly pingIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxReconnectMs: number;
  private readonly createSocket: (url: string) => WebSocket;

  private socket: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** Bumped by connect() and disconnect() so stale async work can tell it has been superseded. */
  private generation = 0;
  private handlers = new Map<string, Set<Handler>>();
  private listeners = new Set<() => void>();
  private snapshot: ClientSnapshot = { connection: 'idle', userId: null, room: null, seed: null };

  constructor(private readonly options: RoomClientOptions) {
    this.pingIntervalMs = options.pingIntervalMs ?? 20_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.maxReconnectMs = options.maxReconnectMs ?? 25_000;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
  }

  // ---- State (works with React's useSyncExternalStore, see useRoom.ts) ----

  getSnapshot = (): ClientSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<ClientSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ---- Events ----

  /**
   * Listen for a message type: your own app types, system events (room.*, player.*, host.changed,
   * game.started, error, pong), client events (client.reconnecting, client.reconnected, client.closed),
   * or '*' for everything. Returns an unsubscribe function.
   */
  on(type: string, handler: Handler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  private emit(message: ServerMessage): void {
    this.handlers.get(message.type)?.forEach((h) => h(message.payload, message));
    this.handlers.get('*')?.forEach((h) => h(message.payload, message));
  }

  // ---- Connection ----

  /** Opens the socket. Resolves when connected, rejects if the server refuses (for example a bad token). */
  async connect(): Promise<void> {
    const generation = ++this.generation;
    this.update({ connection: 'connecting' });
    try {
      await this.open(generation);
    } catch (err) {
      if (generation === this.generation) this.update({ connection: 'closed' });
      throw err;
    }
  }

  /** Leaves nothing behind: closes the socket and forgets the room. Call when the user is done. */
  disconnect(): void {
    this.generation++;
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.update({ connection: 'closed', room: null, seed: null });
  }

  private async open(generation: number): Promise<void> {
    const token = await this.options.getToken();
    if (generation !== this.generation) throw new RoomClientError('aborted', 'Connection attempt was cancelled');

    const separator = this.options.url.includes('?') ? '&' : '?';
    const socket = this.createSocket(`${this.options.url}${separator}token=${encodeURIComponent(token)}`);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new RoomClientError('connect_failed', 'Could not connect to the realtime server'));
      socket.onclose = () => reject(new RoomClientError('connect_failed', 'The realtime server refused the connection'));
    });

    if (generation !== this.generation) {
      socket.close();
      throw new RoomClientError('aborted', 'Connection attempt was cancelled');
    }

    socket.onerror = null;
    socket.onmessage = (event) => this.handleRaw(String(event.data));
    socket.onclose = () => this.handleClose(socket, generation);
    this.update({ connection: 'open' });
    this.startPing();
  }

  private handleClose(socket: WebSocket, generation: number): void {
    if (socket !== this.socket || generation !== this.generation) return; // an old socket, ignore
    this.stopPing();
    this.socket = null;
    void this.reconnect(generation);
  }

  /** A dropped socket is retried with backoff. If a room was open, the player rejoins it with the same code. */
  private async reconnect(generation: number): Promise<void> {
    this.update({ connection: 'reconnecting' });
    this.emit({ type: 'client.reconnecting', payload: {} });
    const deadline = Date.now() + this.maxReconnectMs;
    let delay = 500;

    while (generation === this.generation && Date.now() < deadline) {
      try {
        await this.open(generation);
        const code = this.snapshot.room?.code;
        if (code) this.sendRaw({ action: 'joinRoom', code });
        this.emit({ type: 'client.reconnected', payload: {} });
        return;
      } catch {
        if (generation !== this.generation) return;
        await sleep(delay);
        delay = Math.min(delay * 2, 4000);
      }
    }

    if (generation === this.generation) {
      this.update({ connection: 'closed', room: null, seed: null });
      this.emit({ type: 'client.closed', payload: {} });
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      try {
        this.sendRaw({ action: 'ping' });
      } catch {
        /* the close handler takes care of a dead socket */
      }
    }, this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  // ---- Actions ----

  /** Creates a room and becomes its host. maxPlayers is 2 to 8 (default 2). */
  async createRoom(options: { maxPlayers?: number; displayName?: string } = {}): Promise<RoomInfo> {
    await this.request({ action: 'createRoom', ...options }, 'room.created');
    return this.requireRoom();
  }

  /** Joins by 4-letter code. Also how a dropped player takes their seat back. */
  async joinRoom(code: string, options: { displayName?: string } = {}): Promise<RoomInfo> {
    await this.request({ action: 'joinRoom', code: code.trim().toUpperCase(), ...options }, 'room.joined');
    return this.requireRoom();
  }

  async leaveRoom(): Promise<void> {
    await this.request({ action: 'leaveRoom' }, 'room.left');
  }

  /** Host only. Resolves when the game starts; read the shared seed from snapshot.seed or the game.started payload. */
  async start(settings: Record<string, unknown> = {}): Promise<void> {
    await this.request({ action: 'start', settings }, 'game.started');
  }

  /**
   * Sends an app message to everyone else in the room (or one player with `to`).
   * Messages may arrive out of order under load, so include a counter in the payload if order matters.
   * Types starting with room. player. host. game. system. are reserved.
   */
  send(type: string, payload: Record<string, unknown> = {}, to?: string): void {
    this.sendRaw({ action: 'send', type, payload, ...(to ? { to } : {}) });
  }

  private requireRoom(): RoomInfo {
    const room = this.snapshot.room;
    if (!room) throw new RoomClientError('internal_error', 'Room state was not received');
    return room;
  }

  private sendRaw(body: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new RoomClientError('not_connected', 'Not connected to the realtime server');
    }
    this.socket.send(JSON.stringify(body));
  }

  /** Sends an action and waits for its success event, or rejects with the server's error. */
  private request(body: Record<string, unknown>, successType: string): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        offSuccess();
        offError();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new RoomClientError('timeout', `No reply to ${String(body.action)}`));
      }, this.requestTimeoutMs);
      const offSuccess = this.on(successType, (_payload, message) => {
        cleanup();
        resolve(message);
      });
      const offError = this.on('error', (payload) => {
        cleanup();
        reject(new RoomClientError(String(payload.code ?? 'error'), String(payload.message ?? 'Request failed')));
      });
      try {
        this.sendRaw(body);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }

  // ---- Incoming messages ----

  private handleRaw(raw: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      return; // ignore anything that is not our protocol
    }
    if (typeof message.type !== 'string') return;
    message.payload = message.payload ?? {};
    this.applyToState(message);
    this.emit(message);
  }

  private applyToState(message: ServerMessage): void {
    const { type, payload } = message;
    const room = this.snapshot.room;
    const userId = (v: unknown) => String(v);

    switch (type) {
      case 'room.created':
      case 'room.joined':
        this.update({ room: payload.room as RoomInfo, userId: userId(payload.you) });
        break;
      case 'player.joined':
        this.update({ room: payload.room as RoomInfo });
        break;
      case 'game.started':
        this.update({ room: payload.room as RoomInfo, seed: Number(payload.seed) });
        break;
      case 'room.left':
        this.update({ room: null, seed: null });
        break;
      case 'player.left':
        if (room) this.update({ room: { ...room, players: room.players.filter((p) => p.userId !== userId(payload.userId)) } });
        break;
      case 'player.disconnected':
      case 'player.reconnected':
        if (room) {
          const connected = type === 'player.reconnected';
          this.update({
            room: { ...room, players: room.players.map((p) => (p.userId === userId(payload.userId) ? { ...p, connected } : p)) },
          });
        }
        break;
      case 'host.changed':
        if (room) {
          const hostId = userId(payload.userId);
          this.update({ room: { ...room, hostId, players: room.players.map((p) => ({ ...p, isHost: p.userId === hostId })) } });
        }
        break;
      case 'error':
        // If a rejoin after a reconnect finds the room gone, drop the stale room.
        if (payload.code === 'room_not_found') this.update({ room: null, seed: null });
        break;
    }
  }
}
