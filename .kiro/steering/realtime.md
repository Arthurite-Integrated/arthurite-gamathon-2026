---
inclusion: always
---

# Realtime rooms (multiplayer layer)

This boilerplate includes an app-agnostic multiplayer backend: rooms with 4-letter codes, join/leave, a host who starts the game with a shared seed, and message relay between players. Full protocol: #[[file:docs/REALTIME-PROTOCOL.md]]

## Rules for any app built on it

- The frontend talks to the backend ONLY through `RoomClient` (`frontend/src/realtime/RoomClient.ts`) and the `useRoom` hook. Never open a raw `WebSocket` in app code.
- Do NOT change the backend for app-specific rules. The backend only relays messages and manages rooms. Scoring, win conditions, game logic and message formats belong in the frontend. Only change `backend/src/shared/` or `backend/lib/realtime.ts` when the generic room behaviour itself needs to change, and then update `docs/REALTIME-PROTOCOL.md` and the tests.
- Define your app's message types in one place (for example `src/game/messages.ts`) as a typed union, and wrap `client.send` / `client.on` so the rest of the app is type-safe.
- Use `snapshot.seed` (from `game.started`) for anything random that all players must agree on. Never use `Math.random()` for shared state.
- Throttle state broadcasts (a few per second, never every frame). Put an incrementing counter in payloads where order matters; messages can arrive out of order.
- After `client.reconnected` or `player.reconnected`, resync state. The backend does not replay missed messages.
- Handle `client.closed` and `player.left` in the UI (for example by declaring the other player the winner).
- Show errors from `RoomClientError.code` to the user in plain words (see the error table in the protocol doc).

## Testing during development

- Run the local server: `cd backend && npm run local:realtime`.
- Run the frontend against it: `cd frontend && npm run dev:local`, then open two tabs: `http://localhost:5173/?as=alice` and `http://localhost:5173/?as=bob`. Each tab is a separate player and no Cognito account is needed.
- `src/RoomPlayground.tsx` is the default screen: a bare-bones create/join/start/chat page. Replace it in `App.tsx` once your real game screens exist.
- `src/examples/xo/` is a finished, tested 2-player game (host-authoritative, reconnect-safe). Copy its patterns (typed messages, `GameTransport`, controller with no React, fake-room tests) instead of inventing new ones. Its README says what each file teaches.
- Before calling work done, run `node scripts/verify.mjs` from the repo root. It runs `npm run build` and `npm test` in `frontend/`, and `npm run build`, `npm test` and `npx cdk synth` in `backend/`.
- The `chrome-devtools` MCP server (see `.kiro/settings/mcp.json`) can drive the browser: open two tabs, play, and read console errors. Use it to verify behaviour instead of assuming.
