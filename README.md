# AWS Serverless Realtime Boilerplate

A project-agnostic starter for authenticated, realtime serverless apps on AWS. Copy it, name it, describe your product in a Kiro spec, and build on top of a working, deployable base. It already includes the fixes from a real project; see `docs/LESSONS-LEARNED.md`.

- **Backend:** AWS CDK (TypeScript). Cognito auth, API Gateway HTTP API with a JWT authorizer, Lambda (Node.js 22), DynamoDB on-demand, CloudWatch Logs.
- **Frontend:** Vite + React + TypeScript, hosted on AWS Amplify Hosting and deployed from GitHub on every push. Sign-in includes a show/hide password field (`PasswordField`).
- **Realtime rooms (multiplayer layer):** create a room, share a 4-letter code, join, start with a shared seed, and relay messages between 2 to 8 players. It is app-agnostic, so any game or collaborative app uses the same backend through one `RoomClient`.
- **Partner tag:** every resource is tagged `aws-apn-id = pc:8l8gcn23lmlgammd8572tk6va`, and `cdk synth` fails if any resource is not.
- **A finished example game:** `frontend/src/examples/xo/` is a complete 2-player tic-tac-toe on the rooms layer (host-authoritative, safe across reconnects, fully tested). The spec that produced it is in `.kiro/specs/examples/xo-game/`. Copy its patterns, and delete the folder when you do not need it.
- **Gates and CI:** `node scripts/verify.mjs` runs type-check, tests, build and `cdk synth` for both halves. `.github/workflows/ci.yml` runs the same gates on every push, because the Amplify build does not run tests.
- **Kiro-ready:** steering files and a spec template in `.kiro/` so Kiro follows the same rules on every project, including `lessons-learned.md`.

It ships with one neutral example, `GET /me`, which returns the signed-in user's identity so you can see auth working right after the first deploy. There is no domain logic to delete.

## Architecture

```
 Browser (React on Amplify Hosting)
    |  1. sign up / sign in (SRP)            ->  Amazon Cognito user pool
    |  2. receives a JWT
    |  3. calls the API with Authorization: Bearer <JWT>
    v
 API Gateway (HTTP API) --validates JWT with Cognito-->  rejects with 401 if invalid
    |
    v
 AWS Lambda (one function + one scoped IAM role per route)
    |                         \
    v                          v
 DynamoDB (on-demand)       CloudWatch Logs

 Realtime rooms (optional, on by default):
 Browser <--WebSocket--> API Gateway WebSocket API --> Lambda authorizer (verifies the Cognito token)
                                   |
                                   v
                          one Lambda --> DynamoDB (rooms, players, TTL)
```

## Repo map

```
.
├── README.md                     you are here
├── amplify.yml                   THE Amplify build spec (repo root, builds inside frontend/); the CDK stack reads this file
├── .node-version                 Node 24, used by CI and matched by the Amplify build
├── .github/workflows/ci.yml      runs the same gates as scripts/verify.mjs on push and pull request
├── scripts/
│   ├── init.mjs                  names a new project: node scripts/init.mjs my-app --github owner/repo
│   └── verify.mjs                runs every gate for backend and frontend, no AWS credentials needed
├── .kiro/
│   ├── settings/mcp.json         Chrome DevTools MCP server, so Kiro can test in a real browser
│   ├── steering/                 rules Kiro always follows (partner tag, IAM, conventions, realtime, lessons-learned)
│   └── specs/
│       ├── requirements.template.md      blank EARS template for a new project
│       └── examples/
│           ├── leaderboard/              worked example requirements (read-only reference)
│           └── xo-game/                  a full requirements, design and tasks set that was built and shipped
├── docs/
│   ├── SETUP.md                  install guide for Windows and Mac (Node, AWS CLI, CDK, Kiro, Chrome MCP)
│   ├── KIRO-PROMPTS.md           ready-to-paste Kiro prompts: build a game, deep-test it, deploy it
│   ├── LESSONS-LEARNED.md        problems we hit (Amplify, flaky tests, stale rooms...), causes, fixes, commands
│   └── REALTIME-PROTOCOL.md      every message and error code of the multiplayer layer
├── backend/                      AWS CDK app + Lambda handlers      -> backend/README.md
└── frontend/                     Vite + React app                   -> frontend/README.md
    └── src/examples/xo/         finished 2-player game to copy patterns from
```

## Quickstart

You need Node.js 22+, an AWS account, and AWS CLI credentials configured (`aws sts get-caller-identity` should work).

```bash
# 1. Install (npm ci uses the committed lockfiles)
cd backend && npm ci && cd ../frontend && npm ci && cd ..

# 2. Name your project (lowercase letters, digits, hyphens).
#    Optional: --github owner/repo to connect Amplify, --region eu-west-1
node scripts/init.mjs my-app

# 3. Bootstrap CDK once per account/region
cd backend && npx cdk bootstrap

# 4. Deploy the backend (Cognito, API, Lambda, DynamoDB)
npm run deploy

# 5. Generate the frontend env from the stack outputs, then run the app
npm run env:frontend
cd ../frontend && npm run dev
```

Open http://localhost:5173, create an account (Cognito emails you a code), sign in, and press **Call GET /me**. The **Realtime rooms** card below it lets you create and join rooms. To see a finished game instead, follow `frontend/src/examples/xo/README.md`.

Before you push, run `node scripts/verify.mjs` (every gate, no AWS credentials needed).

First time on this computer? Follow `docs/SETUP.md` for Node, the AWS CLI, credentials and CDK bootstrap on Windows and Mac.

### Try multiplayer locally first (no AWS account needed)

```bash
# terminal 1
cd backend && npm run local:realtime
# terminal 2
cd frontend && npm run dev:local
```
Open `http://localhost:5173/?as=alice` and `http://localhost:5173/?as=bob` in two tabs. Each tab is its own player, with no sign-in. The local server runs the same room logic as production.

## Deploy the frontend to Amplify (git-connected)

Amplify Hosting is defined in the same CDK app. Once it is set up, every push to your branch builds and deploys `frontend/`.

1. Push this repo to your own GitHub repository. (If GitHub ever prints `This repository moved`, use the new owner and name in step 4.)
2. Create a GitHub personal access token (classic) with the `repo` scope.
3. Store it in Secrets Manager, in the same region as the stack:
   ```bash
   aws secretsmanager create-secret --name github-token --secret-string "<your-token>" --region us-east-1
   ```
4. In `backend/cdk.json` set `githubOwner` and `githubRepo` (and `githubBranch` / `githubTokenSecretName` if they differ from `main` / `github-token`).
5. Deploy again:
   ```bash
   cd backend && npm run deploy
   ```
   The stack output `SiteUrl` is your live site. If the first build does not start by itself, push a commit or press **Run build** in the Amplify console.

The API URL and Cognito ids are passed to Amplify as build environment variables by the stack, so no `.env` file is needed in production. They are baked into the site at build time, so changing one needs a new build.

**The build spec is `amplify.yml` at the repo root, and nowhere else.** It runs `(cd frontend && npm ci)` and `(cd frontend && npm run build)` and publishes `frontend/dist`. The CDK stack reads this same file, and a test (`backend/test/stack.test.ts`) fails if the two differ or if someone switches to the monorepo form. Amplify does **not** run tests; CI does. If a hosted build fails at `npm ci` with `EUSAGE`, see the first lesson in `docs/LESSONS-LEARNED.md`.

If `githubOwner` / `githubRepo` are empty, `cdk deploy` skips the frontend stack and deploys only the backend.

## Configuration

All project settings live in `backend/cdk.json` under `context`:

| Key | Default | Purpose |
| --- | --- | --- |
| `projectName` | `starter` | Prefixes stack and resource names, and the frontend title |
| `region` | `us-east-1` | Deployment region (override with `-c region=af-south-1`) |
| `removeDataOnDestroy` | `true` | `true`: `cdk destroy` deletes the table and user pool. Set `false` for real projects |
| `corsAllowedOrigins` | `["*"]` | Allowed browser origins for the API. Tighten before launch |
| `enableRealtime` | `true` | Creates the realtime rooms layer (WebSocket API, 2 Lambdas, a rooms table). Set `false` if the project does not need multiplayer |
| `realtimeGraceSeconds` | `30` | How long a dropped player keeps their seat |
| `realtimeRateLimitPerSec` | `30` | Max messages per player per second |
| `githubOwner`, `githubRepo` | empty | Repo Amplify builds from. Empty skips the frontend stack |
| `githubBranch` | `main` | Branch Amplify deploys |
| `githubTokenSecretName` | `github-token` | Secrets Manager secret holding the GitHub token |

## Building your project with Kiro

1. Open this folder in Kiro. The steering files in `.kiro/steering/` load automatically.
2. Copy `.kiro/specs/requirements.template.md` to `.kiro/specs/<your-feature>/requirements.md` and describe what you are building. Open `.kiro/specs/examples/leaderboard/requirements.md` to see a finished example.
   `.kiro/specs/examples/xo-game/` is a complete requirements, design and tasks set for a multiplayer game that was built from it.
3. Ask Kiro to generate the design and tasks from your spec, then run the tasks. `docs/KIRO-PROMPTS.md` has ready-to-paste prompts for building a multiplayer game, testing it in a real browser with the Chrome DevTools MCP server, and deploying it.
4. Kiro adds handlers, routes, and UI by following `.kiro/steering/conventions.md`. Check its work with `node scripts/verify.mjs`, which runs `npm test` and `npx cdk synth` in `backend/` and `npm run build` and `npm test` in `frontend/`.

The `examples/` folder is safe to delete. Nothing depends on it.

## Realtime multiplayer rooms

The backend includes a generic room layer, so you never write room or lobby code again:

- **Create / join:** one player creates a room (2 to 8 seats) and gets a 4-letter code. Others join with it.
- **Host starts:** the host starts the game once 2 or more are connected. Every player receives the same random seed, so shared randomness (piece order, card shuffles) matches.
- **Relay:** `client.send('anything', payload)` goes to everyone else in the room. The backend never reads it, so game rules live in your frontend.
- **Drops:** a player who loses connection keeps their seat for 30 seconds and rejoins automatically.

Use it from any frontend:

```ts
const { client, snapshot } = useRoom();            // connects, and disconnects on unmount
await client.createRoom({ maxPlayers: 2 });        // or client.joinRoom('ABCD')
client.on('move', (payload, msg) => { /* msg.from is the sender */ });
client.send('move', { x: 3, seq: 12 });
await client.start();                               // host only; snapshot.seed is now shared
```

Full reference: `docs/REALTIME-PROTOCOL.md`. A bare-bones screen to try the layer: `frontend/src/RoomPlayground.tsx`. A finished game: `frontend/src/examples/xo/`.

## The partner tag

`aws-apn-id = pc:8l8gcn23lmlgammd8572tk6va` is applied once at the CDK app level (`backend/bin/app.ts`) and enforced by `backend/lib/partner-tag.ts`. If a resource is ever untagged or tagged with a different value, `cdk synth` and `cdk deploy` fail with a clear error. Do not edit or remove it. After deploying, confirm it in AWS:

```bash
aws resourcegroupstaggingapi get-resources --tag-filters Key=aws-apn-id --region us-east-1
```

## Before you launch

This is a starter, so some defaults favour an easy first run. Work through this list before real users arrive.

- [ ] CI is green on `main` (`.github/workflows/ci.yml`), because the Amplify build does not run tests.
- [ ] `corsAllowedOrigins` lists only your real site URL(s), not `*`.
- [ ] `removeDataOnDestroy` is `false`, so deleting a stack cannot delete user data.
- [ ] Cognito: decide on MFA, password rules, and whether self sign-up should stay open. Set up SES for email instead of the default Cognito sender, which has a low daily limit.
- [ ] Every HTTP route is behind the JWT authorizer, and any public route is written into your spec.
- [ ] Realtime: players can lie about their own state, because the backend only relays. If fairness matters (money, rankings, prizes), add server-side rule checks.
- [ ] Realtime: the WebSocket does not check the browser's `Origin`. If you need to restrict which sites can connect, add that check to `backend/src/handlers/ws-authorizer.ts`.
- [ ] Realtime: tune `realtimeGraceSeconds` and `realtimeRateLimitPerSec` for your app, and run `docs/KIRO-PROMPTS.md` Prompt 3 (deploy and test with real accounts).
- [ ] Each Lambda role has only the permissions it needs. No wildcard actions or resources.
- [ ] API throttling is set on the stage, and input validation returns 400 on bad input.
- [ ] CloudWatch alarms exist for Lambda errors and API 5xx, and log retention matches your policy.
- [ ] A budget alert is set in AWS Billing.
- [ ] The GitHub token is a fine-scoped secret, stored only in Secrets Manager.
- [ ] A custom domain and HTTPS are set up on Amplify if you need one.
- [ ] `aws resourcegroupstaggingapi` shows the partner tag on your resources.

## Clean up

```bash
cd backend && npm run destroy
```

This removes the stacks. With `removeDataOnDestroy: true` it also deletes the DynamoDB table and the Cognito user pool. The Secrets Manager secret is not part of the stacks, so delete it yourself if you no longer need it.
