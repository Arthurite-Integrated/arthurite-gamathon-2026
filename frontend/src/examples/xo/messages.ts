import type { ClientSnapshot, Handler } from '../../realtime/RoomClient';
import { BOARD_SIZE, type Cell, type GameState, type Mark, type Winner } from './xo';

/**
 * The part of RoomClient the game needs. RoomClient satisfies it structurally, so app code passes the
 * real client in production and a fake in unit tests. There is no other way to reach the backend.
 */
export interface GameTransport {
  getSnapshot(): ClientSnapshot;
  on(type: string, handler: Handler): () => void;
  send(type: string, payload?: Record<string, unknown>, to?: string): void;
}

/** A game state plus the counter that orders changes. The host raises `seq` by 1 on every change. */
export type SyncedState = GameState & { readonly seq: number };

export type MovePayload = { readonly cell: number };
export type StatePayload = {
  readonly board: readonly Cell[];
  readonly turn: Mark;
  readonly winner: Winner;
  readonly winningLine: readonly number[] | null;
  readonly seq: number;
};
export type SyncPayload = Record<string, never>;

/** Every app message of the game. `move` and `state` carry the data, `sync` asks for a `state`. */
export type GameMessage =
  | { readonly type: 'move'; readonly payload: MovePayload }
  | { readonly type: 'state'; readonly payload: StatePayload }
  | { readonly type: 'sync'; readonly payload: SyncPayload };

export type GameMessageType = GameMessage['type'];
export const GAME_MESSAGE_TYPES: readonly GameMessageType[] = ['move', 'state', 'sync'];

// ---- Validation (incoming payloads come from another browser and are never trusted) ----

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isMark = (value: unknown): value is Mark => value === 'X' || value === 'O';
const isCell = (value: unknown): value is Cell => value === null || isMark(value);
const isWinner = (value: unknown): value is Winner => value === null || value === 'draw' || isMark(value);
const isCellIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < BOARD_SIZE;

function parseState(payload: Record<string, unknown>): StatePayload | null {
  const { board, turn, winner, winningLine, seq } = payload;
  if (!Array.isArray(board) || board.length !== BOARD_SIZE || !board.every(isCell)) return null;
  if (!isMark(turn) || !isWinner(winner)) return null;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return null;
  let line: readonly number[] | null = null;
  if (winningLine !== null) {
    if (!Array.isArray(winningLine) || winningLine.length !== 3 || !winningLine.every(isCellIndex)) return null;
    line = winningLine;
  }
  return { board, turn, winner, winningLine: line, seq };
}

/** Turns a raw relayed message into a typed one, or null when it is not a valid game message. */
export function parseGameMessage(type: string, payload: unknown): GameMessage | null {
  if (!isRecord(payload)) return null;
  switch (type) {
    case 'move':
      return isCellIndex(payload.cell) ? { type: 'move', payload: { cell: payload.cell } } : null;
    case 'state': {
      const state = parseState(payload);
      return state ? { type: 'state', payload: state } : null;
    }
    case 'sync':
      return { type: 'sync', payload: {} };
    default:
      return null;
  }
}

// ---- Typed send / on ----

/** Sends one game message to everyone else, or only to `to`. Throws if the socket is not open. */
export function sendGameMessage(transport: GameTransport, message: GameMessage, to?: string): void {
  transport.send(message.type, { ...message.payload }, to);
}

/**
 * Listens for the game's messages. Messages that fail validation, or that have no sender, are dropped.
 * Returns an unsubscribe function.
 */
export function onGameMessage(
  transport: GameTransport,
  handler: (message: GameMessage, from: string) => void,
): () => void {
  const offs = GAME_MESSAGE_TYPES.map((type) =>
    transport.on(type, (payload, raw) => {
      if (typeof raw.from !== 'string') return;
      const message = parseGameMessage(type, payload);
      if (message) handler(message, raw.from);
    }),
  );
  return () => offs.forEach((off) => off());
}
