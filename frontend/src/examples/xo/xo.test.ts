import { describe, expect, it } from 'vitest';
import {
  WINNING_LINES,
  applyMove,
  createGame,
  evaluateBoard,
  isFinished,
  otherMark,
  type GameState,
  type Mark,
} from './xo';

/** Plays a list of cells, alternating X then O, and returns the final state. Fails on any illegal move. */
function play(cells: number[]): GameState {
  let state = createGame();
  let mark: Mark = 'X';
  for (const cell of cells) {
    const result = applyMove(state, cell, mark);
    if (!result.ok) throw new Error(`Move ${cell} by ${mark} rejected: ${result.reason}`);
    state = result.state;
    mark = otherMark(mark);
  }
  return state;
}

describe('createGame', () => {
  it('starts with an empty board, X to move and no winner', () => {
    const game = createGame();
    expect(game.board).toHaveLength(9);
    expect(game.board.every((c) => c === null)).toBe(true);
    expect(game.turn).toBe('X');
    expect(game.winner).toBeNull();
    expect(game.winningLine).toBeNull();
  });

  it('returns a fresh board every time', () => {
    expect(createGame().board).not.toBe(createGame().board);
  });
});

describe('WINNING_LINES', () => {
  it('has the 8 distinct lines: 3 rows, 3 columns, 2 diagonals', () => {
    expect(WINNING_LINES).toHaveLength(8);
    expect(new Set(WINNING_LINES.map((l) => l.join(','))).size).toBe(8);
  });
});

describe('applyMove', () => {
  it('lets X move first and alternates turns', () => {
    const afterX = applyMove(createGame(), 4, 'X');
    expect(afterX.ok).toBe(true);
    if (!afterX.ok) return;
    expect(afterX.state.board[4]).toBe('X');
    expect(afterX.state.turn).toBe('O');

    const afterO = applyMove(afterX.state, 0, 'O');
    expect(afterO.ok).toBe(true);
    if (!afterO.ok) return;
    expect(afterO.state.board[0]).toBe('O');
    expect(afterO.state.turn).toBe('X');
  });

  it('does not mutate the input state', () => {
    const before = createGame();
    const snapshot = JSON.stringify(before);
    applyMove(before, 0, 'X');
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('rejects O moving first (wrong turn)', () => {
    expect(applyMove(createGame(), 0, 'O')).toEqual({ ok: false, reason: 'wrong_turn' });
  });

  it('rejects the same player moving twice in a row', () => {
    const state = play([0]);
    expect(applyMove(state, 1, 'X')).toEqual({ ok: false, reason: 'wrong_turn' });
  });

  it('rejects an occupied cell', () => {
    const state = play([4]);
    expect(applyMove(state, 4, 'O')).toEqual({ ok: false, reason: 'occupied' });
  });

  it('rejects cells outside the board and non-integers', () => {
    const game = createGame();
    for (const cell of [-1, 9, 100, 1.5, Number.NaN]) {
      expect(applyMove(game, cell, 'X')).toEqual({ ok: false, reason: 'out_of_range' });
    }
  });

  it('rejects any move once the game is won', () => {
    const won = play([0, 3, 1, 4, 2]); // X takes the top row
    expect(won.winner).toBe('X');
    expect(applyMove(won, 8, 'O')).toEqual({ ok: false, reason: 'game_over' });
    expect(applyMove(won, 8, 'X')).toEqual({ ok: false, reason: 'game_over' });
  });

  it('rejects any move once the game is a draw', () => {
    const drawn = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(drawn.winner).toBe('draw');
    expect(applyMove(drawn, 0, 'O')).toEqual({ ok: false, reason: 'game_over' });
  });
});

describe('win detection', () => {
  it('detects a row win and reports the line', () => {
    const state = play([0, 3, 1, 4, 2]);
    expect(state.winner).toBe('X');
    expect(state.winningLine).toEqual([0, 1, 2]);
  });

  it('detects a column win for O', () => {
    const state = play([0, 1, 2, 4, 8, 7]); // O takes 1, 4, 7
    expect(state.winner).toBe('O');
    expect(state.winningLine).toEqual([1, 4, 7]);
  });

  it('detects both diagonals', () => {
    expect(play([0, 1, 4, 2, 8]).winningLine).toEqual([0, 4, 8]);
    expect(play([2, 0, 4, 1, 6]).winningLine).toEqual([2, 4, 6]);
  });

  it('detects every one of the 8 lines', () => {
    for (const line of WINNING_LINES) {
      const board = Array.from({ length: 9 }, (_, i) => (line.includes(i) ? 'X' : null));
      expect(evaluateBoard(board)).toEqual({ winner: 'X', winningLine: line });
    }
  });

  it('prefers a win on the last cell over a draw', () => {
    // X: 0,1,6,4,8 and O: 2,3,5,7. The ninth move fills the board and completes the 0-4-8 diagonal.
    const state = play([0, 2, 1, 3, 6, 5, 4, 7, 8]);
    expect(state.board.every((c) => c !== null)).toBe(true);
    expect(state.winner).toBe('X');
    expect(state.winningLine).toEqual([0, 4, 8]);
  });

  it('reports no winner while the game is in progress', () => {
    const state = play([0, 4, 8]);
    expect(state.winner).toBeNull();
    expect(state.winningLine).toBeNull();
    expect(isFinished(state)).toBe(false);
  });
});

describe('draw detection', () => {
  it('reports a draw on a full board with no line', () => {
    const state = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(state.winner).toBe('draw');
    expect(state.winningLine).toBeNull();
    expect(isFinished(state)).toBe(true);
  });
});

describe('otherMark', () => {
  it('swaps X and O', () => {
    expect(otherMark('X')).toBe('O');
    expect(otherMark('O')).toBe('X');
  });
});
