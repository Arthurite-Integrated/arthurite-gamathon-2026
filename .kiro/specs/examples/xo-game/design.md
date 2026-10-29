# Design: 2-Player Online XO

Implements `requirements.md`. Everything lives in `frontend/src/examples/xo/`; the backend is untouched.

## Layering

```
App.tsx
  └─ XoGame.tsx            owns the RoomClient session (useRoom) + GameController, picks the screen
       ├─ Lobby.tsx        create / join / players / Start
       ├─ GameScreen.tsx   board, status, roles, banners, Leave
       └─ ResultScreen.tsx result text, final board, Back to lobby

useGame.ts                 React binding for GameController (useSyncExternalStore)
controller.ts              GameController: host-authoritative protocol, no React
messages.ts                typed message union, payload validation, typed send/on over a transport
xo.ts                      pure engine
roles.ts                   pure helpers: roles, status text, result, canPlay
errors.ts                  RoomClientError.code -> plain-language text
```

Dependencies only point downward. `xo.ts` imports nothing. `controller.ts` and `messages.ts` depend on a
narrow `GameTransport` interface that `RoomClient` satisfies structurally (`getSnapshot`, `on`, `send`), so
the protocol logic is unit-testable with a fake transport and never touches a WebSocket (R0.2).

## Engine (`xo.ts`)

```ts
type Mark = 'X' | 'O';  type Cell = Mark | null;  type Winner = Mark | 'draw' | null;
type GameState = { board: readonly Cell[]; turn: Mark; winner: Winner; winningLine: readonly number[] | null };
createGame(): GameState
applyMove(state, cell, player): { ok: true; state } | { ok: false; reason }
reason: 'game_over' | 'out_of_range' | 'wrong_turn' | 'occupied'
```

`applyMove` never mutates its input. The turn flips after every accepted move (including the last one);
`winner`/`winningLine` are recomputed from the board by `evaluateBoard`.

## Messages (`messages.ts`)

```ts
type SyncedState = GameState & { seq: number }
type GameMessage =
  | { type: 'move';  payload: { cell: number } }
  | { type: 'state'; payload: SyncedState }
  | { type: 'sync';  payload: {} }
```

- `sendGameMessage(transport, message, to?)` is the only way app code sends.
- `onGameMessage(transport, handler)` subscribes to the three types, runs `parseGameMessage` (rejects wrong
  shapes: bad cell, board not 9 valid cells, bad turn/winner/line, non-integer seq) and calls
  `handler(message, from)`. Malformed messages and messages without `from` are dropped.

## Protocol (`controller.ts`)

`GameController` holds the view `{ game: SyncedState | null, forfeit: boolean }` as an immutable snapshot
(`getView`/`subscribe`, compatible with `useSyncExternalStore`). It reads room/user from
`transport.getSnapshot()` at the moment it needs them, so it never caches stale room data.

| Event | Reaction |
| --- | --- |
| `room.created`, `room.joined` (not reconnected), `room.left` | reset view |
| `room.joined` with `reconnected: true` | send `sync` (the server now has us seated again) |
| `game.started` | host: new game `seq 0`, send `state` to the opponent. Guest: start a retry loop that sends `sync` every second until a state arrives |
| `move` (host only) | sender must be the other seated player; `applyMove(.., 'O')`; on success `seq+1`, store, send `state`; otherwise ignore |
| `state` | accept only if validated and `seq` > held `seq` (or none held); stop retry loop |
| `sync` | if holding a state, reply with it to the sender only |
| `player.reconnected` | host with a state re-sends `state` to that player |
| `player.left` (other player, room playing, game not finished) | `forfeit = true` |
| `host.changed` to me | if holding a state, send it to the opponent and continue as host |
| `client.reconnected` | send `sync`; host also re-sends its `state` (covers a send lost while offline) |

Host press: `playCell(cell)` runs the same `applyMove` path with `'X'`, bumps `seq`, stores, sends `state`.
Guest press: `playCell(cell)` sends `move` to `room.hostId` and waits for the host's `state`; it never
applies the move locally. Every `send` is wrapped so a dropped socket (`not_connected`) does not crash the
UI; resync repairs the state afterwards.

`seq` ordering: the host increments by exactly 1 per change; clients ignore equal or lower `seq`, which makes
duplicates (sync replies, re-sends) harmless and fixes out-of-order delivery.

## Screens and state machine (`XoGame.tsx`)

```
connect error / connection closed        -> ConnectionProblem  (Retry remounts the session = new RoomClient)
connecting / idle                        -> "Connecting..."
open, no room or room.status = waiting   -> Lobby
room.status = playing, game finished
  or forfeit                             -> ResultScreen
room.status = playing                    -> GameScreen
```

- Overlay on GameScreen: `connection === 'reconnecting'` -> banner "Reconnecting..."; opponent
  `connected === false` -> banner "Opponent reconnecting...". Both pause input via `canPlay`.
- `canPlay(view, snapshot)`: connection open, room playing, game held and not finished, no forfeit,
  opponent connected, and `game.turn === myMark`.
- Leave / Back to lobby: `client.leaveRoom()` (so the server frees our seat; the opponent sees
  `player.left` and wins by forfeit), then `controller.reset()`. If leaving fails, the session is remounted.
- Result: win/lose/draw derives from `game.winner` vs my mark, or `forfeit` -> win. A finished game is never
  overwritten by a later `player.left`.

## Roles

`X` = `room.hostId`, `O` = the other player. Derived from the live room, so they follow `host.changed`
(only reachable when the other player left, which already ends the game by forfeit).

## Errors

`errors.ts` maps codes to sentences: `room_full`, `room_not_found`, `room_locked`, `not_host`,
`not_enough_players`, `already_in_room`, `not_in_room`, `invalid_message`, `rate_limited`, `timeout`,
`not_connected`, `connect_failed`, with a generic fallback. The raw code is never the only thing shown.

## Accessibility and layout

Board cells are `<button>`s in a CSS grid with `aria-label` ("Row 1, column 2: empty"). Cells are `disabled`
when occupied or input is paused. Status and banners use `role="status"`. `main` is already 480px max width;
the board is `width: min(100%, 360px)` with square cells, so it fits 320px-wide screens. Winning cells get a
`win` class with a non-color cue (bold outline) as well as a color.

## Testing

- `xo.test.ts`: engine (required).
- `messages.test.ts`: validation of every message type.
- `controller.test.ts`: host/guest flow through a fake in-memory hub: first state, moves, illegal moves,
  out-of-order `seq`, sync, reconnect, host change, forfeit.
- `roles.test.ts`: status text, result, `canPlay`.
- A one-off end-to-end run against the real local realtime server (two `RoomClient`s) verifies the wiring;
  it is not kept in the repo.
