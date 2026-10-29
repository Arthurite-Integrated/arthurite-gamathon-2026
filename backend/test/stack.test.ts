import { readFileSync } from 'fs';
import { join } from 'path';
import { App, AspectPriority, Aspects, Tags } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { BackendStack } from '../lib/backend-stack';
import { AMPLIFY_SPEC_PATH, FrontendStack } from '../lib/frontend-stack';
import { loadConfig } from '../lib/config';
import { PARTNER_TAG_KEY, PARTNER_TAG_VALUE, PartnerTagEnforcer } from '../lib/partner-tag';

// 'aws:cdk:bundling-stacks': [] skips esbuild bundling so these tests stay fast.
const context = { projectName: 'testproj', githubOwner: 'acme', githubRepo: 'demo', 'aws:cdk:bundling-stacks': [] };

function buildApp(opts: { tag: boolean }) {
  const app = new App({ context });
  const config = loadConfig(app);
  const env = { account: '123456789012', region: 'us-east-1' };
  const backend = new BackendStack(app, 'backend', { env, config });
  const frontend = new FrontendStack(app, 'frontend', { env, config, backend });
  if (opts.tag) Tags.of(app).add(PARTNER_TAG_KEY, PARTNER_TAG_VALUE);
  Aspects.of(app).add(new PartnerTagEnforcer(), { priority: AspectPriority.READONLY });
  return { app, backend, frontend };
}

describe('backend stack', () => {
  const { backend } = buildApp({ tag: true });
  const template = Template.fromStack(backend);

  it('creates the core serverless resources', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 2); // HTTP API + WebSocket API
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', { ProtocolType: 'HTTP' });
    template.resourceCountIs('AWS::DynamoDB::Table', 2); // app data + realtime rooms
    template.hasResourceProperties('AWS::DynamoDB::Table', { BillingMode: 'PAY_PER_REQUEST' });
    template.hasResourceProperties('AWS::Lambda::Function', { Runtime: 'nodejs22.x' });
  });

  it('protects /me with a JWT authorizer', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /me',
      AuthorizationType: 'JWT',
    });
  });

  it('gives each Lambda its own role', () => {
    const functions = Object.keys(template.findResources('AWS::Lambda::Function')).length;
    expect(functions).toBe(3); // me, ws authorizer, ws handler
    template.resourceCountIs('AWS::IAM::Role', functions);
  });
});

describe('realtime rooms', () => {
  const { backend } = buildApp({ tag: true });
  const template = Template.fromStack(backend);
  const expectedTag = Match.arrayWith([{ Key: PARTNER_TAG_KEY, Value: PARTNER_TAG_VALUE }]);

  it('creates a WebSocket API with a Lambda REQUEST authorizer reading the token query string', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', { ProtocolType: 'WEBSOCKET' });
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'REQUEST',
      IdentitySource: ['route.request.querystring.token'],
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: '$connect', AuthorizationType: 'CUSTOM' });
  });

  it('has a route for every client action', () => {
    for (const key of ['$disconnect', '$default', 'createRoom', 'joinRoom', 'leaveRoom', 'start', 'send', 'ping']) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: key });
    }
  });

  it('stores rooms in an on-demand table with a TTL', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'testproj-realtime',
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('tags the new resources with the partner tag', () => {
    const tagMap = Match.objectLike({ [PARTNER_TAG_KEY]: PARTNER_TAG_VALUE });
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', { ProtocolType: 'WEBSOCKET', Tags: tagMap });
    template.hasResourceProperties('AWS::DynamoDB::Table', { TableName: 'testproj-realtime', Tags: expectedTag });
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', { StageName: 'prod', Tags: tagMap });
  });

  it('outputs the WebSocket URL', () => {
    template.hasOutput('WebSocketUrl', {});
  });

  it('does not grant wildcard DynamoDB access', () => {
    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    const actions = policies.flatMap((p) =>
      (p.Properties.PolicyDocument.Statement as Array<{ Action: string | string[] }>).flatMap((st) => st.Action),
    );
    expect(actions).not.toContain('dynamodb:*');
    expect(actions).not.toContain('*');
    expect(actions).not.toContain('dynamodb:Scan'); // the room handler never scans
    expect(actions).toContain('execute-api:ManageConnections');
  });

  it('can be switched off with enableRealtime=false', () => {
    const app = new App({ context: { ...context, enableRealtime: false } });
    const stack = new BackendStack(app, 'off', { env: { account: '123456789012', region: 'us-east-1' }, config: loadConfig(app) });
    const t = Template.fromStack(stack);
    t.resourceCountIs('AWS::ApiGatewayV2::Api', 1); // only the HTTP API remains
    t.resourceCountIs('AWS::DynamoDB::Table', 1);
    t.resourceCountIs('AWS::Lambda::Function', 1);
  });
});

describe('amplify build spec', () => {
  const { frontend } = buildApp({ tag: true });
  const template = Template.fromStack(frontend);
  const rootSpec = readFileSync(AMPLIFY_SPEC_PATH, 'utf8');
  // The file explains itself in comments, which mention the very keys we forbid. Only look at real lines.
  const specLines = rootSpec
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

  it('is exactly the amplify.yml at the repo root, so the stack and the repo cannot disagree', () => {
    template.hasResourceProperties('AWS::Amplify::App', { BuildSpec: rootSpec });
  });

  it('builds inside /frontend and publishes frontend/dist', () => {
    expect(specLines).toContain('(cd frontend && npm ci)');
    expect(specLines).toContain('(cd frontend && npm run build)');
    expect(specLines).toMatch(/baseDirectory:\s*frontend\/dist/);
    expect(specLines).toMatch(/frontend\/node_modules/);
  });

  it('is a flat spec: the app is not in monorepo mode, so no appRoot and no AMPLIFY_MONOREPO_APP_ROOT', () => {
    // Mixing the two forms is what broke the first hosted build: npm ci ran in the repo root.
    expect(specLines).toMatch(/^frontend:/m);
    expect(specLines).not.toMatch(/^applications:/m);
    expect(specLines).not.toMatch(/appRoot:/);
    const app = Object.values(template.findResources('AWS::Amplify::App'))[0];
    const names = (app.Properties.EnvironmentVariables as Array<{ Name: string }>).map((v) => v.Name);
    expect(names).not.toContain('AMPLIFY_MONOREPO_APP_ROOT');
  });

  it('does not depend on a package manager other than npm', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'frontend', 'package.json'), 'utf8')) as Record<string, unknown>;
    // npm refuses to run `npm ci` when package.json pins another tool with packageManager or devEngines.
    expect(pkg.packageManager).toBeUndefined();
    expect(pkg.devEngines).toBeUndefined();
  });
});

describe('partner tag', () => {
  it('is present on the stack and its main resources', () => {
    const { backend, frontend } = buildApp({ tag: true });
    const expected = Match.arrayWith([{ Key: PARTNER_TAG_KEY, Value: PARTNER_TAG_VALUE }]);

    const b = Template.fromStack(backend);
    b.hasResourceProperties('AWS::DynamoDB::Table', { Tags: expected });
    b.hasResourceProperties('AWS::Lambda::Function', { Tags: expected });
    b.hasResourceProperties('AWS::IAM::Role', { Tags: expected });

    const f = Template.fromStack(frontend);
    f.hasResourceProperties('AWS::Amplify::App', { Tags: expected });
    f.hasResourceProperties('AWS::Amplify::App', {
      EnvironmentVariables: Match.arrayWith([Match.objectLike({ Name: 'VITE_WS_URL' })]),
    });
  });

  it('fails synth when the tag is missing', () => {
    const { backend } = buildApp({ tag: false });
    const errors = Annotations.fromStack(backend).findError('*', Match.stringLikeRegexp(PARTNER_TAG_KEY));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('passes with no tag errors when the tag is applied', () => {
    const { backend, frontend } = buildApp({ tag: true });
    expect(Annotations.fromStack(backend).findError('*', Match.stringLikeRegexp(PARTNER_TAG_KEY))).toHaveLength(0);
    expect(Annotations.fromStack(frontend).findError('*', Match.stringLikeRegexp(PARTNER_TAG_KEY))).toHaveLength(0);
  });
});
