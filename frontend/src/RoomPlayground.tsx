import { useEffect, useState, type FormEvent } from 'react';
import { RoomClientError } from './realtime/RoomClient';
import { useRoom } from './realtime/useRoom';

/**
 * A tiny, game-agnostic screen that exercises the whole realtime backend: create or join a room,
 * see who is in it, start, and send chat messages. Use it to check your deployment, then copy the
 * pattern (useRoom + client.on + client.send) into your own game screens and delete this file.
 */
export function RoomPlayground() {
  const { client, snapshot, error: connectError } = useRoom();
  const { connection, room, userId, seed } = snapshot;

  const [code, setCode] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [chat, setChat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(
    () =>
      client.on('*', (payload, message) => {
        if (message.type === 'pong') return;
        const who = message.from ? `${message.from}` : 'server';
        setLog((lines) => [...lines.slice(-39), `${who}: ${message.type} ${JSON.stringify(payload)}`]);
      }),
    [client],
  );

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof RoomClientError ? `${err.message} (${err.code})` : 'Something went wrong');
    }
  }

  function sendChat(e: FormEvent) {
    e.preventDefault();
    if (!chat.trim()) return;
    void run(async () => {
      client.send('chat', { text: chat.trim() });
      setLog((lines) => [...lines.slice(-39), `me: chat ${JSON.stringify({ text: chat.trim() })}`]);
      setChat('');
    });
  }

  const isHost = room !== null && room.hostId === userId;
  const connected = connection === 'open';

  return (
    <section className="card" aria-label="Realtime rooms">
      <h2>Realtime rooms</h2>
      <p className="muted" data-testid="connection">
        Connection: {connection}
        {userId ? ` as ${userId}` : ''}
      </p>
      {connectError && <p className="error" role="alert">{connectError}</p>}

      {!room && (
        <>
          <div className="row">
            <label>
              Players
              <select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} data-testid="max-players">
                {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <button disabled={!connected} data-testid="create-room" onClick={() => run(() => client.createRoom({ maxPlayers }))}>
              Create room
            </button>
          </div>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => client.joinRoom(code));
            }}
          >
            <label>
              Room code
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={4}
                placeholder="ABCD"
                data-testid="join-input"
              />
            </label>
            <button type="submit" disabled={!connected || code.length !== 4} data-testid="join-room">
              Join
            </button>
          </form>
        </>
      )}

      {room && (
        <>
          <p>
            Room <strong data-testid="room-code">{room.code}</strong> · {room.status} · {room.players.length}/{room.maxPlayers}
          </p>
          <ul className="players" data-testid="players">
            {room.players.map((p) => (
              <li key={p.userId}>
                {p.displayName}
                {p.isHost && <span className="badge">host</span>}
                {p.userId === userId && <span className="badge">you</span>}
                {!p.connected && <span className="badge warn">reconnecting</span>}
              </li>
            ))}
          </ul>
          {seed !== null && <p className="muted" data-testid="seed">Shared seed: {seed}</p>}

          <div className="row">
            {isHost && room.status === 'waiting' && (
              <button data-testid="start-game" onClick={() => run(() => client.start({}))}>
                Start game
              </button>
            )}
            <button className="link" data-testid="leave-room" onClick={() => run(() => client.leaveRoom())}>
              Leave room
            </button>
          </div>

          <form className="row" onSubmit={sendChat}>
            <input value={chat} onChange={(e) => setChat(e.target.value)} placeholder="Send a message" data-testid="chat-input" />
            <button type="submit" data-testid="chat-send">Send</button>
          </form>
        </>
      )}

      {error && <p className="error" role="alert" data-testid="error">{error}</p>}

      <pre className="log" data-testid="log" aria-label="Event log">{log.join('\n') || 'Events will appear here.'}</pre>
    </section>
  );
}
