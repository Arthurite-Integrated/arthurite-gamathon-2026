import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { ProjectConfig } from './config';

export interface RealtimeProps {
  config: ProjectConfig;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  /** Creates a Lambda with its own scoped role and log group (BackendStack.createFunction). */
  createFunction: (name: string, entryFile: string, environment?: Record<string, string>) => NodejsFunction;
}

/**
 * App-agnostic realtime rooms: create a room, share a 4-letter code, join, relay messages.
 *   Cognito token -> Lambda authorizer -> WebSocket API -> one Lambda -> DynamoDB
 * See docs/REALTIME-PROTOCOL.md for the message protocol clients use.
 */
export class Realtime extends Construct {
  public readonly table: dynamodb.Table;
  public readonly api: apigw.WebSocketApi;
  public readonly stage: apigw.WebSocketStage;

  constructor(scope: Construct, id: string, props: RealtimeProps) {
    super(scope, id);
    const { config, userPool, userPoolClient, createFunction } = props;

    // Rooms are short-lived, so the table is always safe to delete. TTL removes stale rows.
    this.table = new dynamodb.Table(this, 'RoomsTable', {
      tableName: `${config.projectName}-realtime`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const authorizerFn = createFunction('WsAuthorizer', 'ws-authorizer.ts', {
      USER_POOL_ID: userPool.userPoolId,
      USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
    });

    const handlerFn = createFunction('WsHandler', 'ws-handler.ts', {
      TABLE_NAME: this.table.tableName,
      GRACE_SECONDS: String(config.realtimeGraceSeconds),
      RATE_LIMIT_PER_SEC: String(config.realtimeRateLimitPerSec),
    });

    // Least privilege: only the rooms table, only the five actions the code calls (no Scan, no batch),
    // and only posting to this API's own connections.
    this.table.grant(
      handlerFn,
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
      'dynamodb:Query',
    );

    const integration = new WebSocketLambdaIntegration('WsIntegration', handlerFn);
    const authorizer = new WebSocketLambdaAuthorizer('WsAuthorizerRoute', authorizerFn, {
      identitySource: ['route.request.querystring.token'],
    });

    this.api = new apigw.WebSocketApi(this, 'WsApi', {
      apiName: `${config.projectName}-realtime`,
      connectRouteOptions: { integration, authorizer },
      disconnectRouteOptions: { integration },
      defaultRouteOptions: { integration },
    });
    for (const action of ['createRoom', 'joinRoom', 'leaveRoom', 'start', 'send', 'ping']) {
      this.api.addRoute(action, { integration });
    }

    this.stage = new apigw.WebSocketStage(this, 'WsStage', {
      webSocketApi: this.api,
      stageName: 'prod',
      autoDeploy: true,
    });
    (this.stage.node.defaultChild as apigw.CfnStage).defaultRouteSettings = {
      throttlingRateLimit: 200,
      throttlingBurstLimit: 400,
    };

    this.api.grantManageConnections(handlerFn);

    new CfnOutput(Stack.of(this), 'WebSocketUrl', { value: this.stage.url });
  }
}
