/// <reference path="./dynalite.d.ts" />
/**
 * Local stand-in for API Gateway + Lambda + DynamoDB, so you can build and test a multiplayer
 * frontend without deploying. It runs the SAME room logic as production (src/shared) against an
 * in-memory DynamoDB emulator.
 *
 *   npm run local:realtime            (listens on ws://localhost:8787)
 *
 * Auth is replaced by dev tokens: connect to ws://localhost:8787?token=dev:<userId>:<displayName>.
 * This server is for development only. The deployed API only accepts real Cognito tokens.
 */
import { CreateTableCommand, DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import dynalite from 'dynalite';
import type { AddressInfo } from 'net';
import { WebSocket, WebSocketServer } from 'ws';
import { routeEvent } from '../src/shared/router';
import type { Deps } from '../src/shared/types';

export interface LocalRealtime {
  url: string;
  close: () => Promise<void>;
}

export async function startLocalRealtime(
  options: { port?: number; graceSeconds?: number; rateLimitPerSec?: number; quiet?: boolean } = {},
): Promise<LocalRealtime> {
  const log = (...args: unknown[]) => {
    if (!options.quiet) console.log(...args);
  };

  const dbServer = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve) => dbServer.listen(0, '127.0.0.1', resolve));
  const client = new DynamoDBClient({
    endpoint: `http://127.0.0.1:${(dbServer.address() as AddressInfo).port}`,
    region: 'us-east-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  await client.send(
    new CreateTableCommand({
      TableName: 'local-realtime',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
    }),
  );
  // CreateTable returns before the table is ACTIVE. Wait, or the first write can fail with ResourceNotFoundException.
  for (let attempt = 0; ; attempt++) {
    const { Table } = await client.send(new DescribeTableCommand({ TableName: 'local-realtime' }));
    if (Table?.TableStatus === 'ACTIVE') break;
    if (attempt >= 200) throw new Error('The local DynamoDB table did not become ACTIVE');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const sockets = new Map<string, WebSocket>();
  const deps: Deps = {
    db: DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } }),
    table: 'local-realtime',
    send: async (connectionId, message) => {
      const socket = sockets.get(connectionId);
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    },
    now: () => Date.now(),
    random: Math.random,
    graceMs: (options.graceSeconds ?? 30) * 1000,
    rateLimitPerSec: options.rateLimitPerSec ?? 30,
    roomTtlSeconds: 24 * 60 * 60,
  };

  const wss = new WebSocketServer({ port: options.port ?? 8787 });
  await new Promise<void>((resolve) => wss.once('listening', resolve));

  wss.on('connection', (socket, req) => {
    const token = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token') ?? '';
    const [prefix, userId, ...nameParts] = token.split(':');
    if (prefix !== 'dev' || !userId) {
      socket.close(1008, 'Use ?token=dev:<userId>:<displayName> with the local server');
      return;
    }
    const displayName = nameParts.join(':') || userId;
    const connectionId = randomUUID();
    sockets.set(connectionId, socket);

    const ready = routeEvent(deps, {
      routeKey: '$connect',
      connectionId,
      authorizer: { userId, displayName },
    });
    log(`+ ${displayName} (${userId}) connected`);

    // Like API Gateway, each message is handled independently (no ordering guarantee).
    socket.on('message', (raw) => {
      void ready.then(() => routeEvent(deps, { routeKey: 'message', connectionId, body: raw.toString() }));
    });
    socket.on('close', () => {
      sockets.delete(connectionId);
      log(`- ${displayName} (${userId}) disconnected`);
      void ready.then(() => routeEvent(deps, { routeKey: '$disconnect', connectionId }));
    });
  });

  const port = (wss.address() as AddressInfo).port;
  return {
    url: `ws://localhost:${port}`,
    close: async () => {
      for (const socket of sockets.values()) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => dbServer.close(() => resolve()));
    },
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 8787);
  startLocalRealtime({ port, graceSeconds: Number(process.env.GRACE_SECONDS ?? 30) }).then(({ url }) => {
    console.log(`Local realtime server running at ${url}`);
    console.log('Dev tokens look like: ?token=dev:<userId>:<displayName>');
    console.log('Press Ctrl+C to stop.');
  });
}
