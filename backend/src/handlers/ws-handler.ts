import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyWebsocketEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { routeEvent } from '../shared/router';
import type { Deps, ServerMessage } from '../shared/types';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const managementClients = new Map<string, ApiGatewayManagementApiClient>();

function makeSend(endpoint: string): Deps['send'] {
  let client = managementClients.get(endpoint);
  if (!client) {
    client = new ApiGatewayManagementApiClient({ endpoint });
    managementClients.set(endpoint, client);
  }
  const api = client;
  return async (connectionId: string, message: ServerMessage): Promise<boolean> => {
    try {
      await api.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: new TextEncoder().encode(JSON.stringify(message)),
        }),
      );
      return true;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if ((err as Error).name === 'GoneException' || status === 410) return false;
      throw err;
    }
  };
}

type WsEvent = APIGatewayProxyWebsocketEventV2 & {
  requestContext: { authorizer?: Record<string, unknown> };
};

/**
 * Single entry point for $connect, $disconnect, and every client action.
 * All logic lives in ../shared so it can be tested without AWS.
 */
export const handler = async (event: WsEvent): Promise<APIGatewayProxyResultV2> => {
  const { routeKey, connectionId, domainName, stage } = event.requestContext;

  const deps: Deps = {
    db,
    table: process.env.TABLE_NAME as string,
    send: makeSend(`https://${domainName}/${stage}`),
    now: () => Date.now(),
    random: Math.random,
    graceMs: Number(process.env.GRACE_SECONDS ?? 30) * 1000,
    rateLimitPerSec: Number(process.env.RATE_LIMIT_PER_SEC ?? 30),
    roomTtlSeconds: 24 * 60 * 60,
  };

  return routeEvent(deps, {
    routeKey,
    connectionId,
    body: event.body,
    authorizer: event.requestContext.authorizer,
  });
};
