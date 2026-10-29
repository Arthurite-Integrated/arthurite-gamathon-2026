# Lessons learned

Problems we actually hit while building and deploying a 2-player game on this stack, what caused them, and how to avoid or diagnose them. The short version of the rules is in `.kiro/steering/lessons-learned.md`, which Kiro reads on every task. This file keeps the reasoning and the commands.

## 1. Amplify Hosting

### The first hosted build failed at `npm ci`

- **Symptom:** `npm error code EUSAGE ... can only install with an existing package-lock.json`, followed by npm's whole usage text. The log shows `# Executing command: npm ci` right before it.
- **Cause:** the Amplify app was not in monorepo mode (`AMPLIFY_MONOREPO_APP_ROOT` was not set), so every command started in the repository root. The root has no `package.json` or lockfile. Putting a flat `amplify.yml` inside `frontend/` did not help, because the build still started at the root.
- **Fix:** one `amplify.yml` at the repository root, in the flat form (`frontend:` at the top), running each command in a subshell: `(cd frontend && npm ci)`, `(cd frontend && npm run build)`. Artifacts are `baseDirectory: frontend/dist` and the cache is `frontend/node_modules/**/*`. Paths there are relative to the repo root.
- **Why a subshell:** `(cd frontend && ...)` works whether or not the build shell keeps its working directory between commands.
- **Do not mix forms:** the `applications:` / `appRoot:` form only works together with `AMPLIFY_MONOREPO_APP_ROOT`. A flat spec with that variable set, or the monorepo spec without it, is the mistake to avoid. `backend/test/stack.test.ts` fails if either happens.

### One source of truth for the build spec

A committed `amplify.yml` overrides the build settings saved in the Amplify console ([AWS docs](https://docs.aws.amazon.com/amplify/latest/userguide/monorepo-configuration.html)). We had two copies, one in the CDK stack and one in the repo, and they disagreed. Now `backend/lib/frontend-stack.ts` reads the root `amplify.yml`, and a test asserts the stack's spec is byte-for-byte that file.

### Reading a build log

- Find which spec ran by reading the `# Executing command:` lines. They show the commands, so you can tell whether the file in git or the console spec is in use. If both contain the same commands, the log cannot tell you which one won.
- Pull a full log without the console: `aws amplify list-jobs`, then `aws amplify get-job --job-id N` and download each step's `logUrl`.
- Harmless on a first build: `Unable to write cache ... 404`, `Failed to set up process.env.secrets`, and a wall of `npm warn deprecated` lines.
- `nvm install 24` also runs `npm install -g` for Amplify's default global packages (about 30 seconds). That is expected, not a hang.

### Other Amplify facts

- `VITE_*` values are baked into the JavaScript at build time. Change one and you must rebuild. They come from the CDK stack, or from the app's environment variables if it was created in the console. `frontend/.env.local` is for your machine only and is not in git.
- The hosted build does **not** run tests. Run them in CI (`.github/workflows/ci.yml`) or with `node scripts/verify.mjs`.
- Pin Node in the spec (`nvm install 24`, `nvm use 24`) and in `.node-version`, so the hosted build uses the runtime you verified on.
- Never put a `packageManager` or `devEngines` field naming another tool (for example bun) in `package.json`. npm refuses to run `npm ci` when they disagree. A previous project's deploy failed exactly this way. A test here checks both fields are absent.
- A GitHub repository can be transferred. `git push` then prints `This repository moved` and Amplify clones the new location. Use the new owner and name in `githubOwner` and `githubRepo`.

## 2. Flaky backend tests: a race, not a bug

- **Symptom:** `ResourceNotFoundException: Requested resource not found` in `rooms.test.ts`, with a different number of failures on each run (10, then 7, then 5).
- **Cause:** the DynamoDB emulator (dynalite) returns from `CreateTable` before the table is `ACTIVE`. The first write sometimes arrives too early.
- **Fix:** after `CreateTable`, poll `DescribeTable` every 10 ms until `ACTIVE` (in `test/harness.ts` and `scripts/local-realtime.ts`).
- **Do not use `waitUntilTableExists`:** its minimum delay is 20 seconds and `maxWaitTime` must be larger than that, so a small value throws and a large one is slow.
- **Rule of thumb:** a failure count that changes between runs is a race. After fixing one, run the suite several times, not once.

## 3. Realtime: a stale room pointer blocked everyone

- **Symptom:** creating a room said "You're already in a room", and another account joining that code said "We couldn't find a room".
- **Cause:** each connection stores the room code it is in. When the same account takes its seat on a second connection (a second tab, a refresh) and then leaves, the room is deleted, but the first connection still points at it. `createRoom` trusted the pointer forever.
- **Diagnosis that worked:** a read-only scan of the rooms table showed a connection with `code=JHTA` and no `ROOM#JHTA` rows at all.
- **Fix (`backend/src/shared/rooms.ts`):** `currentRoomCode()` treats `conn.code` as a hint and checks that this connection really holds the seat. If not, it clears the pointer. `leaveRoom` from a stale connection no longer removes the seat held by another connection.
- **General rule:** a stored pointer is a hint. Verify it against the source of truth before refusing a request because of it.
- **Testing rule:** one account in two tabs is one player. Test multiplayer with two different accounts (two browsers, or a normal and a private window), or with `?as=alice` and `?as=bob` locally.

## 4. Realtime game design

Details and code are in `frontend/src/examples/xo/` (see its README). The decisions that mattered:

- **The backend only relays.** All rules live in the frontend. Make the host authoritative: guests send `move` to the host only, and the host validates, applies and publishes the state.
- **Order with a counter.** Messages can arrive out of order. Put an increasing `seq` in every state and ignore anything not newer.
- **Everything can be lost while offline.** The backend does not replay messages. A client with no state sends `sync` and keeps asking (once a second) until someone answers. The host re-sends its state on `player.reconnected` and when it reconnects itself.
- **`client.reconnected` fires early.** `RoomClient` sends `joinRoom` and emits `client.reconnected` immediately, before the server has seated the new connection, so a `sync` sent right then can be processed first and fail. Send `sync` again when `room.joined` arrives with `reconnected: true`.
- **`game.started` and the first state race.** A guest can receive the host's first state before its own `game.started`. Do not wipe state on `game.started`; reset it when joining, creating or leaving a room.
- **A drop can be very short.** `RoomClient` retries immediately, so the "reconnecting" window may last milliseconds. To observe it in a test, delay the token fetch on reconnect.
- **Leaving ends the game, a drop does not.** `player.disconnected` pauses input. `player.left` (left or timed out) is a win by forfeit. Never let a later `player.left` overturn a finished result.
- **Untrusted input.** Validate every payload from another browser (shape, ranges, lengths) before using it.

## 5. Verifying instead of assuming

- **Is it really deployed?** `cdk diff` printing "no differences" is strong evidence. Confirm it by downloading the live Lambda (`aws lambda get-function`, then the `Code.Location` URL) and comparing the SHA-256 of `index.js` with the one in `backend/cdk.out/asset.<hash>/`. Bundles are minified, so grepping the deployed code for a function name finds nothing.
- **Read-only first.** Before changing anything, look: Lambda logs (`aws logs tail <group> --since 3h`), the rooms table (`aws dynamodb scan`, summarised), the Amplify job log. We found the stale-pointer bug from the table, not from guessing.
- **Reproduce, then fix.** Write the failing test first and watch it fail for the right reason. Then fix, then run the whole suite repeatedly.
- **Prove a guard test guards.** Temporarily break the thing it protects (put `npm ci` back at the repo root, add `applications:`) and confirm the test fails. Restore and confirm it passes.
- **Test the protocol without sockets.** `controller.test.ts` uses an in-memory `Hub` that relays messages like the backend. It covers drops, reconnects, host change and lost messages in milliseconds.
- **Then test against the real thing once.** A throwaway script with two real `RoomClient`s against `npm run local:realtime` found wiring problems the fake could not. Delete it afterwards.
- **No DOM library needed for markup tests.** `renderToStaticMarkup` from `react-dom/server` is enough for "does this screen contain these test ids and texts". Use the real browser (chrome-devtools MCP) for clicks, focus and layout.
- **Browser checks: one step at a time.** We once saw a screenshot that contradicted the page state reported a moment earlier. It did not reproduce when the click, the read and the screenshot ran as separate sequential steps. Do not batch a state change and a screenshot in one parallel call. The `chrome-devtools` screenshot tool also only writes inside the workspace.

## 6. Working practices

- **Spec first, with a review gate.** `requirements.md`, then `design.md`, then `tasks.md` under `.kiro/specs/<name>/`. Number the requirements (R1.1, R3.4) and refer to them from tests and tasks. Keep a short "assumptions" list at the end of the requirements and confirm it.
- **Ask before the irreversible.** Deploys, pushes, deletes and anything in someone else's AWS account get an explicit go-ahead. Read-only checks do not.
- **Do not change git config.** If `user.name` is empty, pass the author for one commit with `git -c user.name=... -c user.email=... commit`.
- **Before you push:** `node scripts/verify.mjs`. After you push, Amplify builds `main`; watch it with `aws amplify list-jobs`.
- **Accessibility is part of done.** Real `<button>`s, visible focus, a 44 px touch target, labels tied to inputs, `aria-pressed` for toggles. `PasswordField` (`frontend/src/auth/PasswordField.tsx`) is the pattern: a constant accessible name ("Show password") plus `aria-pressed`, so a screen reader says "pressed" instead of re-reading a changing label.

## 7. Machine notes (macOS)

- There is no `timeout` command on macOS. Use the tool's own timeout, or `gtimeout` from Homebrew `coreutils`.
- The first `git push` over HTTPS can stall while the macOS keychain asks for the stored credential. Retry once before debugging.
- `python3` on a fresh macOS has no `yaml` module. Use Ruby (`ruby -ryaml`) or Node to check YAML.
- Run long servers (`npm run local:realtime`, `npm run dev:local`) as background processes and stop them when done. Ports 8787 and 5173 stay busy otherwise.
