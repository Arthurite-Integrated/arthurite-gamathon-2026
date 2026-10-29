import { useCallback, useState } from 'react';
import { useRoom } from '../../realtime/useRoom';
import { GameScreen } from './GameScreen';
import { Lobby } from './Lobby';
import { ResultScreen } from './ResultScreen';
import { getResult, getRoles } from './roles';
import { useGame } from './useGame';

/**
 * The whole XO flow: lobby -> game -> result. It owns one realtime session. "Try again" (or a failed
 * "Back to lobby") remounts the session, which opens a brand new connection.
 */
export function XoGame() {
  const [attempt, setAttempt] = useState(0);
  return <XoSession key={attempt} onRestart={() => setAttempt((n) => n + 1)} />;
}

function XoSession({ onRestart }: { onRestart: () => void }) {
  const { client, snapshot, error } = useRoom();
  const { controller, view } = useGame(client);
  const { connection, room, userId } = snapshot;

  /** Leave the room (the opponent then wins by forfeit if the game was still on) and go to the lobby. */
  const backToLobby = useCallback(async () => {
    try {
      if (client.getSnapshot().room) await client.leaveRoom();
      controller.reset();
    } catch {
      onRestart();
    }
  }, [client, controller, onRestart]);

  if (error || connection === 'closed') {
    return (
      <section className="card" aria-labelledby="conn-title">
        <h2 id="conn-title">Connection problem</h2>
        <p className="error" role="alert" data-testid="connection-error">
          {error ?? 'The connection to the game server was lost.'}
        </p>
        <button onClick={onRestart} data-testid="retry-connection">
          Try again
        </button>
      </section>
    );
  }

  if (connection === 'idle' || connection === 'connecting') {
    return (
      <p className="muted" role="status" data-testid="connecting">
        Connecting...
      </p>
    );
  }

  const roles = getRoles(room, userId);

  if (room && room.status === 'playing' && roles) {
    const result = getResult(view, roles.myMark);
    if (result) {
      return <ResultScreen result={result} view={view} roomCode={room.code} onBack={() => void backToLobby()} />;
    }
    return (
      <GameScreen
        view={view}
        snapshot={snapshot}
        roles={roles}
        roomCode={room.code}
        onCell={(cell) => controller.playCell(cell)}
        onLeave={() => void backToLobby()}
      />
    );
  }

  return (
    <>
      {connection === 'reconnecting' && (
        <p className="banner" role="status" data-testid="banner-reconnecting">
          Reconnecting...
        </p>
      )}
      <Lobby client={client} snapshot={snapshot} />
    </>
  );
}
