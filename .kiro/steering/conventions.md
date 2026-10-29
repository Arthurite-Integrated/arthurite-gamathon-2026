---
inclusion: always
---

# Project conventions

This is a project-agnostic serverless boilerplate. Build the product on top of it from a spec in `.kiro/specs/`.

## Stack

- Backend: AWS CDK v2 in TypeScript (`backend/`). Lambda runtime Node.js 22 on arm64, bundled with `NodejsFunction`.
- Services: Cognito (auth), API Gateway HTTP API with JWT authorizer, API Gateway WebSocket API for realtime rooms (see realtime.md), Lambda, DynamoDB on-demand, CloudWatch Logs.
- Frontend: Vite + React + TypeScript (`frontend/`), hosted on AWS Amplify Hosting and connected to GitHub. Amplify is used for hosting only. The backend is CDK, not Amplify Gen 2.
- Package manager: npm. Commit `package-lock.json`.
- Everything is serverless. Do not add servers, EC2, containers, or VPCs without an explicit requirement.

## Layout

```
.kiro/steering/        rules Kiro always follows
.kiro/specs/<name>/    one folder per feature: requirements.md, design.md, tasks.md
backend/bin/app.ts     the CDK app: config, stacks, partner tag
backend/lib/           stacks and constructs
backend/src/handlers/  one file per Lambda handler (ws-handler.ts and ws-authorizer.ts are the realtime layer)
backend/src/shared/    domain logic shared by handlers (rooms.ts, router.ts, validate.ts, types.ts)
backend/test/          jest tests
amplify.yml            the ONLY Amplify build spec (repo root; read by backend/lib/frontend-stack.ts)
scripts/               init.mjs (name a new project), verify.mjs (run every gate)
.github/workflows/     ci.yml (same gates as verify.mjs)
docs/                  SETUP.md, KIRO-PROMPTS.md, REALTIME-PROTOCOL.md, LESSONS-LEARNED.md
frontend/src/          React app (api/ client, auth/, realtime/ RoomClient, examples/xo a finished game, components)
```

## Naming and configuration

- The project name comes from one place: `projectName` in `backend/cdk.json`. Use `config.projectName` to prefix stack and resource names. Never hard-code a project name in code.
- Settings (region, GitHub repo, CORS origins) are CDK context in `cdk.json`, read through `backend/lib/config.ts`.
- The frontend reads settings from `VITE_*` env vars only (`frontend/src/config.ts`). Never hard-code the API URL or Cognito ids.

## Adding a backend endpoint

1. Add the requirement to the spec in `.kiro/specs/<name>/requirements.md` (EARS format, see `.kiro/specs/requirements.template.md`).
2. Create `backend/src/handlers/<name>.ts` exporting `handler`.
3. In `backend/lib/backend-stack.ts`: create the function with `createFunction`, grant only the table/resource access it needs, and add the route with `api.addRoutes` using the existing `authorizer`.
4. Add a jest test in `backend/test/` for the handler, and assert the route and auth in the stack test.
5. Add a typed function for the route in `frontend/src/api/client.ts`.

## Code style

- TypeScript strict mode everywhere. No `any`.
- Handlers return JSON with a consistent error body: `{ "message": string }`.
- Keep handlers small. Put shared logic in `backend/src/shared/`.
- Every change must keep these green: `npm test` and `npx cdk synth` in `backend/`, `npm run build` and `npm test` in `frontend/`. `node scripts/verify.mjs` runs all of them; CI runs the same gates.
- Hard-won rules (Amplify build spec, flaky-test races, stale pointers, deploy checks) are in `.kiro/steering/lessons-learned.md`.
