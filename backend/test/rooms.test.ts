import { createHarness, Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

/** alice (c1) creates a room; each extra [connectionId, userId] joins it. Returns the room code. */
async function setupRoom(maxPlayers = 2, joiners: Array<[string, string]> = []): Promise<string> {
  await h.connect('c1', 'alice', 'Alice');
  await h.act('c1', { action: 'createRoom', maxPlayers });
  const code = h.room('c1', 'room.created').code;
  for (const [cid, uid] of joiners) {
    await h.connect(cid, uid, uid);
    await h.act(cid, { action: 'joinRoom', code });
  }
  return code;
}

const errorCode = (cid: string) => {
  const errs = h.to(cid, 'error');
  return errs.length ? errs[errs.length - 1].payload.code : undefined;
};

describe('creating and joining', () => {
  it('creates a room with a 4-letter code and makes the creator host', async () => {
    await h.connect('c1', 'alice', 'Alice');
    await h.act('c1', { action: 'createRoom' });

    const room = h.room('c1', 'room.created');
    expect(room.code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(room.maxPlayers).toBe(2);
    expect(room.status).toBe('waiting');
    expect(room.hostId).toBe('alice');
    expect(room.players).toEqual([{ userId: 'alice', displayName: 'Alice', connected: true, isHost: true }]);
  });

  it('lets a second player join by code, case-insensitively, and tells everyone', async () => {
    const code = await setupRoom();
    await h.connect('c2', 'bob', 'Bob');
    await h.act('c2', { action: 'joinRoom', code: code.toLowerCase() });

    expect(h.room('c2', 'room.joined').players.map((p) => p.userId)).toEqual(['alice', 'bob']);
    expect(h.last('c1', 'player.joined').payload).toMatchObject({ userId: 'bob', displayName: 'Bob' });
  });

  it('rejects joining a full room, an unknown room, and a bad code', async () => {
    const code = await setupRoom(2, [['c2', 'bob']]);
    await h.connect('c3', 'carol', 'Carol');

    await h.act('c3', { action: 'joinRoom', code });
    expect(errorCode('c3')).toBe('room_full');

    await h.act('c3', { action: 'joinRoom', code: 'ZZZZ' });
    expect(errorCode('c3')).toBe('room_not_found');

    await h.act('c3', { action: 'joinRoom', code: 'AB1' });
    expect(errorCode('c3')).toBe('invalid_message');
  });

  it('never overfills a room when many players join at the same time', async () => {
    const code = await setupRoom(4);
    const ids = ['b', 'c', 'd', 'e', 'f', 'g'];
    for (const id of ids) await h.connect(`c-${id}`, id, id);
    await Promise.all(ids.map((id) => h.act(`c-${id}`, { action: 'joinRoom', code })));

    const joined = ids.filter((id) => h.to(`c-${id}`, 'room.joined').length > 0);
    const full = ids.filter((id) => errorCode(`c-${id}`) === 'room_full');
    expect(joined).toHaveLength(3); // alice + 3 = 4 seats
    expect(full).toHaveLength(3);
  });

  it('does not let a player be in two rooms on one connection', async () => {
    await setupRoom();
    await h.act('c1', { action: 'createRoom' });
    expect(errorCode('c1')).toBe('already_in_room');
  });

  describe('a connection whose room pointer went stale', () => {
    /**
     * alice creates a room on c1, then the same account opens c1b (a second tab or a refreshed page) and takes
     * the seat. c1 still remembers the room. c1b leaves, so the room is deleted while c1 still points at it.
     */
    async function staleConnection(): Promise<string> {
      const code = await setupRoom();
      await h.connect('c1b', 'alice', 'Alice');
      await h.act('c1b', { action: 'joinRoom', code });
      await h.act('c1b', { action: 'leaveRoom' });
      return code;
    }

    it('lets it create a new room instead of saying already_in_room', async () => {
      const oldCode = await staleConnection();
      await h.act('c1', { action: 'createRoom' });

      expect(errorCode('c1')).toBeUndefined();
      const room = h.room('c1', 'room.created');
      expect(room.code).not.toBe(oldCode);
      expect(room.hostId).toBe('alice');
    });

    it('lets it join a different room', async () => {
      await staleConnection();
      await h.connect('c2', 'bob', 'Bob');
      await h.act('c2', { action: 'createRoom' });
      const bobsCode = h.room('c2', 'room.created').code;

      await h.act('c1', { action: 'joinRoom', code: bobsCode });
      expect(errorCode('c1')).toBeUndefined();
      expect(h.room('c1', 'room.joined').players.map((p) => p.userId).sort()).toEqual(['alice', 'bob']);
    });

    it('still refuses a connection that really holds a seat in a room', async () => {
      await setupRoom();
      await h.act('c1', { action: 'createRoom' });
      expect(errorCode('c1')).toBe('already_in_room');
    });

    it('leaving from the stale connection does not take the seat the account holds on another connection', async () => {
      const code = await setupRoom(2, [['c2', 'bob']]);
      await h.connect('c1b', 'alice', 'Alice');
      await h.act('c1b', { action: 'joinRoom', code }); // c1b now owns alice's seat

      await h.act('c1', { action: 'leaveRoom' }); // c1 is stale
      expect(h.to('c1', 'room.left')).toHaveLength(1);
      expect(h.to('c2', 'player.left')).toHaveLength(0);

      await h.act('c1b', { action: 'send', type: 'hello', payload: {} });
      expect(errorCode('c1b')).toBeUndefined();
      expect(h.to('c2', 'hello')).toHaveLength(1);
    });
  });

  it('rejects an invalid maxPlayers', async () => {
    await h.connect('c1', 'alice', 'Alice');
    await h.act('c1', { action: 'createRoom', maxPlayers: 9 });
    expect(errorCode('c1')).toBe('invalid_message');
  });
});

describe('starting a game', () => {
  it('only lets the host start, and needs at least 2 connected players', async () => {
    const code = await setupRoom();
    await h.act('c1', { action: 'start' });
    expect(errorCode('c1')).toBe('not_enough_players');

    await h.connect('c2', 'bob', 'Bob');
    await h.act('c2', { action: 'joinRoom', code });
    await h.act('c2', { action: 'start' });
    expect(errorCode('c2')).toBe('not_host');
  });

  it('sends the same seed and settings to every player, then locks the room', async () => {
    const code = await setupRoom(3, [['c2', 'bob']]);
    await h.act('c1', { action: 'start', settings: { mode: 'fast' } });

    const a = h.last('c1', 'game.started').payload;
    const b = h.last('c2', 'game.started').payload;
    expect(typeof a.seed).toBe('number');
    expect(a.seed).toBe(b.seed);
    expect(a.settings).toEqual({ mode: 'fast' });
    expect(h.room('c1', 'game.started').status).toBe('playing');

    await h.connect('c3', 'carol', 'Carol');
    await h.act('c3', { action: 'joinRoom', code });
    expect(errorCode('c3')).toBe('room_locked');

    await h.act('c1', { action: 'start' });
    expect(errorCode('c1')).toBe('room_locked');
  });
});

describe('relaying app messages', () => {
  it('forwards to everyone else with the sender id, never back to the sender', async () => {
    await setupRoom(3, [['c2', 'bob'], ['c3', 'carol']]);
    await h.act('c1', { action: 'send', type: 'move', payload: { x: 1 } });

    expect(h.last('c2', 'move')).toEqual({ type: 'move', payload: { x: 1 }, from: 'alice' });
    expect(h.to('c3', 'move')).toHaveLength(1);
    expect(h.to('c1', 'move')).toHaveLength(0);
  });

  it('can target a single player', async () => {
    await setupRoom(3, [['c2', 'bob'], ['c3', 'carol']]);
    await h.act('c1', { action: 'send', type: 'whisper', payload: {}, to: 'bob' });
    expect(h.to('c2', 'whisper')).toHaveLength(1);
    expect(h.to('c3', 'whisper')).toHaveLength(0);

    await h.act('c1', { action: 'send', type: 'whisper', payload: {}, to: 'nobody' });
    expect(errorCode('c1')).toBe('player_not_found');
  });

  it('refuses messages from someone who is not in the room', async () => {
    await setupRoom(2, [['c2', 'bob']]);
    await h.connect('c9', 'mallory', 'Mallory');
    await h.act('c9', { action: 'send', type: 'move', payload: {} });
    expect(errorCode('c9')).toBe('not_in_room');
    expect(h.to('c1', 'move')).toHaveLength(0);
  });

  it('refuses reserved system types and oversized messages', async () => {
    await setupRoom(2, [['c2', 'bob']]);
    await h.act('c1', { action: 'send', type: 'game.started', payload: {} });
    expect(errorCode('c1')).toBe('invalid_message');
    await h.act('c1', { action: 'send', type: 'big', payload: { blob: 'x'.repeat(9000) } });
    expect(errorCode('c1')).toBe('message_too_large');
    expect(h.to('c2', 'game.started')).toHaveLength(0);
  });
});

describe('leaving', () => {
  it('tells the others, and hands host to the next player', async () => {
    await setupRoom(3, [['c2', 'bob'], ['c3', 'carol']]);
    await h.act('c1', { action: 'leaveRoom' });

    expect(h.to('c1', 'room.left')).toHaveLength(1);
    expect(h.last('c2', 'player.left').payload).toEqual({ userId: 'alice', reason: 'left' });
    expect(h.last('c2', 'host.changed').payload).toEqual({ userId: 'bob' });
  });

  it('deletes the room when the last player leaves', async () => {
    const code = await setupRoom();
    await h.act('c1', { action: 'leaveRoom' });

    await h.connect('c2', 'bob', 'Bob');
    await h.act('c2', { action: 'joinRoom', code });
    expect(errorCode('c2')).toBe('room_not_found');
  });

  it('frees the seat so someone else can take it', async () => {
    const code = await setupRoom(2, [['c2', 'bob']]);
    await h.act('c2', { action: 'leaveRoom' });
    await h.connect('c3', 'carol', 'Carol');
    await h.act('c3', { action: 'joinRoom', code });
    expect(h.room('c3', 'room.joined').players.map((p) => p.userId)).toEqual(['alice', 'carol']);
  });
});

describe('dropped connections and the grace period', () => {
  it('keeps the seat, lets the player come back, and announces both', async () => {
    const code = await setupRoom(2, [['c2', 'bob']]);
    await h.disconnect('c2');
    expect(h.last('c1', 'player.disconnected').payload).toEqual({ userId: 'bob', graceMs: 30_000 });

    h.clock.t += 10_000;
    await h.connect('c2b', 'bob', 'Bob');
    await h.act('c2b', { action: 'joinRoom', code });

    expect(h.last('c2b', 'room.joined').payload.reconnected).toBe(true);
    expect(h.last('c1', 'player.reconnected').payload).toEqual({ userId: 'bob' });
    expect(h.room('c2b', 'room.joined').players.every((p) => p.connected)).toBe(true);
  });

  it('removes the player after the grace period, when anyone is next active', async () => {
    await setupRoom(2, [['c2', 'bob']]);
    await h.disconnect('c2');
    h.clock.t += 31_000;
    await h.act('c1', { action: 'ping' });

    expect(h.last('c1', 'player.left').payload).toEqual({ userId: 'bob', reason: 'timeout' });
    expect(h.to('c1', 'pong')).toHaveLength(1);
  });

  it('moves host to a connected player when the host times out', async () => {
    await setupRoom(2, [['c2', 'bob']]);
    await h.disconnect('c1');
    h.clock.t += 31_000;
    await h.act('c2', { action: 'ping' });

    expect(h.last('c2', 'host.changed').payload).toEqual({ userId: 'bob' });
  });

  it('cleans up expired players on relayed messages too', async () => {
    await setupRoom(3, [['c2', 'bob'], ['c3', 'carol']]);
    await h.disconnect('c3');
    h.clock.t += 31_000;
    await h.act('c1', { action: 'send', type: 'tick', payload: {} });
    expect(h.last('c2', 'player.left').payload).toMatchObject({ userId: 'carol', reason: 'timeout' });
  });

  it('ignores the old connection closing after a page refresh took the seat', async () => {
    const code = await setupRoom(2, [['c2', 'bob']]);
    await h.connect('c2b', 'bob', 'Bob'); // refresh: new socket joins before the old one is noticed gone
    await h.act('c2b', { action: 'joinRoom', code });
    await h.disconnect('c2');

    expect(h.to('c1', 'player.disconnected')).toHaveLength(0);
    await h.act('c1', { action: 'send', type: 'hello', payload: {} });
    expect(h.to('c2b', 'hello')).toHaveLength(1);
    expect(h.to('c2', 'hello')).toHaveLength(0);
  });

  it('still lets a dropped player rejoin after the game has started', async () => {
    const code = await setupRoom(2, [['c2', 'bob']]);
    await h.act('c1', { action: 'start' });
    await h.disconnect('c2');
    await h.connect('c2b', 'bob', 'Bob');
    await h.act('c2b', { action: 'joinRoom', code });
    expect(h.last('c2b', 'room.joined').payload.reconnected).toBe(true);
    expect(h.room('c2b', 'room.joined').status).toBe('playing');
  });
});

describe('limits and errors', () => {
  it('rate limits a noisy connection', async () => {
    await h.connect('c1', 'alice', 'Alice');
    h.deps.rateLimitPerSec = 3;
    for (let i = 0; i < 4; i++) await h.act('c1', { action: 'ping' });
    expect(h.to('c1', 'pong')).toHaveLength(3);
    expect(errorCode('c1')).toBe('rate_limited');

    h.clock.t += 1000; // next second: allowed again
    await h.act('c1', { action: 'ping' });
    expect(h.to('c1', 'pong')).toHaveLength(4);
  });

  it('answers unknown actions and bad JSON with an error instead of failing', async () => {
    await h.connect('c1', 'alice', 'Alice');
    await h.act('c1', { action: 'hack' });
    expect(errorCode('c1')).toBe('unknown_action');
  });

  it('rejects an unauthenticated connect', async () => {
    const { routeEvent } = await import('../src/shared/router');
    const res = await routeEvent(h.deps, { routeKey: '$connect', connectionId: 'x' });
    expect(res.statusCode).toBe(401);
  });

  it('tells a connection that was never registered to reconnect', async () => {
    await h.act('ghost', { action: 'ping' });
    expect(errorCode('ghost')).toBe('not_connected');
  });
});
