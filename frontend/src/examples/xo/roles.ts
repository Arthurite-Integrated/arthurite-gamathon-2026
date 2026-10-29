import type { ClientSnapshot, PlayerInfo, RoomInfo } from '../../realtime/RoomClient';
import type { SyncedState } from './messages';
import { isFinished, otherMark, type Mark } from './xo';

/** What the controller knows about the current game. Immutable: a new object on every change. */
export interface GameView {
  /** The latest state this client has seen, or null before the first one arrives. */
  readonly game: SyncedState | null;
  /** True when the opponent left or timed out before the game finished, so the local player wins. */
  readonly forfeit: boolean;
}

export const EMPTY_VIEW: GameView = { game: null, forfeit: false };

export type GameResult = 'win' | 'lose' | 'draw';

export interface Roles {
  readonly me: PlayerInfo;
  readonly opponent: PlayerInfo | null;
  readonly myMark: Mark;
  readonly opponentMark: Mark;
  readonly xPlayer: PlayerInfo;
  readonly oPlayer: PlayerInfo | null;
}

/** The host plays X and the other player plays O. Returns null when this user is not in the room. */
export function getRoles(room: RoomInfo | null, userId: string | null): Roles | null {
  if (!room || !userId) return null;
  const me = room.players.find((p) => p.userId === userId);
  if (!me) return null;
  const isHost = room.hostId === userId;
  const opponent = room.players.find((p) => p.userId !== userId) ?? null;
  const myMark: Mark = isHost ? 'X' : 'O';
  return {
    me,
    opponent,
    myMark,
    opponentMark: otherMark(myMark),
    xPlayer: isHost ? me : (opponent ?? me),
    oPlayer: isHost ? opponent : me,
  };
}

/** True when the local player may press a cell right now. */
export function canPlay(view: GameView, snapshot: ClientSnapshot): boolean {
  const roles = getRoles(snapshot.room, snapshot.userId);
  const { game } = view;
  return (
    snapshot.connection === 'open' &&
    snapshot.room?.status === 'playing' &&
    roles !== null &&
    roles.opponent !== null &&
    roles.opponent.connected &&
    game !== null &&
    !isFinished(game) &&
    !view.forfeit &&
    game.turn === roles.myMark
  );
}

/** The result for the local player, or null while the game is still going. */
export function getResult(view: GameView, myMark: Mark): GameResult | null {
  if (view.game && isFinished(view.game)) {
    if (view.game.winner === 'draw') return 'draw';
    return view.game.winner === myMark ? 'win' : 'lose';
  }
  return view.forfeit ? 'win' : null;
}

export function isGameOver(view: GameView): boolean {
  return view.forfeit || (view.game !== null && isFinished(view.game));
}

export const RESULT_TEXT: Record<GameResult, string> = {
  win: 'You win!',
  lose: 'You lose',
  draw: 'Draw',
};

/** The one-line status above the board. */
export function statusText(view: GameView, roles: Roles): string {
  if (!view.game) return 'Starting the game...';
  const opponentName = roles.opponent?.displayName || 'your opponent';
  return view.game.turn === roles.myMark
    ? `Your turn (${roles.myMark})`
    : `Waiting for ${opponentName} (${roles.opponentMark})`;
}
