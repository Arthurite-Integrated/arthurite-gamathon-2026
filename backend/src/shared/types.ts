import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** Everything the realtime layer sends to clients has this shape. */
export interface ServerMessage {
  type: string;
  payload: Record<string, unknown>;
  /** userId of the sender, present on app messages relayed from another player */
  from?: string;
}

export type RoomStatus = 'waiting' | 'playing';

export interface PlayerView {
  userId: string;
  displayName: string;
  connected: boolean;
  isHost: boolean;
}

export interface RoomView {
  code: string;
  maxPlayers: number;
  status: RoomStatus;
  hostId: string;
  players: PlayerView[];
}

export type ErrorCode =
  | 'invalid_message'
  | 'unknown_action'
  | 'message_too_large'
  | 'rate_limited'
  | 'not_connected'
  | 'room_not_found'
  | 'room_full'
  | 'room_locked'
  | 'not_in_room'
  | 'already_in_room'
  | 'not_host'
  | 'not_enough_players'
  | 'player_not_found'
  | 'internal_error';

/** An expected, client-facing failure. Anything else is an internal error. */
export class RoomError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RoomError';
  }
}

/** Everything the domain logic needs, injected so tests can run it without AWS. */
export interface Deps {
  db: DynamoDBDocumentClient;
  table: string;
  /** Deliver a message to one connection. Resolves false if the connection is gone. */
  send: (connectionId: string, message: ServerMessage) => Promise<boolean>;
  now: () => number;
  random: () => number;
  /** How long a dropped player can come back before being removed. */
  graceMs: number;
  /** Max messages per connection per second. */
  rateLimitPerSec: number;
  /** Lifetime of room records (seconds); DynamoDB TTL removes them afterwards. */
  roomTtlSeconds: number;
}

// ---- Stored items (single table) ----

export interface MetaItem {
  pk: string; // ROOM#<code>
  sk: 'META';
  code: string;
  hostId: string;
  maxPlayers: number;
  status: RoomStatus;
  playerCount: number;
  seed?: number;
  createdAt: number;
  ttl: number;
}

export interface PlayerItem {
  pk: string; // ROOM#<code>
  sk: string; // PLAYER#<userId>
  userId: string;
  displayName: string;
  connectionId: string;
  joinedAt: number;
  connected: boolean;
  disconnectedAt?: number;
  ttl: number;
}

export interface ConnItem {
  pk: string; // CONN#<connectionId>
  sk: 'CONN';
  connectionId: string;
  userId: string;
  displayName: string;
  code?: string;
  ttl: number;
}
