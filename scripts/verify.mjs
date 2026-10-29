#!/usr/bin/env node
/**
 * Runs every gate the project requires before work counts as done, and prints a summary.
 * Works on Windows, macOS and Linux (plain Node, no bash).
 *
 *   node scripts/verify.mjs            run everything
 *   node scripts/verify.mjs backend    only the backend gates
 *   node scripts/verify.mjs frontend   only the frontend gates
 *
 * It needs the dependencies installed (`npm ci` in backend/ and frontend/) and no AWS credentials.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const gates = {
  backend: [
    ['type-check', 'npm run build'],
    ['tests', 'npm test'],
    ['cdk synth (includes the partner tag check)', 'npx cdk synth --quiet'],
  ],
  frontend: [
    ['type-check and build', 'npm run build'],
    ['tests', 'npm test'],
  ],
};

const only = process.argv[2];
if (only && !(only in gates)) {
  console.error(`Unknown target "${only}". Use "backend", "frontend", or nothing for both.`);
  process.exit(2);
}

const results = [];
for (const [dir, steps] of Object.entries(gates)) {
  if (only && only !== dir) continue;
  const cwd = join(root, dir);
  if (!existsSync(join(cwd, 'node_modules'))) {
    console.error(`\n${dir}/node_modules is missing. Run: cd ${dir} && npm ci`);
    process.exit(2);
  }
  for (const [name, command] of steps) {
    console.log(`\n=== ${dir}: ${name} (${command})`);
    const started = Date.now();
    const run = spawnSync(command, { cwd, shell: true, stdio: 'inherit' });
    results.push({ label: `${dir}: ${name}`, ok: run.status === 0, seconds: Math.round((Date.now() - started) / 1000) });
  }
}

console.log('\n=== Summary');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label} (${r.seconds}s)`);
const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} gate(s) failed.`);
  process.exit(1);
}
console.log('\nAll gates passed.');
