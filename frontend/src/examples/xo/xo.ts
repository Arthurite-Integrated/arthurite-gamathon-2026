/**
 * Pure tic-tac-toe engine. No React, no DOM, no I/O.
 *
 * Cells are numbered 0..8, left to right, top to bottom:
 *   0 1 2
 *   3 4 5
 *   6 7 8
 */

export type Mark = 'X' | 'O';
export type Cell = Mark | null;
export type Winner = Mark | 'draw' | null;

export interface GameState {
  readonly board: readonly Cell[];
  /** Whose move it is next. Flips after every accepted move. */
  readonly turn: Mark;
  /** 'X' or 'O' when someone completed a line, 'draw' when the board is full, otherwise null. */
  readonly winner: Winner;
  /** The three cells of the winning line, or null when there is no winner. */
  readonly winningLine: readonly number[] | null;
}

export type MoveRejection = 'game_over' | 'out_of_range' | 'wrong_turn' | 'occupied';

export type MoveResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly reason: MoveRejection };

export const BOARD_SIZE = 9;

export const WINNING_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function createGame(): GameState {
  return { board: Array<Cell>(BOARD_SIZE).fill(null), turn: 'X', winner: null, winningLine: null };
}

export function otherMark(mark: Mark): Mark {
  return mark === 'X' ? 'O' : 'X';
}

export function isFinished(state: Pick<GameState, 'winner'>): boolean {
  return state.winner !== null;
}

/** Works out the winner (or a draw) of a board. The first completed line wins. */
export function evaluateBoard(board: readonly Cell[]): Pick<GameState, 'winner' | 'winningLine'> {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark !== null && mark === board[b] && mark === board[c]) {
      return { winner: mark, winningLine: line };
    }
  }
  if (board.every((cell) => cell !== null)) return { winner: 'draw', winningLine: null };
  return { winner: null, winningLine: null };
}

/**
 * Applies a move and returns the new state, or the reason it was refused.
 * The input state is never modified.
 */
export function applyMove(state: GameState, cell: number, player: Mark): MoveResult {
  if (state.winner !== null) return { ok: false, reason: 'game_over' };
  if (!Number.isInteger(cell) || cell < 0 || cell >= BOARD_SIZE) return { ok: false, reason: 'out_of_range' };
  if (player !== state.turn) return { ok: false, reason: 'wrong_turn' };
  if (state.board[cell] !== null) return { ok: false, reason: 'occupied' };

  const board = state.board.map((existing, index) => (index === cell ? player : existing));
  const { winner, winningLine } = evaluateBoard(board);
  return { ok: true, state: { board, turn: otherMark(player), winner, winningLine } };
}
