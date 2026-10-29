# Building a multiplayer game with Kiro

How to go from this boilerplate to a working multiplayer game, using Kiro for the build and the Chrome DevTools MCP server for testing. The examples use Tetris, but the same steps work for any app, because the backend (rooms, join, start, relay) is already done and generic.

## The plan

1. **Backend: nothing to build.** Rooms, codes, joining, hosts, shared seeds, reconnecting and message relay all exist. Your game only decides what messages to send.
2. **Frontend first, against the local server.** Build and test the whole game on your laptop with no AWS involved.
3. **Deploy**, then test again with real sign-in.

## Before you start

- Finish `docs/SETUP.md` (at least steps 1, 6, 7 and 8).
- Open the project folder in Kiro and check `chrome-devtools` is connected in the MCP panel.
- Use **Spec** mode (not a plain chat) for the build. Kiro writes `requirements.md`, then `design.md`, then `tasks.md`, and waits for your approval at each step. Read each one. Fixing a requirement is far cheaper than fixing the code.
- Steering files in `.kiro/steering/` are loaded automatically. They tell Kiro to use `RoomClient`, not to change the backend for game rules, and to keep the partner tag.

## Prompt 1: build the frontend (new spec, name it `tetris-game`)

Paste this into a new spec. Change the game section to describe your own game; keep everything else.

```
Build a 2-player online Tetris game in /frontend, on top of the existing realtime rooms layer.

Read first: .kiro/steering/realtime.md, docs/REALTIME-PROTOCOL.md, frontend/src/realtime/RoomClient.ts, frontend/src/realtime/useRoom.ts and frontend/src/RoomPlayground.tsx (a working lobby example).

Do NOT change /backend. It is a generic room relay. All game rules live in the frontend. Talk to the backend only through RoomClient and the useRoom hook.

Flow: sign-in (existing) -> lobby (create room, join with 4-letter code, see players, host presses Start) -> game -> result -> "Play again" returns to the lobby. Replace RoomPlayground in App.tsx with the real lobby; keep RoomPlayground.tsx deleted or unused.

Game:
- Engine: a pure TypeScript module in src/game/ (no React, no DOM), 10x20 board, 7 tetrominoes, 7-bag randomizer driven by a numeric seed. Both players receive the same seed in game.started, so they get the same piece order. Rotation with simple wall kicks, soft drop, hard drop, ghost piece, line clears, level up every 10 lines (gravity speeds up), top-out detection. Scoring: 100/300/500/800 x level for 1/2/3/4 lines.
- Attacks: clearing 2/3/4 lines sends 1/2/4 garbage lines to the opponent. Incoming garbage waits in a pending queue shown by a meter and lands after your next piece locks without a line clear. Clearing lines first cancels pending garbage. Garbage rows have one gap; the gap column comes from a second seeded random generator so the engine stays deterministic.
- Controls: arrows, space (hard drop), up or X (rotate), P (pause); on-screen touch buttons on small screens. Prevent the browser's default scrolling for these keys.
- Screens show: my board full size, opponent board small, next piece, score, lines, incoming garbage meter, a 3-2-1 countdown before play, and a clear result screen.

Multiplayer messages (define them as a typed union in src/game/messages.ts, send with client.send, receive with client.on):
- "board": snapshot of my board (throttled to at most 5 per second, plus once on every piece lock). Include an incrementing "seq" and ignore older ones.
- "attack": { lines } when I clear lines.
- "topout": I lost. The other player then shows the win screen.
Handle: the opponent leaving or timing out (player.left) means I win; the opponent disconnecting briefly (player.disconnected) shows a "Opponent reconnecting..." banner; after client.reconnected, send a fresh "board" snapshot to resync.

Quality: TypeScript strict, no any. Unit-test the engine with vitest (seed determinism, 7-bag, wall kicks, hard drop, line clears, scoring, garbage, top-out). Keep npm run build and npm test green. Keep the game at 60fps and make gravity independent of frame rate.

Out of scope: spectators, chat, more than 2 players, rankings, sound.

Start with requirements.md and wait for my review before design.
```

**What to check when Kiro shows you `requirements.md`:** the attack and pending-garbage rule is stated once and consistently; every message type has a direction (who sends, who receives); the opponent leaving is covered; and nothing asks for backend changes.

## Prompt 2: deep test it in a real browser (same spec, after the tasks finish)

The `chrome-devtools` MCP server lets Kiro open Chrome, click, type, read the console and take screenshots. Run this once the implementation tasks are done.

```
Test the game end to end in a real browser using the chrome-devtools MCP server. Do not assume anything works; verify it.

Setup (use separate terminals/background processes):
1. cd backend && npm run local:realtime   (ws://localhost:8787)
2. cd frontend && npm run dev:local        (http://localhost:5173)

Then, with chrome-devtools:
1. Open TWO tabs: http://localhost:5173/?as=alice and http://localhost:5173/?as=bob. Each tab is a separate player.
2. In alice's tab create a room. Read the code from the page, join from bob's tab, and start the game from alice's tab.
3. Check, taking a screenshot or page snapshot as evidence each time:
   - both tabs show the 3-2-1 countdown, then pieces start falling
   - both players get the same first 7 pieces
   - arrow keys, rotate, soft drop, hard drop, and pause all work
   - bob's board appears (smaller) in alice's tab and updates as bob plays
   - clearing 2+ lines in one tab raises the garbage meter in the other, and garbage lands as specified
   - letting one board fill up shows the result screen: loser in one tab, winner in the other
   - "Play again" returns both tabs to the lobby, and a second match works
4. Edge cases: close bob's tab mid-game (alice should see him marked "reconnecting" and then win after 30 to 50 seconds, because cleanup runs on alice's next 20-second ping once the 30-second grace period has passed); open bob again with ?as=bob within 30 seconds and rejoin with the same code (he should get his seat back); try joining a started room from a third tab (should show a clear room-locked message); enter a bad room code.
5. Check the console in every tab: there must be no errors or warnings from our code. Check that the WebSocket stays open and messages are not flooding (boards throttled to a few per second).
6. Resize one tab to a phone width (about 390 px) and confirm the touch controls appear and the layout does not overflow.
7. Take a performance trace of one tab during play and report dropped frames or long tasks.

Report what passed, what failed (with screenshots and console output), and fix every failure. Re-run the failing steps after each fix. Do not stop until all steps pass.
```

Tips for this step:
- Kiro asks for approval before running commands and tools. Approve them, but read what it is about to run.
- If it gets stuck on timing (for example a piece must land before a screenshot), tell it to add a `data-testid` to key elements. The playground uses `data-testid="room-code"`, `"players"`, `"start-game"` and so on, and your game screens should too.
- Ask it to save the test steps as a checklist in `docs/` so you can repeat them after every change.

## Prompt 3: deploy and test with real accounts

```
Deploy and verify the real stack.
1. In /backend run npm test and npx cdk synth. Fix anything that fails.
2. Run npm run deploy (this creates real AWS resources), then npm run env:frontend.
3. Confirm the partner tag is applied: aws resourcegroupstaggingapi get-resources --tag-filters Key=aws-apn-id
4. Start the frontend with npm run dev (not dev:local). Using chrome-devtools, sign up two test users (I will give you the confirmation codes from my email), create a room with one, join with the other, and play a short match. Report any console errors and any difference from local behaviour.
```

Notes: deploying creates real resources that cost a little money (this stack is pay-per-use). When you are finished experimenting, run `cd backend && npm run destroy`.

## Adapting this to another game

Keep the same shape and change only the middle:

- **Another real-time game** (pong, racing, drawing): same prompt; replace the Game section and define your own message types. Send state a few times per second, with a `seq` counter.
- **Turn-based game** (cards, quiz, chess): the host holds the game state and every other player sends "action" messages to the host (`client.send('action', {...}, hostId)`); the host applies the rules and broadcasts the new state. This keeps one source of truth without any backend change. `frontend/src/examples/xo/` is this pattern, finished and tested, and `.kiro/specs/examples/xo-game/` is the spec it came from. Tell Kiro to "follow the structure of `src/examples/xo/`" and it will reuse the typed messages, the controller with no React, and the fake-room tests.
- **More players**: pass `maxPlayers` to `createRoom` (2 to 8). Use `game.started` for the player list and shared seed.

## When Kiro goes wrong

| Symptom | What to do |
| --- | --- |
| It edits files under `/backend` for game rules | Stop it. Say: "The backend is a generic relay. Move this logic into the frontend, as the steering file says." |
| It opens a raw `WebSocket` | Say: "Use RoomClient and useRoom only." |
| It uses `Math.random()` for piece order | Say: "Use the shared seed from game.started so both players match." |
| `cdk synth` fails on the partner tag | It changed tagging. Restore `backend/bin/app.ts` from git. Never exempt a resource. |
| The tests pass but the game feels wrong | Play it yourself in two tabs. Tests cannot judge feel. Describe what is wrong in plain words and let Kiro adjust. |
| A long task goes off track | Commit before each Kiro run so you can `git restore` or `git reset`. |
