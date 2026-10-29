#!/usr/bin/env node
/**
 * Names a new project made from this boilerplate. Run it once, right after copying the folder.
 *
 *   node scripts/init.mjs my-app
 *   node scripts/init.mjs my-app --github my-org/my-repo      also set the repo Amplify builds from
 *   node scripts/init.mjs my-app --region eu-west-1
 *
 * It edits backend/cdk.json (projectName, and optionally region, githubOwner, githubRepo) and
 * frontend/.env.example. Nothing else. It never touches AWS.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`--${name} needs a value.`);
  return value;
}

function fail(message) {
  console.error(`\n${message}\n`);
  console.error('Usage: node scripts/init.mjs <project-name> [--github owner/repo] [--region us-east-1]');
  process.exit(1);
}

const name = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!name) fail('Give your project a name.');
// Same rule as backend/lib/config.ts, so a bad name fails here and not at deploy time.
if (!/^[a-z][a-z0-9-]{1,30}$/.test(name)) {
  fail(`"${name}" is not a valid name. Use 2 to 31 lowercase letters, digits or hyphens, starting with a letter.`);
}

const github = option('github');
let owner;
let repo;
if (github !== undefined) {
  [owner, repo] = github.split('/');
  if (!owner || !repo || github.split('/').length !== 2 || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    fail(`--github must look like owner/repo, for example my-org/my-repo. Got "${github}".`);
  }
}
const region = option('region');
if (region !== undefined && !/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) {
  fail(`"${region}" does not look like an AWS region, for example us-east-1.`);
}

// backend/cdk.json
const cdkPath = join(root, 'backend', 'cdk.json');
const cdk = JSON.parse(readFileSync(cdkPath, 'utf8'));
cdk.context.projectName = name;
if (region) cdk.context.region = region;
if (github) {
  cdk.context.githubOwner = owner;
  cdk.context.githubRepo = repo;
}
writeFileSync(cdkPath, `${JSON.stringify(cdk, null, 2)}\n`);

// frontend/.env.example (only the placeholder lines; real values come from `npm run env:frontend`)
const envPath = join(root, 'frontend', '.env.example');
const env = readFileSync(envPath, 'utf8')
  .replace(/^VITE_PROJECT_NAME=.*$/m, `VITE_PROJECT_NAME=${name}`)
  .replace(/(execute-api\.)[a-z0-9-]+(\.amazonaws\.com)/g, (_m, a, b) => `${a}${region ?? cdk.context.region}${b}`)
  .replace(/^VITE_REGION=.*$/m, `VITE_REGION=${region ?? cdk.context.region}`);
writeFileSync(envPath, env);

console.log(`Project "${name}" is set up.`);
console.log(`  backend/cdk.json: projectName=${cdk.context.projectName}, region=${cdk.context.region}`);
console.log(`  GitHub repo for Amplify: ${cdk.context.githubOwner && cdk.context.githubRepo ? `${cdk.context.githubOwner}/${cdk.context.githubRepo}` : '(not set, the frontend stack will be skipped)'}`);
console.log('\nNext: cd backend && npm install && npx cdk bootstrap && npm run deploy   (see docs/SETUP.md)');
