import { App } from 'aws-cdk-lib';

/** All project-level settings come from cdk.json context (or `-c key=value`). */
export interface ProjectConfig {
  projectName: string;
  region: string;
  removeDataOnDestroy: boolean;
  corsAllowedOrigins: string[];
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
  githubTokenSecretName: string;
  enableRealtime: boolean;
  realtimeGraceSeconds: number;
  realtimeRateLimitPerSec: number;
}

export function loadConfig(app: App): ProjectConfig {
  const get = <T>(key: string, fallback: T): T => (app.node.tryGetContext(key) as T | undefined) ?? fallback;

  const projectName = String(get('projectName', 'starter'));
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(projectName)) {
    throw new Error(
      `Invalid projectName "${projectName}". Use 2-31 lowercase letters, digits, or hyphens, starting with a letter.`,
    );
  }

  return {
    projectName,
    region: String(get('region', 'us-east-1')),
    removeDataOnDestroy: String(get('removeDataOnDestroy', true)) !== 'false',
    corsAllowedOrigins: get<string[] | string>('corsAllowedOrigins', ['*']).toString().split(','),
    githubOwner: String(get('githubOwner', '')),
    githubRepo: String(get('githubRepo', '')),
    githubBranch: String(get('githubBranch', 'main')),
    githubTokenSecretName: String(get('githubTokenSecretName', 'github-token')),
    enableRealtime: String(get('enableRealtime', true)) !== 'false',
    realtimeGraceSeconds: Number(get('realtimeGraceSeconds', 30)),
    realtimeRateLimitPerSec: Number(get('realtimeRateLimitPerSec', 30)),
  };
}
