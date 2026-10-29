# XO (tic-tac-toe): a worked example on the rooms layer

A complete 2-player online game. It exists to show the patterns, so copy from it when you build your own game, and delete the folder when you do not need it (nothing else imports it).

## Try it

In `src/App.tsx`, import `XoGame` from `./examples/xo/XoGame` and render `<XoGame />` instead of `<RoomPlayground />`. Then follow "Testing locally with two players" in `frontend/README.md`.

## What to copy

| File | Pattern |
| --- | --- |
| `xo.ts` | A pure rules engine (no React, no DOM). `applyMove` returns a new state or the reason a move was refused. Easy to test. |
| `messages.ts` | One typed message union, payload validation for everything that arrives from another browser, and typed `send`/`on` wrappers. `GameTransport` is the slice of `RoomClient` the game needs, so tests can pass a fake. |
| `controller.ts` | The multiplayer protocol with no React in it. **Host-authoritative**: the host checks every move and publishes the state with an increasing `seq`; everyone ignores a `seq` that is not newer; a client with no state sends `sync` until someone answers. |
| `roles.ts` | Pure helpers that turn room and game state into what the screens need (who is X, status text, `canPlay`). |
| `useGame.ts` | The React binding (`useSyncExternalStore`). |
| `XoGame.tsx` | Picks the screen (connecting, lobby, game, result) from connection and room state. |
| `controller.test.ts` | An in-memory fake room (`Hub`) that relays messages like the backend, so the whole protocol, including drops and reconnects, is tested without a socket. |
| `screens.test.tsx` | Markup tests with `renderToStaticMarkup`, so no DOM library is needed. |

## Rules it follows

- It talks to the backend only through `RoomClient` (via the narrow `GameTransport`), never a raw WebSocket.
- Opponent drops show a banner and pause input. Opponent leaving or timing out is a win by forfeit. A finished game is never overturned by a later `player.left`.
- After `client.reconnected` it sends `sync`, and again when the server confirms the rejoin (`room.joined` with `reconnected: true`). The first message can be processed before the server has seated the new connection.
- The room locks when the game starts, so a rematch means a new room.

The spec that produced it is in `.kiro/specs/examples/xo-game/` (requirements, design, tasks).
