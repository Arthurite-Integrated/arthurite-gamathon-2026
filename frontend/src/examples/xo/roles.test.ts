import { describe, expect, it } from 'vitest';
import type { ClientSnapshot, RoomInfo } from '../../realtime/RoomClient';
import type { SyncedState } from './messages';
import { RESULT_TEXT, canPlay, getResult, getRoles, isGameOver, statusText, type GameView } from './roles';
import { createGame } from './xo';

const room = (over: Partial<RoomInfo> = {}): RoomInfo => ({
  code: 'ABCD',
  maxPlayers: 2,
  status: 'playing',
  hostId: 'alice',
  players: [
    { userId: 'alice', displayName: 'Alice', connected: true, isHost: true },
    { userId: 'bob', displayName: 'Bob', connected: true, isHost: false },
  ],
  ...over,
});

const snapshot = (userId: string, over: Partial<ClientSnapshot> = {}): ClientSnapshot => ({
  connection: 'open',
  userId,
  room: room(),
  seed: null,
  ...over,
});

const game = (over: Partial<SyncedState> = {}): SyncedState => ({ ...createGame(), seq: 0, ...over });
const view = (over: Partial<GameView> = {}): GameView => ({ game: game(), forfeit: false, ...over });

describe('getRoles', () => {
  it('makes the host X and the other player O', () => {
    const host = getRoles(room(), 'alice')!;
    expect(host.myMark).toBe('X');
    expect(host.opponentMark).toBe('O');
    expect(host.xPlayer.displayName).toBe('Alice');
    expect(host.oPlayer?.displayName).toBe('Bob');

    const guest = getRoles(room(), 'bob')!;
    expect(guest.myMark).toBe('O');
    expect(guest.opponent?.displayName).toBe('Alice');
    expect(guest.xPlayer.displayName).toBe('Alice');
    expect(guest.oPlayer?.displayName).toBe('Bob');
  });

  it('has no opponent while alone, and no roles when not in the room', () => {
    const alone = room({ players: [{ userId: 'alice', displayName: 'Alice', connected: true, isHost: true }] });
    expect(getRoles(alone, 'alice')).toMatchObject({ opponent: null, oPlayer: null });
    expect(getRoles(room(), 'carol')).toBeNull();
    expect(getRoles(null, 'alice')).toBeNull();
    expect(getRoles(room(), null)).toBeNull();
  });
});

describe('statusText', () => {
  it('says whose turn it is', () => {
    const host = getRoles(room(), 'alice')!;
    const guest = getRoles(room(), 'bob')!;
    expect(statusText(view(), host)).toBe('Your turn (X)');
    expect(statusText(view(), guest)).toBe('Waiting for Alice (X)');
    const afterX = view({ game: game({ turn: 'O' }) });
    expect(statusText(afterX, host)).toBe('Waiting for Bob (O)');
    expect(statusText(afterX, guest)).toBe('Your turn (O)');
  });

  it('says the game is starting before the first state arrives', () => {
    expect(statusText(view({ game: null }), getRoles(room(), 'bob')!)).toBe('Starting the game...');
  });
});

describe('getResult', () => {
  it('is null while the game is going', () => {
    expect(getResult(view(), 'X')).toBeNull();
    expect(isGameOver(view())).toBe(false);
  });

  it('is win, lose or draw from the local player point of view', () => {
    const won = view({ game: game({ winner: 'X', winningLine: [0, 1, 2] }) });
    expect(getResult(won, 'X')).toBe('win');
    expect(getResult(won, 'O')).toBe('lose');
    expect(getResult(view({ game: game({ winner: 'draw' }) }), 'O')).toBe('draw');
    expect(isGameOver(won)).toBe(true);
  });

  it('is a win when the opponent forfeits', () => {
    expect(getResult(view({ forfeit: true }), 'O')).toBe('win');
    expect(isGameOver(view({ forfeit: true }))).toBe(true);
  });

  it('uses the exact texts from the spec', () => {
    expect(RESULT_TEXT).toEqual({ win: 'You win!', lose: 'You lose', draw: 'Draw' });
  });
});

describe('canPlay', () => {
  it('is true only on my turn in a live game', () => {
    expect(canPlay(view(), snapshot('alice'))).toBe(true);
    expect(canPlay(view(), snapshot('bob'))).toBe(false);
  });

  it('is false while my connection is not open', () => {
    expect(canPlay(view(), snapshot('alice', { connection: 'reconnecting' }))).toBe(false);
    expect(canPlay(view(), snapshot('alice', { connection: 'closed' }))).toBe(false);
  });

  it('is false while the opponent is disconnected', () => {
    const away = room({
      players: [
        { userId: 'alice', displayName: 'Alice', connected: true, isHost: true },
        { userId: 'bob', displayName: 'Bob', connected: false, isHost: false },
      ],
    });
    expect(canPlay(view(), snapshot('alice', { room: away }))).toBe(false);
  });

  it('is false with no state, a finished game, a forfeit, or a room that is not playing', () => {
    expect(canPlay(view({ game: null }), snapshot('alice'))).toBe(false);
    expect(canPlay(view({ game: game({ winner: 'draw' }) }), snapshot('alice'))).toBe(false);
    expect(canPlay(view({ forfeit: true }), snapshot('alice'))).toBe(false);
    expect(canPlay(view(), snapshot('alice', { room: room({ status: 'waiting' }) }))).toBe(false);
    expect(canPlay(view(), snapshot('alice', { room: null }))).toBe(false);
  });
});
