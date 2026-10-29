import { CreateTableCommand, DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import dynalite from 'dynalite';
import type { AddressInfo } from 'net';
import { routeEvent } from '../src/shared/router';
import type { Deps, RoomView, ServerMessage } from '../src/shared/types';

export interface Sent {
  connectionId: string;
  message: ServerMessage;
}

/** Real DynamoDB semantics (conditions, atomic counters, queries) via the dynalite emulator. */
export interface Harness {
  deps: Deps;
  sent: Sent[];
  clock: { t: number };
  connect(connectionId: string, userId: string, name: string): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  act(connectionId: string, body: Record<string, unknown>): Promise<void>;
  to(connectionId: string, type?: string): ServerMessage[];
  last(connectionId: string, type: string): ServerMessage;
  room(connectionId: string, type: string): RoomView;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const server = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  const client = new DynamoDBClient({
    endpoint: `http://127.0.0.1:${port}`,
    region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  await client.send(
    new CreateTableCommand({
      TableName: 'realtime-test',
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
    const { Table } = await client.send(new DescribeTableCommand({ TableName: 'realtime-test' }));
    if (Table?.TableStatus === 'ACTIVE') break;
    if (attempt >= 200) throw new Error('The local DynamoDB table did not become ACTIVE');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const sent: Sent[] = [];
  const clock = { t: 1_700_000_000_000 };
  let seed = 12345;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const deps: Deps = {
    db: DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } }),
    table: 'realtime-test',
    send: async (connectionId, message) => {
      sent.push({ connectionId, message });
      return true;
    },
    now: () => clock.t,
    random,
    graceMs: 30_000,
    rateLimitPerSec: 1000,
    roomTtlSeconds: 86_400,
  };

  const to = (connectionId: string, type?: string) =>
    sent.filter((s) => s.connectionId === connectionId && (!type || s.message.type === type)).map((s) => s.message);

  return {
    deps,
    sent,
    clock,
    to,
    async connect(connectionId, userId, name) {
      await routeEvent(deps, { routeKey: '$connect', connectionId, authorizer: { userId, displayName: name } });
    },
    async disconnect(connectionId) {
      await routeEvent(deps, { routeKey: '$disconnect', connectionId });
    },
    async act(connectionId, body) {
      await routeEvent(deps, { routeKey: String(body.action), connectionId, body: JSON.stringify(body) });
    },
    last(connectionId, type) {
      const all = to(connectionId, type);
      if (all.length === 0) throw new Error(`No "${type}" message sent to ${connectionId}`);
      return all[all.length - 1];
    },
    room(connectionId, type) {
      const m = to(connectionId, type);
      if (m.length === 0) throw new Error(`No "${type}" message sent to ${connectionId}`);
      return m[m.length - 1].payload.room as RoomView;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
