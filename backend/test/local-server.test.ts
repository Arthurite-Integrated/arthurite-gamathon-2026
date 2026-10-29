import { startLocalRealtime, LocalRealtime } from '../scripts/local-realtime';

/** Minimal client over Node's built-in WebSocket: collects messages and waits for one by type. */
class TestClient {
  messages: Array<{ type: string; payload: Record<string, unknown>; from?: string }> = [];
  private socket: WebSocket;
  opened: Promise<void>;

  constructor(url: string, token: string) {
    this.socket = new WebSocket(`${url}?token=${token}`);
    this.socket.onmessage = (e) => this.messages.push(JSON.parse(String(e.data)));
    this.opened = new Promise((resolve, reject) => {
      this.socket.onopen = () => resolve();
      this.socket.onerror = () => reject(new Error('socket error'));
    });
  }

  send(body: Record<string, unknown>) {
    this.socket.send(JSON.stringify(body));
  }

  async next(type: string, timeoutMs = 3000) {
    const start = Date.now();
    for (;;) {
      const found = this.messages.find((m) => m.type === type);
      if (found) {
        this.messages.splice(this.messages.indexOf(found), 1);
        return found;
      }
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for "${type}"`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  close() {
    this.socket.close();
  }
}

describe('local realtime server (real WebSocket, real room logic)', () => {
  let server: LocalRealtime;
  beforeAll(async () => {
    server = await startLocalRealtime({ port: 0, quiet: true, graceSeconds: 1 });
  });
  afterAll(async () => {
    await server.close();
  });

  it('runs a full two-player flow: create, join, start, relay, leave', async () => {
    const alice = new TestClient(server.url, 'dev:alice:Alice');
    const bob = new TestClient(server.url, 'dev:bob:Bob');
    await Promise.all([alice.opened, bob.opened]);

    alice.send({ action: 'createRoom', maxPlayers: 2 });
    const created = await alice.next('room.created');
    const code = (created.payload.room as { code: string }).code;
    expect(code).toMatch(/^[A-Z]{4}$/);

    bob.send({ action: 'joinRoom', code });
    await bob.next('room.joined');
    expect((await alice.next('player.joined')).payload).toMatchObject({ userId: 'bob' });

    alice.send({ action: 'start', settings: { rounds: 3 } });
    const [a, b] = await Promise.all([alice.next('game.started'), bob.next('game.started')]);
    expect(a.payload.seed).toBe(b.payload.seed);

    bob.send({ action: 'send', type: 'chat', payload: { text: 'hi' } });
    expect(await alice.next('chat')).toEqual({ type: 'chat', payload: { text: 'hi' }, from: 'bob' });

    bob.close();
    expect((await alice.next('player.disconnected')).payload).toMatchObject({ userId: 'bob' });
    alice.close();
  });

  it('rejects a connection without a dev token', async () => {
    const socket = new WebSocket(`${server.url}?token=garbage`);
    const code = await new Promise<number>((resolve) => {
      socket.onclose = (e) => resolve(e.code);
    });
    expect(code).toBe(1008);
  });
});
