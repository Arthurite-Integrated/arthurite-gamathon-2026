#!/usr/bin/env node
import { App, AspectPriority, Aspects, Tags } from 'aws-cdk-lib';
import { loadConfig } from '../lib/config';
import { BackendStack } from '../lib/backend-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { PARTNER_TAG_KEY, PARTNER_TAG_VALUE, PartnerTagEnforcer } from '../lib/partner-tag';

const app = new App();
const config = loadConfig(app);

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: config.region,
};

const backend = new BackendStack(app, `${config.projectName}-backend`, { env, config });

// The frontend (Amplify Hosting) is only created once a GitHub repo is configured in cdk.json.
if (config.githubOwner && config.githubRepo) {
  new FrontendStack(app, `${config.projectName}-frontend`, { env, config, backend });
} else {
  console.warn(
    '[info] githubOwner/githubRepo not set in cdk.json: skipping the Amplify frontend stack. ' +
      'Only the backend will be deployed.',
  );
}

// Partner tag: applied once at app level so it cascades to every stack and taggable resource...
Tags.of(app).add(PARTNER_TAG_KEY, PARTNER_TAG_VALUE);
// ...and enforced: synth fails if any taggable resource is missing it or has a different value.
Aspects.of(app).add(new PartnerTagEnforcer(), { priority: AspectPriority.READONLY });

app.synth();
