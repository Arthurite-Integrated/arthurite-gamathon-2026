---
inclusion: always
---

# Lessons learned (rules)

Each rule comes from a real failure. Reasons, symptoms and commands: #[[file:docs/LESSONS-LEARNED.md]]

## Amplify and deployment

- The hosted build spec is `amplify.yml` at the REPO ROOT, flat form, with every command as `(cd frontend && ...)`. Do not move it into `frontend/`, do not use `applications:` / `appRoot:`, and do not set `AMPLIFY_MONOREPO_APP_ROOT`. `backend/lib/frontend-stack.ts` reads this same file; never add a second copy of the spec.
- Never add `packageManager` or `devEngines` to a `package.json` (npm refuses `npm ci` if they name another tool). The package manager is npm.
- Amplify does not run tests. Before pushing, run `node scripts/verify.mjs`. CI runs the same gates.
- `VITE_*` values are baked in at build time; changing one needs a rebuild. `.env.local` is never committed.
- Ask before `npm run deploy`, `git push`, or anything that changes the user's AWS account or GitHub. Read-only checks (logs, `cdk diff`, table scans) need no permission.
- To prove something is deployed, compare the live Lambda's `index.js` hash with `backend/cdk.out/asset.<hash>/index.js`.

## Backend and realtime

- Treat any stored pointer (for example `conn.code`) as a hint. Verify it against the source of truth before refusing a request because of it.
- The same account in two tabs is ONE player. Test multiplayer with two accounts (or `?as=alice` and `?as=bob` locally).
- Tests that start the DynamoDB emulator must wait until the table is `ACTIVE` (poll `DescribeTable`). A failure count that changes between runs is a race: fix it, then run the suite several times.
- The backend only relays. Game rules live in the frontend, host-authoritative, with an increasing `seq`, a `sync` request for missing state, and a resync on both `client.reconnected` and `room.joined` with `reconnected: true`. See `frontend/src/examples/xo/`.
- Validate every payload that arrives from another browser before using it.

## Testing and process

- Reproduce a bug with a failing test first. Prove a guard test works by breaking what it guards, then restoring.
- Test protocol logic with a fake in-memory room, then once against `npm run local:realtime`, then in a real browser. Delete throwaway scripts afterwards.
- In browser checks, do state changes and screenshots as separate sequential steps.
- Specs live in `.kiro/specs/<name>/` (requirements, design, tasks), with numbered requirements that tests and tasks refer to. Wait for the user's review after `requirements.md` unless they say to continue.
- Do not change git config. Use `git -c user.name=... -c user.email=...` for a commit when it is empty.
- macOS has no `timeout` command; python has no `yaml` module. Use Ruby or Node.
