import { useState, type FormEvent } from 'react';
import type { ClientSnapshot, RoomClient } from '../../realtime/RoomClient';
import { describeError } from './errors';

interface LobbyProps {
  client: RoomClient;
  snapshot: ClientSnapshot;
}

/** Create a room, join one by code, see who is in it, and (as host) start the game. */
export function Lobby({ client, snapshot }: LobbyProps) {
  const { room, userId, connection } = snapshot;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = connection === 'open';
  const isHost = room !== null && room.hostId === userId;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  function join(e: FormEvent) {
    e.preventDefault();
    if (code.length === 4) void run(() => client.joinRoom(code));
  }

  if (!room) {
    return (
      <section className="card" aria-labelledby="lobby-title">
        <h2 id="lobby-title">Play XO</h2>
        <p className="muted">Create a room and share the code, or join a friend&apos;s room.</p>

        <button disabled={!connected || busy} data-testid="create-room" onClick={() => run(() => client.createRoom({ maxPlayers: 2 }))}>
          Create room
        </button>

        <form className="row" onSubmit={join}>
          <label>
            Room code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              maxLength={4}
              placeholder="ABCD"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              data-testid="join-input"
            />
          </label>
          <button type="submit" disabled={!connected || busy || code.length !== 4} data-testid="join-room">
            Join room
          </button>
        </form>

        {error && (
          <p className="error" role="alert" data-testid="error">
            {error}
          </p>
        )}
      </section>
    );
  }

  const canStart = isHost && room.players.length >= 2;

  return (
    <section className="card" aria-labelledby="lobby-title">
      <h2 id="lobby-title">Waiting room</h2>
      <p>
        Room code <strong className="room-code" data-testid="room-code">{room.code}</strong>
      </p>
      <p className="muted">Share this code with your opponent.</p>

      <ul className="players" data-testid="players" aria-label="Players in the room">
        {room.players.map((p) => (
          <li key={p.userId}>
            {p.displayName}
            {p.isHost && <span className="badge">host</span>}
            {p.userId === userId && <span className="badge">you</span>}
            {!p.connected && <span className="badge warn">reconnecting</span>}
          </li>
        ))}
      </ul>

      {room.players.length < 2 && <p className="muted" role="status">Waiting for another player to join...</p>}
      {!isHost && room.players.length >= 2 && <p className="muted" role="status">Waiting for the host to start the game...</p>}

      <div className="row">
        {isHost && (
          <button disabled={!canStart || busy} data-testid="start-game" onClick={() => run(() => client.start({}))}>
            Start game
          </button>
        )}
        <button className="link" disabled={busy} data-testid="leave-room" onClick={() => run(() => client.leaveRoom())}>
          Leave room
        </button>
      </div>

      {error && (
        <p className="error" role="alert" data-testid="error">
          {error}
        </p>
      )}
    </section>
  );
}
