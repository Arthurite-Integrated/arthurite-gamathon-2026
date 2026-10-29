import { RoomError } from './types';

export const MAX_MESSAGE_BYTES = 8192;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const DEFAULT_MAX_PLAYERS = 2;

/** App message types may not start with these; the backend uses them for system events. */
export const RESERVED_PREFIXES = ['room.', 'player.', 'host.', 'game.', 'system.'];
export const RESERVED_TYPES = ['error', 'pong'];

const TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const CODE_PATTERN = /^[A-Z]{4}$/;

export type Payload = Record<string, unknown>;

export type ClientMessage =
  | { action: 'createRoom'; maxPlayers: number; displayName?: string }
  | { action: 'joinRoom'; code: string; displayName?: string }
  | { action: 'leaveRoom' }
  | { action: 'start'; settings: Payload }
  | { action: 'ping' }
  | { action: 'send'; type: string; payload: Payload; to?: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sanitizeDisplayName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function normalizeCode(raw: unknown): string {
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!CODE_PATTERN.test(code)) {
    throw new RoomError('invalid_message', 'Room code must be exactly 4 letters');
  }
  return code;
}

export function validateAppType(type: unknown): string {
  if (typeof type !== 'string' || !TYPE_PATTERN.test(type)) {
    throw new RoomError('invalid_message', 'type must be 1-64 characters: letters, digits, _ . : -');
  }
  const lower = type.toLowerCase();
  if (RESERVED_TYPES.includes(lower) || RESERVED_PREFIXES.some((p) => lower.startsWith(p))) {
    throw new RoomError('invalid_message', `type "${type}" is reserved for system events`);
  }
  return type;
}

/** Parse and validate the raw WebSocket frame body sent by a client. */
export function parseClientMessage(body: string | undefined | null): ClientMessage {
  if (typeof body !== 'string' || body.length === 0) {
    throw new RoomError('invalid_message', 'Empty message');
  }
  if (Buffer.byteLength(body, 'utf8') > MAX_MESSAGE_BYTES) {
    throw new RoomError('message_too_large', `Messages are limited to ${MAX_MESSAGE_BYTES} bytes`);
  }

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new RoomError('invalid_message', 'Message must be valid JSON');
  }
  if (!isPlainObject(data)) throw new RoomError('invalid_message', 'Message must be a JSON object');

  switch (data.action) {
    case 'createRoom': {
      const maxPlayers = data.maxPlayers ?? DEFAULT_MAX_PLAYERS;
      if (!Number.isInteger(maxPlayers) || (maxPlayers as number) < MIN_PLAYERS || (maxPlayers as number) > MAX_PLAYERS) {
        throw new RoomError('invalid_message', `maxPlayers must be an integer from ${MIN_PLAYERS} to ${MAX_PLAYERS}`);
      }
      return {
        action: 'createRoom',
        maxPlayers: maxPlayers as number,
        displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
      };
    }
    case 'joinRoom':
      return {
        action: 'joinRoom',
        code: normalizeCode(data.code),
        displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
      };
    case 'leaveRoom':
      return { action: 'leaveRoom' };
    case 'ping':
      return { action: 'ping' };
    case 'start': {
      const settings = data.settings ?? {};
      if (!isPlainObject(settings)) throw new RoomError('invalid_message', 'settings must be an object');
      return { action: 'start', settings };
    }
    case 'send': {
      const type = validateAppType(data.type);
      const payload = data.payload ?? {};
      if (!isPlainObject(payload)) throw new RoomError('invalid_message', 'payload must be an object');
      let to: string | undefined;
      if (data.to !== undefined) {
        if (typeof data.to !== 'string' || data.to.length === 0 || data.to.length > 128) {
          throw new RoomError('invalid_message', 'to must be a userId string');
        }
        to = data.to;
      }
      return { action: 'send', type, payload, to };
    }
    default:
      throw new RoomError('unknown_action', 'Unknown action');
  }
}
