import { checkRate, createRoom, handleDisconnect, joinRoom, leaveRoom, ping, registerConnection, relay, startGame } from './rooms';
import { Deps, RoomError } from './types';
import { parseClientMessage, sanitizeDisplayName } from './validate';

export interface RouteInput {
  routeKey: string;
  connectionId: string;
  body?: string | null;
  /** Context returned by the Lambda authorizer; only present on $connect. */
  authorizer?: Record<string, unknown>;
}

/**
 * Dispatches one API Gateway WebSocket event. Expected failures are sent to the caller as an
 * `error` message; the function itself never throws for them, so API Gateway keeps the socket open.
 * Returns the HTTP status for API Gateway.
 */
export async function routeEvent(deps: Deps, input: RouteInput): Promise<{ statusCode: number }> {
  const { routeKey, connectionId } = input;

  if (routeKey === '$connect') {
    const userId = input.authorizer?.userId;
    if (typeof userId !== 'string' || userId.length === 0) return { statusCode: 401 };
    await registerConnection(deps, {
      connectionId,
      userId,
      displayName: sanitizeDisplayName(input.authorizer?.displayName, 'player'),
    });
    return { statusCode: 200 };
  }

  if (routeKey === '$disconnect') {
    await handleDisconnect(deps, connectionId);
    return { statusCode: 200 };
  }

  try {
    await checkRate(deps, connectionId);
    const message = parseClientMessage(input.body);
    switch (message.action) {
      case 'createRoom':
        await createRoom(deps, connectionId, message);
        break;
      case 'joinRoom':
        await joinRoom(deps, connectionId, message);
        break;
      case 'leaveRoom':
        await leaveRoom(deps, connectionId);
        break;
      case 'start':
        await startGame(deps, connectionId, message.settings);
        break;
      case 'send':
        await relay(deps, connectionId, message);
        break;
      case 'ping':
        await ping(deps, connectionId);
        break;
    }
  } catch (err) {
    if (err instanceof RoomError) {
      await deps.send(connectionId, { type: 'error', payload: { code: err.code, message: err.message } });
    } else {
      // Log the failure but never the message body, which may contain user data.
      console.error('Unhandled realtime error', err instanceof Error ? err.name : 'unknown');
      await deps.send(connectionId, {
        type: 'error',
        payload: { code: 'internal_error', message: 'Something went wrong. Try again.' },
      });
    }
  }
  return { statusCode: 200 };
}
