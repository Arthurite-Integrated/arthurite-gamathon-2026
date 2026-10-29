import { describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot, Handler } from '../../realtime/RoomClient';
import { onGameMessage, parseGameMessage, sendGameMessage, type GameTransport } from './messages';
import { createGame } from './xo';

const validState = { ...createGame(), seq: 3 };

describe('parseGameMessage', () => {
  it('accepts a valid move', () => {
    expect(parseGameMessage('move', { cell: 4 })).toEqual({ type: 'move', payload: { cell: 4 } });
  });

  it.each([[-1], [9], [1.5], ['3'], [null], [undefined]])('rejects move with cell %j', (cell) => {
    expect(parseGameMessage('move', { cell })).toBeNull();
  });

  it('accepts a valid state, including a finished one', () => {
    expect(parseGameMessage('state', validState)).toEqual({ type: 'state', payload: validState });
    const won = {
      board: ['X', 'X', 'X', 'O', 'O', null, null, null, null],
      turn: 'O',
      winner: 'X',
      winningLine: [0, 1, 2],
      seq: 5,
    };
    expect(parseGameMessage('state', won)?.type).toBe('state');
  });

  it('rejects malformed states', () => {
    const bad: Array<Record<string, unknown>> = [
      { ...validState, board: ['X'] },
      { ...validState, board: Array(9).fill('Z') },
      { ...validState, turn: 'Z' },
      { ...validState, winner: 'Y' },
      { ...validState, winningLine: [0, 1] },
      { ...validState, winningLine: [0, 1, 99] },
      { ...validState, seq: -1 },
      { ...validState, seq: 1.5 },
      { ...validState, seq: '1' },
      { board: validState.board },
    ];
    for (const payload of bad) expect(parseGameMessage('state', payload)).toBeNull();
  });

  it('accepts sync with any object payload', () => {
    expect(parseGameMessage('sync', {})).toEqual({ type: 'sync', payload: {} });
  });

  it('rejects unknown types and non-object payloads', () => {
    expect(parseGameMessage('chat', {})).toBeNull();
    expect(parseGameMessage('move', null)).toBeNull();
    expect(parseGameMessage('move', [4])).toBeNull();
    expect(parseGameMessage('state', 'x')).toBeNull();
  });
});

function fakeTransport() {
  const handlers = new Map<string, Handler>();
  const send = vi.fn();
  const transport: GameTransport = {
    getSnapshot: () => ({ connection: 'open', userId: 'a', room: null, seed: null }) satisfies ClientSnapshot,
    on: (type, handler) => {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
    send,
  };
  const deliver = (type: string, payload: Record<string, unknown>, from?: string) =>
    handlers.get(type)?.(payload, { type, payload, ...(from ? { from } : {}) });
  return { transport, send, deliver, handlers };
}

describe('sendGameMessage', () => {
  it('sends the type and payload, with an optional recipient', () => {
    const { transport, send } = fakeTransport();
    sendGameMessage(transport, { type: 'move', payload: { cell: 2 } }, 'host');
    expect(send).toHaveBeenCalledWith('move', { cell: 2 }, 'host');
    sendGameMessage(transport, { type: 'sync', payload: {} });
    expect(send).toHaveBeenLastCalledWith('sync', {}, undefined);
  });
});

describe('onGameMessage', () => {
  it('delivers valid messages with their sender', () => {
    const { transport, deliver } = fakeTransport();
    const handler = vi.fn();
    onGameMessage(transport, handler);
    deliver('move', { cell: 7 }, 'bob');
    expect(handler).toHaveBeenCalledWith({ type: 'move', payload: { cell: 7 } }, 'bob');
  });

  it('drops invalid messages and messages without a sender', () => {
    const { transport, deliver } = fakeTransport();
    const handler = vi.fn();
    onGameMessage(transport, handler);
    deliver('move', { cell: 99 }, 'bob');
    deliver('move', { cell: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const { transport, deliver, handlers } = fakeTransport();
    const handler = vi.fn();
    const off = onGameMessage(transport, handler);
    off();
    expect(handlers.size).toBe(0);
    deliver('sync', {}, 'bob');
    expect(handler).not.toHaveBeenCalled();
  });
});
