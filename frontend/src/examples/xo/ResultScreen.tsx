import { Board } from './Board';
import { RESULT_TEXT, type GameResult, type GameView } from './roles';
import { createGame } from './xo';

interface ResultScreenProps {
  result: GameResult;
  view: GameView;
  roomCode: string;
  onBack: () => void;
}

const EMPTY_BOARD = createGame().board;

/** Shown when the game ends. The room is locked, so a new game means a new room from the lobby. */
export function ResultScreen({ result, view, roomCode, onBack }: ResultScreenProps) {
  const forfeited = view.forfeit && !(view.game && view.game.winner !== null);
  return (
    <section className="card" aria-label="Game result">
      <p className="muted">
        Room <strong data-testid="room-code">{roomCode}</strong>
      </p>

      <h2 className={`result result-${result}`} role="status" data-testid="result">
        {RESULT_TEXT[result]}
      </h2>
      {forfeited && <p className="muted" data-testid="result-detail">Your opponent left the game.</p>}

      <Board board={view.game?.board ?? EMPTY_BOARD} winningLine={view.game?.winningLine ?? null} enabled={false} onCell={() => undefined} />

      <button data-testid="back-to-lobby" onClick={onBack}>
        Back to lobby
      </button>
    </section>
  );
}
