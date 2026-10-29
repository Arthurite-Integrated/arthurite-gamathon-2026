import type { Cell } from './xo';

interface BoardProps {
  board: readonly Cell[];
  winningLine: readonly number[] | null;
  /** When false every cell is disabled (not my turn, paused, or the game is over). */
  enabled: boolean;
  onCell: (cell: number) => void;
}

function describeCell(index: number, value: Cell): string {
  const row = Math.floor(index / 3) + 1;
  const column = (index % 3) + 1;
  return `Row ${row}, column ${column}: ${value ?? 'empty'}`;
}

/** The 3x3 grid. Every cell is a real button, so it works with the keyboard and screen readers. */
export function Board({ board, winningLine, enabled, onCell }: BoardProps) {
  return (
    <div className="board" role="group" aria-label="Game board">
      {board.map((value, index) => {
        const isWinning = winningLine?.includes(index) ?? false;
        const classes = ['cell', value ? `cell-${value.toLowerCase()}` : '', isWinning ? 'win' : ''].filter(Boolean);
        return (
          <button
            key={index}
            type="button"
            className={classes.join(' ')}
            disabled={!enabled || value !== null}
            onClick={() => onCell(index)}
            aria-label={describeCell(index, value)}
            data-testid={`cell-${index}`}
            data-win={isWinning ? 'true' : undefined}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}
