/**
 * Writes ../frontend/.env.local from the stack outputs created by `npm run deploy`
 * (cdk-outputs.json). Run with: npm run env:frontend
 */
import * as fs from 'fs';
import * as path from 'path';

const outputsPath = path.join(__dirname, '..', 'cdk-outputs.json');
const envPath = path.join(__dirname, '..', '..', 'frontend', '.env.local');

if (!fs.existsSync(outputsPath)) {
  console.error('cdk-outputs.json not found. Run `npm run deploy` in /backend first.');
  process.exit(1);
}

const outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf8')) as Record<string, Record<string, string>>;
const backendKey = Object.keys(outputs).find((k) => k.endsWith('-backend'));

if (!backendKey) {
  console.error('No "*-backend" stack found in cdk-outputs.json.');
  process.exit(1);
}

const o = outputs[backendKey];
const lines = [
  `VITE_PROJECT_NAME=${o.ProjectName}`,
  `VITE_API_URL=${o.ApiUrl}`,
  `VITE_REGION=${o.Region}`,
  `VITE_USER_POOL_ID=${o.UserPoolId}`,
  `VITE_USER_POOL_CLIENT_ID=${o.UserPoolClientId}`,
];
// Only present when realtime rooms are enabled (enableRealtime in cdk.json).
if (o.WebSocketUrl) lines.push(`VITE_WS_URL=${o.WebSocketUrl}`);

fs.writeFileSync(envPath, lines.join('\n') + '\n');
console.log(`Wrote ${path.relative(process.cwd(), envPath)}`);
