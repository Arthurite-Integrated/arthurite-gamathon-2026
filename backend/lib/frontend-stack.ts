import { readFileSync } from 'fs';
import { join } from 'path';
import { CfnOutput, Stack, StackProps, SecretValue } from 'aws-cdk-lib';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import { Construct } from 'constructs';
import { ProjectConfig } from './config';
import { BackendStack } from './backend-stack';

/** The build spec at the repository root (backend/lib -> backend -> repo root). */
export const AMPLIFY_SPEC_PATH = join(__dirname, '..', '..', 'amplify.yml');

export interface FrontendStackProps extends StackProps {
  config: ProjectConfig;
  backend: BackendStack;
}

/**
 * Amplify Hosting for the Vite + React app in /frontend, connected to GitHub.
 * Every push to the configured branch builds and deploys the site.
 *
 * Prerequisite (one time): store a GitHub personal access token in Secrets Manager
 * under the name set in `githubTokenSecretName`. See the root README.
 */
export class FrontendStack extends Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);
    const { config, backend } = props;

    const app = new amplify.CfnApp(this, 'App', {
      name: `${config.projectName}-web`,
      repository: `https://github.com/${config.githubOwner}/${config.githubRepo}`,
      accessToken: SecretValue.secretsManager(config.githubTokenSecretName).unsafeUnwrap(),
      platform: 'WEB',
      // One source of truth: the same file Amplify would find in the repo. It overrides any spec saved in the
      // console, so keeping the stack and the repo on the same text avoids a build that behaves differently
      // depending on which one wins. The app is NOT in monorepo mode; the spec runs commands inside /frontend itself.
      buildSpec: readFileSync(AMPLIFY_SPEC_PATH, 'utf8'),
      // Single-page app: send unknown paths to index.html
      customRules: [
        {
          source: '</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>',
          target: '/index.html',
          status: '200',
        },
      ],
      environmentVariables: [
        { name: 'VITE_PROJECT_NAME', value: config.projectName },
        { name: 'VITE_API_URL', value: backend.api.apiEndpoint },
        { name: 'VITE_REGION', value: backend.region },
        { name: 'VITE_USER_POOL_ID', value: backend.userPool.userPoolId },
        { name: 'VITE_USER_POOL_CLIENT_ID', value: backend.userPoolClient.userPoolClientId },
        ...(backend.realtime ? [{ name: 'VITE_WS_URL', value: backend.realtime.stage.url }] : []),
      ],
    });

    const branch = new amplify.CfnBranch(this, 'Branch', {
      appId: app.attrAppId,
      branchName: config.githubBranch,
      enableAutoBuild: true,
      stage: 'PRODUCTION',
    });

    new CfnOutput(this, 'AmplifyAppId', { value: app.attrAppId });
    new CfnOutput(this, 'SiteUrl', {
      value: `https://${branch.branchName}.${app.attrDefaultDomain}`,
    });
  }
}
