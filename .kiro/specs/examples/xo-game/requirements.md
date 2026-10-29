# Requirements — 2-Player Online XO (Tic-Tac-Toe)

A two-player online tic-tac-toe game built in `/frontend` on top of the existing realtime rooms
layer. All game rules live in the frontend; the backend is an unmodified generic relay.

## Guiding constraints (non-negotiable)

- R0.1 The backend under `/backend` is NOT modified.
- R0.2 The frontend talks to the backend ONLY through `RoomClient` and the `useRoom` hook. No raw
  `WebSocket` is opened anywhere in app code.
- R0.3 `App.tsx` replaces `RoomPlayground` with the real game flow, while keeping the existing
  sign-in flow (Cognito and the `devAuth` local-dev path) working. `RoomPlayground.tsx` is removed
  from the app.
- R0.4 TypeScript strict, no `any`. `npm run build` and `npm test` stay green.
- R0.5 Styling reuses the existing `styles.css` design language (cards, buttons, badges, colors)
  and works on a phone-width screen.
- R0.6 Out of scope: chat, spectators, AI opponent, rankings, sound, more than 2 players.

## 1. Game engine (`src/examples/xo/xo.ts`) — pure TypeScript

- R1.1 No React and no DOM imports. Pure functions and types only.
- R1.2 Board is a fixed-length array of 9 cells. Each cell is `'X'`, `'O'`, or empty (`null`).
- R1.3 `X` always moves first.
- R1.4 There are 8 winning lines (3 rows, 3 columns, 2 diagonals).
- R1.5 Game state captures: `board`, `turn` (whose move it is), `winner` (`'X' | 'O' | 'draw' | null`),
  and `winningLine` (the 3 cell indexes of the winning line, or `null`).
- R1.6 A function returns the initial state (empty board, `turn = 'X'`, no winner).
- R1.7 A pure `applyMove(state, cell, player)` returns a **new** state (immutable; never mutates the
  input) with the move applied, the turn flipped, and winner/draw/winningLine recomputed.
- R1.8 Illegal moves are rejected (the engine signals rejection rather than returning a mutated
  state): a move on an occupied cell, a move by the player whose turn it is not, a move with an
  out-of-range cell index, and any move after the game is already over (win or draw).
- R1.9 Win detection: the first completed line fixes the winner and `winningLine`.
- R1.10 Draw detection: board full with no winner yields `winner = 'draw'`.
- R1.11 Unit tested with vitest: first move is X, turn alternation, each category of illegal move,
  a horizontal/vertical/diagonal win with the correct `winningLine`, a draw, immutability of input,
  and that no move is accepted once the game is over.

## 2. Message protocol (`src/examples/xo/messages.ts`) — typed union

- R2.1 A discriminated union of the app message types, plus typed `send`/`on` wrappers around
  `RoomClient` so the rest of the app is type-safe (no stringly-typed payloads leak out).
- R2.2 `move` `{ cell: number }` — sent by the non-host to the host only, via
  `client.send('move', { cell }, hostId)`.
- R2.3 `state` `{ board, turn, winner, winningLine, seq }` — sent by the host to the other player
  after every valid move and at game start. `seq` increases by 1 on every change.
- R2.4 `sync` `{}` — broadcast by a client that holds no state after joining or reconnecting.
- R2.5 The wrapper validates/narrows incoming payloads defensively (messages are untrusted and may
  be malformed) and ignores anything that does not match the expected shape.

## 3. Multiplayer design (host-authoritative)

- R3.1 The host is `X`; the other player is `O`. Role is derived from `room.hostId` vs `userId`.
- R3.2 The host validates every incoming `move` against the engine (right player's turn, empty cell,
  game not over). Valid moves are applied, `seq` is incremented, and a `state` is broadcast. Invalid
  moves are ignored silently.
- R3.3 When the host presses a cell, it applies the move locally through the same engine path and
  broadcasts `state`.
- R3.4 Every client stores the latest `state` it has seen and accepts an incoming `state` only when
  its `seq` is strictly greater than the one currently held (guards against out-of-order delivery).
- R3.5 On `game.started`, the host broadcasts the first `state` (fresh empty board, `seq = 0`).
- R3.6 On `host.changed`, the new host continues from the last `state` it holds and becomes
  authoritative from then on.
- R3.7 Resync: after `client.reconnected`, or whenever a client has no state, it sends `sync`. Any
  client holding a state replies with its current `state`. When the host sees `player.reconnected`,
  it re-sends `state`.

## 4. Screens

### 4.1 Lobby
- Create a room (host, `maxPlayers = 2`).
- Join with a 4-letter code, uppercased as typed; Join enabled only with a 4-letter code.
- Shows who is in the room (display name, host badge, you badge, reconnecting badge).
- Host sees a Start button, enabled only with 2 players present.
- Plain-language error messages for at least: `room_full`, `room_not_found`, `room_locked`,
  `not_host`, `not_enough_players` (and a sensible fallback for other codes).

### 4.2 Game
- 3x3 board of real `<button>` elements, keyboard accessible and operable.
- Status line: e.g. `Your turn (X)` / `Waiting for Bob (O)`.
- Shows which player is X and which is O, the room code, and a Leave button.
- Winning cells are highlighted when the game ends in a win.
- Works on a phone-width screen.

### 4.3 Result
- Shows `You win!`, `You lose`, or `Draw`.
- `Back to lobby` button. (The backend locks a started room, so a rematch means returning to the
  lobby and creating/joining a new room — there is no in-room rematch.)

## 5. Disconnect handling

- R5.1 Opponent connection drops (`player.disconnected`): show `Opponent reconnecting...` and pause
  input.
- R5.2 Opponent returns (`player.reconnected`): hide the banner and continue; host re-sends `state`.
- R5.3 Opponent leaves or times out (`player.left`): local player wins by forfeit.
- R5.4 Own connection drops: show `Reconnecting...` until `client.reconnected`, then resync via `sync`.

## 6. Test IDs (for automated testing)

`room-code`, `create-room`, `join-input`, `join-room`, `start-game`, `cell-0` … `cell-8`, `status`,
`result`, `leave-room`.

## 7. Verification

- R7.1 `npm run build` (tsc + vite) passes.
- R7.2 `npm test` (vitest) passes, including the engine unit tests.
- R7.3 Manual local play is possible: two tabs at `?as=alice` / `?as=bob` against the local realtime
  server can create/join, start, play a full game, and reach a result.

## Open questions / assumptions (please confirm or correct)

- A0.1 **No in-game rematch.** A new game requires returning to the lobby and creating/joining a new
  room, because the backend locks a started room. (Stated in the task; calling it out explicitly.)
- A0.2 **Tests for the engine only.** Per your instruction not to add tests unless requested, I will
  add vitest unit tests for the pure engine (explicitly requested) and will not add React component
  tests unless you want them.
- A0.3 **Forfeit is terminal.** When the opponent leaves/times out mid-game, the local player sees a
  win-by-forfeit result and returns to the lobby; there is no "waiting to see if they rejoin after
  leaving" state (leaving is distinct from a transient disconnect).
- A0.4 **`seq` starts at 0** for the game-start state and increments by 1 per change.
