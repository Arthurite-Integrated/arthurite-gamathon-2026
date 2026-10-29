import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  ConnItem,
  Deps,
  MetaItem,
  PlayerItem,
  PlayerView,
  RoomError,
  RoomView,
  ServerMessage,
} from './types';
import { DEFAULT_MAX_PLAYERS, MAX_PLAYERS, MIN_PLAYERS, Payload, sanitizeDisplayName } from './validate';

/** Room codes avoid I and O so they cannot be confused with 1 and 0. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const metaKey = (code: string) => ({ pk: `ROOM#${code}`, sk: 'META' });
const playerKey = (code: string, userId: string) => ({ pk: `ROOM#${code}`, sk: `PLAYER#${userId}` });
const connKey = (connectionId: string) => ({ pk: `CONN#${connectionId}`, sk: 'CONN' });

const isConditionFailed = (err: unknown): boolean => err instanceof ConditionalCheckFailedException;
const ttlFromNow = (deps: Deps, seconds: number) => Math.floor(deps.now() / 1000) + seconds;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function generateCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

async function getMeta(deps: Deps, code: string): Promise<MetaItem | undefined> {
  const res = await deps.db.send(new GetCommand({ TableName: deps.table, Key: metaKey(code), ConsistentRead: true }));
  return res.Item as MetaItem | undefined;
}

async function getPlayer(deps: Deps, code: string, userId: string): Promise<PlayerItem | undefined> {
  const res = await deps.db.send(
    new GetCommand({ TableName: deps.table, Key: playerKey(code, userId), ConsistentRead: true }),
  );
  return res.Item as PlayerItem | undefined;
}

async function listPlayers(deps: Deps, code: string): Promise<PlayerItem[]> {
  const res = await deps.db.send(
    new QueryCommand({
      TableName: deps.table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': `ROOM#${code}`, ':prefix': 'PLAYER#' },
      ConsistentRead: true,
    }),
  );
  const players = (res.Items ?? []) as PlayerItem[];
  return players.sort((a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId));
}

async function getConn(deps: Deps, connectionId: string): Promise<ConnItem | undefined> {
  const res = await deps.db.send(new GetCommand({ TableName: deps.table, Key: connKey(connectionId), ConsistentRead: true }));
  return res.Item as ConnItem | undefined;
}

async function requireConn(deps: Deps, connectionId: string): Promise<ConnItem> {
  const conn = await getConn(deps, connectionId);
  if (!conn) throw new RoomError('not_connected', 'Connection is not registered. Reconnect and try again.');
  return conn;
}

async function setConnRoom(deps: Deps, connectionId: string, code: string): Promise<void> {
  await deps.db.send(
    new UpdateCommand({
      TableName: deps.table,
      Key: connKey(connectionId),
      UpdateExpression: 'SET #code = :code',
      ExpressionAttributeNames: { '#code': 'code' },
      ExpressionAttributeValues: { ':code': code },
    }),
  );
}

async function clearConnRoom(deps: Deps, connectionId: string, code: string): Promise<void> {
  try {
    await deps.db.send(
      new UpdateCommand({
        TableName: deps.table,
        Key: connKey(connectionId),
        UpdateExpression: 'REMOVE #code',
        ConditionExpression: 'attribute_exists(pk) AND #code = :code',
        ExpressionAttributeNames: { '#code': 'code' },
        ExpressionAttributeValues: { ':code': code },
      }),
    );
  } catch (err) {
    if (!isConditionFailed(err)) throw err; // connection already gone or in another room
  }
}

/**
 * The room this connection really holds a seat in, or undefined. `conn.code` is only a pointer, and it goes
 * stale when the same account takes the seat on another connection (a second tab, a refreshed page) or when
 * the room is deleted. A stale pointer is cleared here, so it can never block the connection from creating
 * or joining a room.
 */
async function currentRoomCode(deps: Deps, connectionId: string, conn: ConnItem): Promise<string | undefined> {
  if (!conn.code) return undefined;
  const seat = await getPlayer(deps, conn.code, conn.userId);
  if (seat?.connectionId === connectionId) return conn.code;
  await clearConnRoom(deps, connectionId, conn.code);
  return undefined;
}

function pickHost(players: PlayerItem[]): PlayerItem | undefined {
  return players.find((p) => p.connected) ?? players[0];
}

function toView(meta: MetaItem, players: PlayerItem[]): RoomView {
  return {
    code: meta.code,
    maxPlayers: meta.maxPlayers,
    status: meta.status,
    hostId: meta.hostId,
    players: players.map(
      (p): PlayerView => ({
        userId: p.userId,
        displayName: p.displayName,
        connected: p.connected,
        isHost: p.userId === meta.hostId,
      }),
    ),
  };
}

async function broadcast(
  deps: Deps,
  players: PlayerItem[],
  message: ServerMessage,
  exceptUserId?: string,
): Promise<void> {
  await Promise.all(
    players
      .filter((p) => p.connected && p.userId !== exceptUserId)
      .map((p) => deps.send(p.connectionId, message)),
  );
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/** Counts messages per connection per second. Throws rate_limited when over the limit. */
export async function checkRate(deps: Deps, connectionId: string): Promise<void> {
  const second = Math.floor(deps.now() / 1000);
  const res = await deps.db.send(
    new UpdateCommand({
      TableName: deps.table,
      Key: { pk: `RL#${connectionId}#${second}`, sk: 'RL' },
      UpdateExpression: 'ADD n :one SET #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':one': 1, ':ttl': second + 60 },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  if (((res.Attributes?.n as number | undefined) ?? 0) > deps.rateLimitPerSec) {
    throw new RoomError('rate_limited', 'Too many messages. Slow down.');
  }
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

export async function registerConnection(
  deps: Deps,
  input: { connectionId: string; userId: string; displayName: string },
): Promise<void> {
  const item: ConnItem = {
    pk: connKey(input.connectionId).pk,
    sk: 'CONN',
    connectionId: input.connectionId,
    userId: input.userId,
    displayName: input.displayName,
    ttl: ttlFromNow(deps, 3 * 60 * 60), // API Gateway closes WebSocket connections after 2 hours
  };
  await deps.db.send(new PutCommand({ TableName: deps.table, Item: item }));
}

/**
 * A dropped connection does not remove the player. They are marked disconnected and keep their
 * seat for the grace period. If they reconnect (joinRoom with the same code) they get it back.
 */
export async function handleDisconnect(deps: Deps, connectionId: string): Promise<void> {
  const conn = await getConn(deps, connectionId);
  await deps.db.send(new DeleteCommand({ TableName: deps.table, Key: connKey(connectionId) }));
  if (!conn?.code) return;

  const code = conn.code;
  try {
    await deps.db.send(
      new UpdateCommand({
        TableName: deps.table,
        Key: playerKey(code, conn.userId),
        UpdateExpression: 'SET connected = :no, disconnectedAt = :at, #ttl = :ttl',
        // Only if this connection still owns the seat. A newer connection may have taken over.
        ConditionExpression: 'attribute_exists(pk) AND connectionId = :cid',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':no': false,
          ':at': deps.now(),
          ':cid': connectionId,
          ':ttl': ttlFromNow(deps, deps.roomTtlSeconds),
        },
      }),
    );
  } catch (err) {
    if (isConditionFailed(err)) return;
    throw err;
  }

  const players = await listPlayers(deps, code);
  await broadcast(
    deps,
    players,
    { type: 'player.disconnected', payload: { userId: conn.userId, graceMs: deps.graceMs } },
    conn.userId,
  );
}

// ---------------------------------------------------------------------------
// Removing players
// ---------------------------------------------------------------------------

async function removePlayer(deps: Deps, code: string, userId: string, reason: 'left' | 'timeout'): Promise<void> {
  const del = await deps.db.send(
    new DeleteCommand({ TableName: deps.table, Key: playerKey(code, userId), ReturnValues: 'ALL_OLD' }),
  );
  const old = del.Attributes as PlayerItem | undefined;
  if (!old) return; // someone else already removed them

  await clearConnRoom(deps, old.connectionId, code);

  let meta: MetaItem;
  try {
    const upd = await deps.db.send(
      new UpdateCommand({
        TableName: deps.table,
        Key: metaKey(code),
        UpdateExpression: 'ADD playerCount :minus',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeValues: { ':minus': -1 },
        ReturnValues: 'ALL_NEW',
      }),
    );
    meta = upd.Attributes as MetaItem;
  } catch (err) {
    if (isConditionFailed(err)) return;
    throw err;
  }

  if (meta.playerCount <= 0) {
    await deps.db.send(new DeleteCommand({ TableName: deps.table, Key: metaKey(code) }));
    return;
  }

  const remaining = await listPlayers(deps, code);
  await broadcast(deps, remaining, { type: 'player.left', payload: { userId, reason } });

  if (meta.hostId === userId) {
    const next = pickHost(remaining);
    if (next) {
      try {
        await deps.db.send(
          new UpdateCommand({
            TableName: deps.table,
            Key: metaKey(code),
            UpdateExpression: 'SET hostId = :next',
            ConditionExpression: 'hostId = :old',
            ExpressionAttributeValues: { ':next': next.userId, ':old': userId },
          }),
        );
        await broadcast(deps, remaining, { type: 'host.changed', payload: { userId: next.userId } });
      } catch (err) {
        if (!isConditionFailed(err)) throw err;
      }
    }
  }
}

/**
 * Removes players whose grace period has run out. Called on every join, start, ping and relayed
 * message, so a dropped player is cleaned up as soon as anyone in the room is active.
 * Returns the players who are still in the room.
 */
async function sweep(deps: Deps, code: string, players: PlayerItem[]): Promise<PlayerItem[]> {
  const now = deps.now();
  const expired = players.filter((p) => !p.connected && p.disconnectedAt !== undefined && now - p.disconnectedAt > deps.graceMs);
  for (const p of expired) await removePlayer(deps, code, p.userId, 'timeout');
  return expired.length === 0 ? players : players.filter((p) => !expired.includes(p));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function createRoom(
  deps: Deps,
  connectionId: string,
  input: { maxPlayers?: number; displayName?: string },
): Promise<RoomView> {
  const conn = await requireConn(deps, connectionId);
  if (await currentRoomCode(deps, connectionId, conn)) {
    throw new RoomError('already_in_room', 'Leave your current room before creating another');
  }

  const maxPlayers = input.maxPlayers ?? DEFAULT_MAX_PLAYERS;
  if (!Number.isInteger(maxPlayers) || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
    throw new RoomError('invalid_message', `maxPlayers must be from ${MIN_PLAYERS} to ${MAX_PLAYERS}`);
  }
  const displayName = sanitizeDisplayName(input.displayName, conn.displayName);
  const now = deps.now();

  let meta: MetaItem | undefined;
  for (let attempt = 0; attempt < 8 && !meta; attempt++) {
    const code = generateCode(deps.random);
    const candidate: MetaItem = {
      ...metaKey(code),
      sk: 'META',
      code,
      hostId: conn.userId,
      maxPlayers,
      status: 'waiting',
      playerCount: 1,
      createdAt: now,
      ttl: ttlFromNow(deps, deps.roomTtlSeconds),
    };
    try {
      await deps.db.send(
        new PutCommand({ TableName: deps.table, Item: candidate, ConditionExpression: 'attribute_not_exists(pk)' }),
      );
      meta = candidate;
    } catch (err) {
      if (!isConditionFailed(err)) throw err; // code collision, try another
    }
  }
  if (!meta) throw new RoomError('internal_error', 'Could not allocate a room code. Try again.');

  const player: PlayerItem = {
    ...playerKey(meta.code, conn.userId),
    userId: conn.userId,
    displayName,
    connectionId,
    joinedAt: now,
    connected: true,
    ttl: meta.ttl,
  };
  await deps.db.send(new PutCommand({ TableName: deps.table, Item: player }));
  await setConnRoom(deps, connectionId, meta.code);

  const view = toView(meta, [player]);
  await deps.send(connectionId, { type: 'room.created', payload: { room: view, you: conn.userId } });
  return view;
}

export async function joinRoom(
  deps: Deps,
  connectionId: string,
  input: { code: string; displayName?: string },
): Promise<RoomView> {
  const conn = await requireConn(deps, connectionId);
  const { code } = input;
  const current = await currentRoomCode(deps, connectionId, conn);
  if (current && current !== code) {
    throw new RoomError('already_in_room', 'Leave your current room before joining another');
  }

  // Remove anyone whose grace period ran out, which may free a seat or delete the room.
  const before = await listPlayers(deps, code);
  await sweep(deps, code, before);

  const meta = await getMeta(deps, code);
  if (!meta) throw new RoomError('room_not_found', `No room with code ${code}`);

  const displayName = sanitizeDisplayName(input.displayName, conn.displayName);
  const existing = await getPlayer(deps, code, conn.userId);

  if (existing) {
    // Reconnect: take the seat back on this connection (also covers a page refresh).
    const wasDisconnected = !existing.connected;
    await deps.db.send(
      new UpdateCommand({
        TableName: deps.table,
        Key: playerKey(code, conn.userId),
        UpdateExpression: 'SET connectionId = :cid, connected = :yes, #ttl = :ttl REMOVE disconnectedAt',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':cid': connectionId, ':yes': true, ':ttl': ttlFromNow(deps, deps.roomTtlSeconds) },
      }),
    );
    await setConnRoom(deps, connectionId, code);
    const players = await listPlayers(deps, code);
    const view = toView(meta, players);
    await deps.send(connectionId, {
      type: 'room.joined',
      payload: { room: view, you: conn.userId, reconnected: true },
    });
    if (wasDisconnected) {
      await broadcast(deps, players, { type: 'player.reconnected', payload: { userId: conn.userId } }, conn.userId);
    }
    return view;
  }

  if (meta.status !== 'waiting') throw new RoomError('room_locked', 'This game has already started');

  // Reserve a seat atomically so two simultaneous joins cannot overfill the room.
  try {
    await deps.db.send(
      new UpdateCommand({
        TableName: deps.table,
        Key: metaKey(code),
        UpdateExpression: 'ADD playerCount :one',
        ConditionExpression: 'attribute_exists(pk) AND playerCount < maxPlayers AND #status = :waiting',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':one': 1, ':waiting': 'waiting' },
      }),
    );
  } catch (err) {
    if (!isConditionFailed(err)) throw err;
    const fresh = await getMeta(deps, code);
    if (!fresh) throw new RoomError('room_not_found', `No room with code ${code}`);
    if (fresh.status !== 'waiting') throw new RoomError('room_locked', 'This game has already started');
    throw new RoomError('room_full', 'This room is full');
  }

  const player: PlayerItem = {
    ...playerKey(code, conn.userId),
    userId: conn.userId,
    displayName,
    connectionId,
    joinedAt: deps.now(),
    connected: true,
    ttl: meta.ttl,
  };
  await deps.db.send(new PutCommand({ TableName: deps.table, Item: player }));
  await setConnRoom(deps, connectionId, code);

  const players = await listPlayers(deps, code);
  const view = toView({ ...meta, playerCount: players.length }, players);
  await deps.send(connectionId, { type: 'room.joined', payload: { room: view, you: conn.userId, reconnected: false } });
  await broadcast(
    deps,
    players,
    { type: 'player.joined', payload: { userId: conn.userId, displayName, room: view } },
    conn.userId,
  );
  return view;
}

export async function leaveRoom(deps: Deps, connectionId: string): Promise<void> {
  const conn = await requireConn(deps, connectionId);
  if (!conn.code) throw new RoomError('not_in_room', 'You are not in a room');
  const code = conn.code;
  // Only give up the seat if this connection holds it. A stale connection just forgets the room, so it
  // cannot throw out the same account's seat on another connection.
  if ((await currentRoomCode(deps, connectionId, conn)) === code) {
    await removePlayer(deps, code, conn.userId, 'left');
  }
  await deps.send(connectionId, { type: 'room.left', payload: { code } });
}

export async function startGame(deps: Deps, connectionId: string, settings: Payload): Promise<void> {
  const conn = await requireConn(deps, connectionId);
  if (!conn.code) throw new RoomError('not_in_room', 'You are not in a room');
  const code = conn.code;

  const players = await sweep(deps, code, await listPlayers(deps, code));
  const meta = await getMeta(deps, code);
  if (!meta) throw new RoomError('room_not_found', 'This room no longer exists');
  if (meta.hostId !== conn.userId) throw new RoomError('not_host', 'Only the host can start the game');
  if (meta.status !== 'waiting') throw new RoomError('room_locked', 'The game has already started');
  if (players.filter((p) => p.connected).length < MIN_PLAYERS) {
    throw new RoomError('not_enough_players', `At least ${MIN_PLAYERS} connected players are needed to start`);
  }

  const seed = Math.floor(deps.random() * 2 ** 32);
  try {
    await deps.db.send(
      new UpdateCommand({
        TableName: deps.table,
        Key: metaKey(code),
        UpdateExpression: 'SET #status = :playing, seed = :seed',
        ConditionExpression: '#status = :waiting AND hostId = :host',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':playing': 'playing', ':waiting': 'waiting', ':seed': seed, ':host': conn.userId },
      }),
    );
  } catch (err) {
    if (isConditionFailed(err)) throw new RoomError('room_locked', 'The game has already started');
    throw err;
  }

  const view = toView({ ...meta, status: 'playing', seed }, players);
  await broadcast(deps, players, { type: 'game.started', payload: { seed, room: view, settings } });
}

export async function relay(
  deps: Deps,
  connectionId: string,
  input: { type: string; payload: Payload; to?: string },
): Promise<void> {
  const conn = await requireConn(deps, connectionId);
  if (!conn.code) throw new RoomError('not_in_room', 'You are not in a room');
  const code = conn.code;

  const players = await sweep(deps, code, await listPlayers(deps, code));
  const sender = players.find((p) => p.userId === conn.userId && p.connectionId === connectionId);
  if (!sender) throw new RoomError('not_in_room', 'You are not in this room');

  const message: ServerMessage = { type: input.type, payload: input.payload, from: conn.userId };

  if (input.to !== undefined) {
    const target = players.find((p) => p.userId === input.to);
    if (!target) throw new RoomError('player_not_found', 'That player is not in the room');
    if (target.connected) await deps.send(target.connectionId, message);
    return;
  }
  await broadcast(deps, players, message, conn.userId);
}

/** Keeps the connection alive, cleans up expired players, and answers with a pong. */
export async function ping(deps: Deps, connectionId: string): Promise<void> {
  const conn = await requireConn(deps, connectionId);
  if (conn.code) await sweep(deps, conn.code, await listPlayers(deps, conn.code));
  await deps.send(connectionId, { type: 'pong', payload: { t: deps.now() } });
}
