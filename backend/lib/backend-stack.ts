import * as path from 'path';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { ProjectConfig } from './config';
import { Realtime } from './realtime';

export interface BackendStackProps extends StackProps {
  config: ProjectConfig;
}

/**
 * Neutral authenticated serverless backend:
 *   Cognito user pool -> HTTP API (JWT authorizer) -> Lambda -> DynamoDB
 * Add your own routes by following the GET /me example below.
 */
export class BackendStack extends Stack {
  public readonly api: apigw.HttpApi;
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly table: dynamodb.Table;
  public readonly realtime?: Realtime;

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);
    const { config } = props;
    const removalPolicy = config.removeDataOnDestroy ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;

    // ---------- Auth ----------
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${config.projectName}-users`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy,
    });

    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `${config.projectName}-web`,
      generateSecret: false, // browser clients cannot keep a secret
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    // ---------- Data ----------
    this.table = new dynamodb.Table(this, 'Table', {
      tableName: `${config.projectName}-data`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy,
    });

    // ---------- API ----------
    this.api = new apigw.HttpApi(this, 'HttpApi', {
      apiName: `${config.projectName}-api`,
      corsPreflight: {
        allowOrigins: config.corsAllowedOrigins,
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.PUT,
          apigw.CorsHttpMethod.PATCH,
          apigw.CorsHttpMethod.DELETE,
          apigw.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: Duration.hours(1),
      },
    });

    const authorizer = new HttpUserPoolAuthorizer('JwtAuthorizer', this.userPool, {
      userPoolClients: [this.userPoolClient],
    });

    // ---------- Example route: GET /me ----------
    const meFn = this.createFunction('Me', 'me.ts', {
      TABLE_NAME: this.table.tableName,
    });
    // Least privilege: grant only what the function uses. /me touches no data yet, so it gets no table access.
    // When you add data access, use e.g. this.table.grantReadData(fn) or grantWriteData(fn), never grantFullAccess.

    this.api.addRoutes({
      path: '/me',
      methods: [apigw.HttpMethod.GET],
      integration: new HttpLambdaIntegration('MeIntegration', meFn),
      authorizer,
    });

    // ---------- Realtime rooms (optional, app-agnostic) ----------
    if (config.enableRealtime) {
      this.realtime = new Realtime(this, 'Realtime', {
        config,
        userPool: this.userPool,
        userPoolClient: this.userPoolClient,
        createFunction: (name, entryFile, environment) => this.createFunction(name, entryFile, environment),
      });
    }

    // ---------- Outputs ----------
    new CfnOutput(this, 'ApiUrl', { value: this.api.apiEndpoint });
    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, 'Region', { value: this.region });
    new CfnOutput(this, 'ProjectName', { value: config.projectName });
  }

  /**
   * Creates a Lambda with its own scoped execution role and log group.
   * Use this helper for every new function so roles stay one-per-function.
   */
  protected createFunction(name: string, entryFile: string, environment: Record<string, string> = {}): NodejsFunction {
    const role = new iam.Role(this, `${name}Role`, {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: `Execution role for the ${name} function (logs only; grant more per resource)`,
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    });

    const logGroup = new logs.LogGroup(this, `${name}Logs`, {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    return new NodejsFunction(this, `${name}Function`, {
      entry: path.join(__dirname, '..', 'src', 'handlers', entryFile),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      role,
      logGroup,
      environment,
      bundling: { minify: true, sourceMap: true, target: 'node22' },
    });
  }
}
