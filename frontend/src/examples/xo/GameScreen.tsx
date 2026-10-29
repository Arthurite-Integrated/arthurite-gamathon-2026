import type { ClientSnapshot } from '../../realtime/RoomClient';
import { Board } from './Board';
import { canPlay, statusText, type GameView, type Roles } from './roles';
import { createGame } from './xo';

interface GameScreenProps {
  view: GameView;
  snapshot: ClientSnapshot;
  roles: Roles;
  roomCode: string;
  onCell: (cell: number) => void;
  onLeave: () => void;
}

const EMPTY_BOARD = createGame().board;

/** The live game: players, status, banners for dropped connections, and the board. */
export function GameScreen({ view, snapshot, roles, roomCode, onCell, onLeave }: GameScreenProps) {
  const ownConnectionLost = snapshot.connection === 'reconnecting';
  const opponentAway = roles.opponent !== null && !roles.opponent.connected;
  const game = view.game;

  return (
    <section className="card" aria-label="Game">
      <div className="game-head">
        <p className="muted">
          Room <strong data-testid="room-code">{roomCode}</strong>
        </p>
        <button className="link" data-testid="leave-room" onClick={onLeave}>
          Leave
        </button>
      </div>

      <ul className="marks" aria-label="Players">
        <li>
          <span className="mark mark-x" aria-hidden="true">X</span>
          <span>
            {roles.xPlayer.displayName}
            {roles.xPlayer.userId === roles.me.userId && <span className="badge">you</span>}
          </span>
        </li>
        <li>
          <span className="mark mark-o" aria-hidden="true">O</span>
          <span>
            {roles.oPlayer?.displayName ?? 'Opponent'}
            {roles.oPlayer?.userId === roles.me.userId && <span className="badge">you</span>}
          </span>
        </li>
      </ul>

      {ownConnectionLost && (
        <p className="banner" role="status" data-testid="banner-reconnecting">
          Reconnecting...
        </p>
      )}
      {!ownConnectionLost && opponentAway && (
        <p className="banner" role="status" data-testid="banner-opponent">
          Opponent reconnecting...
        </p>
      )}

      <p className="status" role="status" aria-live="polite" data-testid="status">
        {statusText(view, roles)}
      </p>

      <Board
        board={game?.board ?? EMPTY_BOARD}
        winningLine={game?.winningLine ?? null}
        enabled={canPlay(view, snapshot)}
        onCell={onCell}
      />
    </section>
  );
}
