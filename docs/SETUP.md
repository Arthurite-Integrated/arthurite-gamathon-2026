# Setup guide (Windows and Mac)

Do this once per computer. It takes about 20 minutes. Every step ends with a check command, so you know it worked before moving on.

## What you need

| Tool | Why | Check |
| --- | --- | --- |
| Node.js 22 or newer | Runs the backend, frontend and CDK | `node -v` shows v22 or higher |
| Git | Source control, and Amplify deploys from GitHub | `git --version` |
| AWS CLI v2 | Lets CDK and your terminal talk to your AWS account | `aws --version` shows aws-cli/2.x |
| An AWS account with credentials | Where everything is deployed | `aws sts get-caller-identity` prints your account |
| Google Chrome | The `chrome-devtools` MCP server drives it to test your game | Open Chrome |
| Kiro | The AI IDE that builds the app from specs | Open Kiro |
| A GitHub account | Only for deploying the frontend with Amplify | github.com |

You do **not** need Docker. CDK bundles the Lambda code with a local `esbuild` that `npm install` provides.

## 1. Node.js 22

**Mac** (with Homebrew, from https://brew.sh):
```bash
brew install node@22
```
Or use the installer from https://nodejs.org (choose the LTS or v22 download).

**Windows**: download the v22 installer from https://nodejs.org and run it, or in PowerShell:
```powershell
winget install OpenJS.NodeJS.LTS
```
Close and reopen your terminal afterwards, then check `node -v`. If it shows an older version, install v22 explicitly from nodejs.org.

## 2. Git

**Mac**: run `git --version`. If it is missing, macOS offers to install the developer tools; accept.
**Windows**: `winget install Git.Git`, or download from https://git-scm.com. Reopen the terminal.

## 3. AWS CLI v2

**Mac**:
```bash
brew install awscli
```
Or download the `.pkg` installer from the AWS CLI install page and run it.

**Windows** (PowerShell):
```powershell
msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi
```
Reopen the terminal, then check `aws --version`.

## 4. Connect the CLI to your AWS account

Pick the method your account uses.

**A. Your organisation uses AWS IAM Identity Center (SSO)** (the common case for company accounts):
```bash
aws configure sso
```
Follow the prompts (start URL and region come from your AWS admin), pick the account and role, and give the profile a name such as `myprofile`. Then each day:
```bash
aws sso login --profile myprofile
```
Tell your terminal to use the profile (Mac: `export AWS_PROFILE=myprofile`; Windows PowerShell: `$env:AWS_PROFILE="myprofile"`).

**B. You have an IAM user with access keys**:
```bash
aws configure
```
Enter the access key id, secret access key, a default region (use `us-east-1` unless you have a reason not to), and `json`. Never commit or paste these keys anywhere.

**Check it worked** (both methods):
```bash
aws sts get-caller-identity
```
You should see your account number. If you get an error about expired or missing credentials, repeat the login step.

Your account needs permission to create CloudFormation stacks, IAM roles, Lambda, API Gateway, DynamoDB, Cognito and Amplify resources. For a workshop or sandbox account, `AdministratorAccess` is the simplest. For real accounts, ask your AWS admin.

## 5. Bootstrap CDK (once per account and region)

CDK needs a small set of helper resources in each account and region it deploys to.
```bash
cd backend
npm ci
npx cdk bootstrap
```
This uses the account and region from your credentials. If you want to be explicit: `npx cdk bootstrap aws://123456789012/us-east-1`. If you change the `region` setting in `backend/cdk.json`, bootstrap that region too.

## 6. Install the project

```bash
cd backend && npm ci
cd ../frontend && npm ci
```
Check the backend is healthy:
```bash
cd ../backend
npm test
npx cdk synth
```
Both should finish without errors. A `cdk synth` error mentioning `aws-apn-id` means a resource is missing the partner tag.

## 7. Kiro and the Chrome DevTools MCP server

1. Install Kiro from https://kiro.dev and sign in.
2. Open this project folder in Kiro (File, Open Folder). It reads `.kiro/steering/` automatically.
3. The file `.kiro/settings/mcp.json` already registers the `chrome-devtools` MCP server. It is started with `npx`, so you need Node 20.19 or newer and Google Chrome installed. In Kiro, open the MCP servers panel and check that `chrome-devtools` shows as connected. The first start downloads the package, so it can take a minute.
4. **Windows only**: if `chrome-devtools` fails to start, change the entry in `.kiro/settings/mcp.json` to run through `cmd`:
   ```json
   "chrome-devtools": {
     "command": "cmd",
     "args": ["/c", "npx", "-y", "chrome-devtools-mcp@latest"]
   }
   ```
5. You can also pin the version instead of `@latest` if a new release ever breaks something.

The MCP server opens its own Chrome window to run tests. Do not log in to personal accounts in that window.

## 8. Try it locally (no AWS needed)

This proves the setup works before you spend any time on AWS:

```bash
# terminal 1
cd backend && npm run local:realtime

# terminal 2
cd frontend && npm run dev:local
```
Open http://localhost:5173/?as=alice in one tab and http://localhost:5173/?as=bob in another. In the first tab press **Create room**, type the 4-letter code into the second tab and press **Join**, then **Start game** in the first. Both tabs show the same shared seed, and chat messages cross between them.

Want to see a finished game? Follow `frontend/src/examples/xo/README.md` to switch the app to the XO example, then repeat the same two tabs.

Finally, check everything is healthy: `node scripts/verify.mjs` from the repo root runs the type-checks, tests, the frontend build and `cdk synth` (no AWS credentials needed).

## 9. Deploy to AWS

```bash
cd backend
npm run deploy         # creates Cognito, the APIs, Lambdas and tables; writes cdk-outputs.json
npm run env:frontend   # writes frontend/.env.local from the outputs
cd ../frontend
npm run dev            # real sign-in with Cognito, real WebSocket API
```
Open http://localhost:5173, create an account (Cognito emails a code), sign in, and use the **Realtime rooms** card. To test two players with real accounts, use two different browsers or one normal window and one private window with two different email addresses.

Confirm the partner tag is on your resources:
```bash
aws resourcegroupstaggingapi get-resources --tag-filters Key=aws-apn-id --region us-east-1
```

## 10. Deploy the frontend to Amplify (optional)

Follow "Deploy the frontend to Amplify" in the root README. In short: push to GitHub, store a GitHub token in Secrets Manager (`aws secretsmanager create-secret --name github-token --secret-string "<token>"`), set `githubOwner` and `githubRepo` in `backend/cdk.json` (or run `node scripts/init.mjs <name> --github owner/repo`), and run `npm run deploy` again.

The build is driven by `amplify.yml` at the repo root. Watch the first build in the Amplify console, or from the terminal: `aws amplify list-jobs --app-id <AmplifyAppId> --branch-name main`. The hosted build does not run tests, so run `node scripts/verify.mjs` before you push.

On Windows PowerShell, put the secret in single quotes: `--secret-string '<token>'`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `aws: command not found` | Close and reopen the terminal after installing. On Windows, make sure the installer finished. |
| `Unable to locate credentials` or `ExpiredToken` | Run `aws sso login --profile <name>` (SSO) or `aws configure` (keys). Check `AWS_PROFILE` is set. |
| `This stack uses assets, so the toolkit stack must be deployed` | You skipped `npx cdk bootstrap` for this account and region. |
| `cdk synth` fails with a partner tag error | Someone removed or changed the tag. Restore it in `backend/bin/app.ts`. Do not exempt the resource. |
| Frontend shows "Setup needed" | `frontend/.env.local` is missing. Run `npm run env:frontend` in `backend/` after deploying, or use `npm run dev:local` for local testing. |
| WebSocket will not connect on the deployed site | Check `VITE_WS_URL` in `frontend/.env.local` starts with `wss://` and ends with `/prod`, and that you are signed in. |
| `EADDRINUSE` on port 8787 or 5173 | Another copy is still running. Close it, or start the local server on another port (`PORT=8788 npm run local:realtime`; PowerShell: `$env:PORT=8788`) and point the frontend at it with `VITE_LOCAL_WS_URL=ws://localhost:8788 npm run dev:local`. |
| Slow or stuck `npm install` on Windows | Pause real-time antivirus scanning for the project folder, or move the project out of OneDrive. |
| Amplify build fails at `npm ci` with `EUSAGE ... package-lock.json` | `npm ci` ran in the repo root. The build spec must be the root `amplify.yml` that runs `(cd frontend && npm ci)`, and the Amplify app must not be in monorepo mode. See `docs/LESSONS-LEARNED.md`, section 1. |
| Amplify build fails at `npm ci` and `package.json` names another package manager | Remove the `packageManager` and `devEngines` fields. The project uses npm. |
| Amplify build passes but the site shows "Setup needed" | The `VITE_*` variables are missing from the Amplify app, or you changed them without a new build. They are read at build time. |
| `git push` prints `This repository moved` | The GitHub repo was renamed or transferred. Use the new owner and name for `githubOwner` and `githubRepo`, then deploy again. |
| `npm test` in `backend/` fails with `ResourceNotFoundException` and a different number of failures each run | Old copy of the test harness. The DynamoDB emulator table must be `ACTIVE` before use. See `docs/LESSONS-LEARNED.md`, section 2. |
| A room says "You're already in a room" or "We couldn't find a room" after you used one account in two tabs | One account in two tabs is one player. Use two different accounts (a normal and a private window), or `?as=alice` and `?as=bob` locally. See section 3 of `docs/LESSONS-LEARNED.md`. |
| `timeout: command not found` on macOS | macOS has no `timeout`. Use `gtimeout` from Homebrew `coreutils`, or the tool's own timeout. |
