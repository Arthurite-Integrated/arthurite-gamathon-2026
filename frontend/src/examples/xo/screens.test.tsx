import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RoomClient, type ClientSnapshot, type RoomInfo } from '../../realtime/RoomClient';
import { GameScreen } from './GameScreen';
import { Lobby } from './Lobby';
import { ResultScreen } from './ResultScreen';
import type { SyncedState } from './messages';
import { getRoles, type GameView } from './roles';
import { createGame } from './xo';

const noop = () => undefined;
// Never connected: the screens only call it from event handlers.
const client = new RoomClient({ url: 'ws://localhost:0', getToken: async () => 'unused' });

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

const state = (over: Partial<SyncedState> = {}): SyncedState => ({ ...createGame(), seq: 0, ...over });
const view = (over: Partial<GameView> = {}): GameView => ({ game: state(), forfeit: false, ...over });

function renderGame(userId: string, v: GameView, snap: ClientSnapshot = snapshot(userId)) {
  const roles = getRoles(snap.room, userId)!;
  return renderToStaticMarkup(<GameScreen view={v} snapshot={snap} roles={roles} roomCode="ABCD" onCell={noop} onLeave={noop} />);
}

describe('Lobby', () => {
  it('offers create and join before there is a room', () => {
    const html = renderToStaticMarkup(<Lobby client={client} snapshot={snapshot('alice', { room: null })} />);
    for (const id of ['create-room', 'join-input', 'join-room']) expect(html).toContain(`data-testid="${id}"`);
    expect(html).not.toContain('data-testid="start-game"');
  });

  it('shows the code, players, and Start for the host, disabled with one player', () => {
    const waiting = room({ status: 'waiting', players: [{ userId: 'alice', displayName: 'Alice', connected: true, isHost: true }] });
    const html = renderToStaticMarkup(<Lobby client={client} snapshot={snapshot('alice', { room: waiting })} />);
    expect(html).toContain('data-testid="room-code"');
    expect(html).toContain('ABCD');
    expect(html).toContain('Alice');
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="start-game"/);
    expect(html).toContain('data-testid="leave-room"');
  });

  it('enables Start for the host with two players, and hides it from the guest', () => {
    const waiting = room({ status: 'waiting' });
    const host = renderToStaticMarkup(<Lobby client={client} snapshot={snapshot('alice', { room: waiting })} />);
    expect(host).toMatch(/<button(?![^>]*disabled)[^>]*data-testid="start-game"/);
    const guest = renderToStaticMarkup(<Lobby client={client} snapshot={snapshot('bob', { room: waiting })} />);
    expect(guest).not.toContain('data-testid="start-game"');
    expect(guest).toContain('Waiting for the host');
  });
});

describe('GameScreen', () => {
  it('renders nine button cells, the status, room code and Leave', () => {
    const html = renderGame('alice', view());
    for (let i = 0; i < 9; i++) expect(html).toMatch(new RegExp(`<button[^>]*data-testid="cell-${i}"`));
    for (const id of ['status', 'room-code', 'leave-room']) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain('Your turn (X)');
    expect(html).toContain('Alice');
    expect(html).toContain('Bob');
  });

  it('enables empty cells on my turn and disables them otherwise', () => {
    expect(renderGame('alice', view())).toMatch(/<button(?![^>]*disabled)[^>]*data-testid="cell-0"/);
    const guest = renderGame('bob', view());
    expect(guest).toMatch(/<button[^>]*disabled[^>]*data-testid="cell-0"/);
    expect(guest).toContain('Waiting for Alice (X)');
  });

  it('shows the opponent banner and pauses input while the opponent is away', () => {
    const away = room({
      players: [
        { userId: 'alice', displayName: 'Alice', connected: true, isHost: true },
        { userId: 'bob', displayName: 'Bob', connected: false, isHost: false },
      ],
    });
    const html = renderGame('alice', view(), snapshot('alice', { room: away }));
    expect(html).toContain('Opponent reconnecting...');
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="cell-0"/);
  });

  it('shows the reconnecting banner and pauses input when my connection dropped', () => {
    const html = renderGame('alice', view(), snapshot('alice', { connection: 'reconnecting' }));
    expect(html).toContain('Reconnecting...');
    expect(html).not.toContain('Opponent reconnecting...');
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="cell-0"/);
  });

  it('shows a starting message while the first state has not arrived', () => {
    expect(renderGame('bob', view({ game: null }))).toContain('Starting the game...');
  });
});

describe('ResultScreen', () => {
  const won = view({ game: state({ winner: 'X', winningLine: [0, 1, 2], board: ['X', 'X', 'X', 'O', 'O', null, null, null, null] }) });

  it('shows the result, the winning cells and a way back', () => {
    const html = renderToStaticMarkup(<ResultScreen result="win" view={won} roomCode="ABCD" onBack={noop} />);
    expect(html).toMatch(/data-testid="result"[^>]*>You win!</);
    expect(html).toContain('data-testid="back-to-lobby"');
    for (const cell of [0, 1, 2]) expect(html).toMatch(new RegExp(`class="[^"]*win[^"]*"[^>]*data-testid="cell-${cell}"`));
    expect(html).not.toMatch(/class="[^"]*win[^"]*"[^>]*data-testid="cell-3"/);
  });

  it('uses the exact texts for lose, draw and forfeit', () => {
    const lose = renderToStaticMarkup(<ResultScreen result="lose" view={won} roomCode="ABCD" onBack={noop} />);
    expect(lose).toMatch(/data-testid="result"[^>]*>You lose</);
    const draw = renderToStaticMarkup(<ResultScreen result="draw" view={view({ game: state({ winner: 'draw' }) })} roomCode="ABCD" onBack={noop} />);
    expect(draw).toMatch(/data-testid="result"[^>]*>Draw</);
    const forfeit = renderToStaticMarkup(<ResultScreen result="win" view={view({ forfeit: true })} roomCode="ABCD" onBack={noop} />);
    expect(forfeit).toContain('Your opponent left the game.');
  });
});
