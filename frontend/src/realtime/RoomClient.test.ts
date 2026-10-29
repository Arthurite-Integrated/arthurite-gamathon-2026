import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomClient, RoomClientError } from './RoomClient';

/** A WebSocket we can drive by hand. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const room = (over: Record<string, unknown> = {}) => ({
  code: 'ABCD',
  maxPlayers: 2,
  status: 'waiting',
  hostId: 'alice',
  players: [{ userId: 'alice', displayName: 'Alice', connected: true, isHost: true }],
  ...over,
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const last = () => FakeSocket.instances[FakeSocket.instances.length - 1];

function makeClient(extra: Partial<ConstructorParameters<typeof RoomClient>[0]> = {}) {
  return new RoomClient({
    url: 'wss://example.test/prod',
    getToken: async () => 'tok en',
    createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
    pingIntervalMs: 1_000_000,
    ...extra,
  });
}

async function connected(client = makeClient()) {
  const p = client.connect();
  await tick();
  last().open();
  await p;
  return client;
}

beforeEach(() => {
  FakeSocket.instances = [];
  (globalThis as unknown as { WebSocket: { OPEN: number } }).WebSocket = { OPEN: 1 } as never;
});
afterEach(() => vi.useRealTimers());

describe('RoomClient', () => {
  it('connects with the token in the URL', async () => {
    const client = await connected();
    expect(last().url).toBe('wss://example.test/prod?token=tok%20en');
    expect(client.getSnapshot().connection).toBe('open');
  });

  it('rejects connect() when the server refuses', async () => {
    const client = makeClient();
    const p = client.connect();
    await tick();
    last().drop();
    await expect(p).rejects.toMatchObject({ code: 'connect_failed' });
    expect(client.getSnapshot().connection).toBe('closed');
  });

  it('createRoom resolves with the room and updates the snapshot', async () => {
    const client = await connected();
    const p = client.createRoom({ maxPlayers: 2 });
    expect(last().sent[0]).toEqual({ action: 'createRoom', maxPlayers: 2 });
    last().receive({ type: 'room.created', payload: { room: room(), you: 'alice' } });
    await expect(p).resolves.toMatchObject({ code: 'ABCD' });
    expect(client.getSnapshot()).toMatchObject({ userId: 'alice', room: { code: 'ABCD' } });
  });

  it('joinRoom uppercases the code and rejects with the server error code', async () => {
    const client = await connected();
    const p = client.joinRoom(' abcd ');
    expect(last().sent[0]).toEqual({ action: 'joinRoom', code: 'ABCD' });
    last().receive({ type: 'error', payload: { code: 'room_full', message: 'This room is full' } });
    await expect(p).rejects.toBeInstanceOf(RoomClientError);
    await expect(p).rejects.toMatchObject({ code: 'room_full' });
  });

  it('delivers app messages to handlers with the sender, and "*" sees everything', async () => {
    const client = await connected();
    const move = vi.fn();
    const all = vi.fn();
    client.on('move', move);
    client.on('*', all);
    last().receive({ type: 'move', payload: { x: 3 }, from: 'bob' });
    expect(move).toHaveBeenCalledWith({ x: 3 }, { type: 'move', payload: { x: 3 }, from: 'bob' });
    expect(all).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops delivery', async () => {
    const client = await connected();
    const fn = vi.fn();
    const off = client.on('move', fn);
    off();
    last().receive({ type: 'move', payload: {}, from: 'bob' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('keeps room state in sync with system events', async () => {
    const client = await connected();
    last().receive({
      type: 'room.joined',
      payload: {
        you: 'alice',
        room: room({
          players: [
            { userId: 'alice', displayName: 'Alice', connected: true, isHost: true },
            { userId: 'bob', displayName: 'Bob', connected: true, isHost: false },
          ],
        }),
      },
    });
    last().receive({ type: 'player.disconnected', payload: { userId: 'bob' } });
    expect(client.getSnapshot().room?.players[1].connected).toBe(false);
    last().receive({ type: 'player.reconnected', payload: { userId: 'bob' } });
    expect(client.getSnapshot().room?.players[1].connected).toBe(true);

    last().receive({ type: 'player.left', payload: { userId: 'alice', reason: 'left' } });
    last().receive({ type: 'host.changed', payload: { userId: 'bob' } });
    expect(client.getSnapshot().room).toMatchObject({ hostId: 'bob', players: [{ userId: 'bob', isHost: true }] });

    last().receive({ type: 'game.started', payload: { seed: 42, room: room({ status: 'playing' }) } });
    expect(client.getSnapshot()).toMatchObject({ seed: 42, room: { status: 'playing' } });

    last().receive({ type: 'room.left', payload: { code: 'ABCD' } });
    expect(client.getSnapshot()).toMatchObject({ room: null, seed: null });
  });

  it('send() throws when not connected and includes "to" when given', async () => {
    const client = makeClient();
    expect(() => client.send('move')).toThrow(RoomClientError);
    await connected(client);
    client.send('whisper', { a: 1 }, 'bob');
    expect(last().sent[0]).toEqual({ action: 'send', type: 'whisper', payload: { a: 1 }, to: 'bob' });
  });

  it('times out when the server never replies', async () => {
    vi.useFakeTimers();
    const client = makeClient({ requestTimeoutMs: 50 });
    const p = client.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    await p;
    const req = client.joinRoom('ABCD');
    const assertion = expect(req).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });

  it('reconnects after a drop and rejoins the same room', async () => {
    const client = await connected(makeClient({ maxReconnectMs: 5000 }));
    last().receive({ type: 'room.created', payload: { room: room(), you: 'alice' } });
    const reconnecting = vi.fn();
    const reconnected = vi.fn();
    client.on('client.reconnecting', reconnecting);
    client.on('client.reconnected', reconnected);

    const first = last();
    first.drop();
    expect(client.getSnapshot().connection).toBe('reconnecting');
    expect(reconnecting).toHaveBeenCalled();

    await tick();
    const second = last();
    expect(second).not.toBe(first);
    second.open();
    await tick();
    expect(client.getSnapshot().connection).toBe('open');
    expect(second.sent).toContainEqual({ action: 'joinRoom', code: 'ABCD' });
    expect(reconnected).toHaveBeenCalled();
  });

  it('does not reconnect after disconnect()', async () => {
    const client = await connected();
    client.disconnect();
    await tick();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.getSnapshot().connection).toBe('closed');
  });

  it('gives up and reports client.closed when reconnecting keeps failing', async () => {
    vi.useFakeTimers();
    const client = makeClient({ maxReconnectMs: 2000 });
    const p = client.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    await p;
    const closed = vi.fn();
    client.on('client.closed', closed);

    last().drop();
    for (let i = 0; i < 20 && client.getSnapshot().connection !== 'closed'; i++) {
      await vi.advanceTimersByTimeAsync(0);
      const s = last();
      if (s.readyState === 0) s.drop(); // refuse every attempt
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(client.getSnapshot().connection).toBe('closed');
    expect(closed).toHaveBeenCalled();
  });
});
