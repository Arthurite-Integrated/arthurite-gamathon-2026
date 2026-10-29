# Backend (AWS CDK)

Serverless backend defined with AWS CDK in TypeScript.

## What is in here

```
bin/app.ts                   CDK app: loads config, creates stacks, applies and enforces the partner tag
lib/config.ts                reads project settings from cdk.json context
lib/backend-stack.ts         Cognito, HTTP API + JWT authorizer, Lambda, DynamoDB
lib/realtime.ts              realtime rooms: WebSocket API, Lambda authorizer, handler, rooms table
lib/frontend-stack.ts        Amplify Hosting app connected to GitHub (only when configured)
lib/partner-tag.ts           the partner tag constants and the enforcement aspect
src/handlers/                one file per Lambda handler: me.ts, ws-authorizer.ts, ws-handler.ts
src/shared/                  realtime domain logic: rooms.ts, router.ts, validate.ts, types.ts
scripts/write-frontend-env.ts  writes ../frontend/.env.local from the stack outputs
scripts/local-realtime.ts    local WebSocket server running the real room logic (no AWS needed)
test/                        jest tests: handler tests and stack/tag tests
```

## Prerequisites

- Node.js 22+
- AWS CLI credentials for the target account (`aws sts get-caller-identity` works)
- `npx cdk bootstrap` run once per account and region

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm test` | Run jest (handler tests, stack tests, tag enforcement test) |
| `npm run build` | Type-check with `tsc` |
| `npm run synth` | Generate CloudFormation. Fails if any resource lacks the partner tag |
| `npm run diff` | Show what a deploy would change |
| `npm run deploy` | Deploy all stacks and write `cdk-outputs.json` |
| `npm run env:frontend` | Write `../frontend/.env.local` from `cdk-outputs.json` |
| `npm run local:realtime` | Start the local realtime server at `ws://localhost:8787` (no AWS needed) |
| `npm run destroy` | Delete all stacks |

Pass settings on the command line with `-c`, for example `npx cdk deploy --all -c projectName=my-app -c region=af-south-1`.

## Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/me` | Cognito JWT | Returns the caller's `userId` (token `sub`) and `email` |

All HTTP routes require `Authorization: Bearer <id token>`. Requests without a valid token get `401` from API Gateway before any Lambda runs.

### Realtime WebSocket API

Connect to `WebSocketUrl` with `?token=<Cognito ID token>`. A Lambda authorizer verifies the token before the socket opens. Actions: `createRoom`, `joinRoom`, `leaveRoom`, `start`, `send`, `ping`. The full message and error reference is in `../docs/REALTIME-PROTOCOL.md`; frontends use `RoomClient` rather than the raw protocol.

How it works: one Lambda (`ws-handler`) handles `$connect`, `$disconnect` and every action, calling `src/shared/router.ts`. All state is in one DynamoDB table (`<project>-realtime`): a room record per room, a player record per seat, and a connection record per socket. Seats are reserved with an atomic counter so a room can never be overfilled, and a DynamoDB TTL removes stale rows.

Turn it off for projects that do not need multiplayer with `"enableRealtime": false` in `cdk.json`.

### Testing the realtime layer

`npm test` runs the room logic against a DynamoDB emulator (dynalite), so conditional writes and atomic counters behave like the real service. `test/local-server.test.ts` also runs a full two-player session over a real WebSocket. It does not run against real AWS, so after a deploy, play a match with two real accounts (see `../docs/KIRO-PROMPTS.md`, Prompt 3).

## Stack outputs

`ApiUrl`, `UserPoolId`, `UserPoolClientId`, `Region`, `ProjectName`, `WebSocketUrl` (backend stack), and `AmplifyAppId`, `SiteUrl` (frontend stack).

## Adding an endpoint

Follow `.kiro/steering/conventions.md`. In short:

1. Create `src/handlers/<name>.ts` exporting `handler`.
2. In `lib/backend-stack.ts`, create the function with `this.createFunction(...)` (one role and one log group per function), grant only the access it needs, then add the route with `this.api.addRoutes({ ..., authorizer })`.
3. Add a handler test in `test/` and extend the stack test.

## The partner tag

`aws-apn-id = pc:8l8gcn23lmlgammd8572tk6va` is applied at the app level in `bin/app.ts`, so it reaches every stack and taggable resource. `PartnerTagEnforcer` in `lib/partner-tag.ts` then checks every taggable construct and fails synth if the tag is missing or different. `test/stack.test.ts` proves both the success and the failure case.

Check it on deployed resources:

```bash
aws resourcegroupstaggingapi get-resources --tag-filters Key=aws-apn-id --region us-east-1
```

You can also see it in the AWS console under each resource's Tags tab, or in the CloudFormation stack's Tags.

## Cost

Everything here is pay-per-use, so an idle project costs very little: Lambda, API Gateway (HTTP and WebSocket; WebSocket is billed per message and per connection minute), DynamoDB on-demand, Cognito (free tier for small user counts), CloudWatch Logs, and Amplify Hosting build minutes and storage. The Secrets Manager secret for the GitHub token has a small monthly fee. Check current AWS pricing for your region, and set a budget alert.

## Troubleshooting

- **"Missing or incorrect partner tag" on synth:** something removed or overrode the tag. Do not exempt the resource. Restore the tag in `bin/app.ts`.
- **WebSocket refuses to connect (403):** the token is missing, expired, or not a Cognito **ID** token from this user pool and client. Sign in again.
- **A player stays "reconnecting" for a long time:** cleanup runs when someone in the room is next active; the client pings every 20 seconds, so allow up to 50 seconds.
- **Bundling fails:** run `npm install` so the local `esbuild` is present. Docker is not needed.
- **Amplify stack fails to resolve the token:** the Secrets Manager secret must exist in the same region as the stack, under the name in `githubTokenSecretName`.
