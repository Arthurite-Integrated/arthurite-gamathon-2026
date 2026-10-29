import type { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';

const verify = jest.fn();
jest.mock('aws-jwt-verify', () => ({ CognitoJwtVerifier: { create: () => ({ verify }) } }));

import { handler } from '../src/handlers/ws-authorizer';

const event = (token?: string) =>
  ({ methodArn: 'arn:aws:execute-api:us-east-1:123:abc/prod/$connect', queryStringParameters: token ? { token } : undefined }) as unknown as APIGatewayRequestAuthorizerEvent;

describe('websocket authorizer', () => {
  beforeEach(() => verify.mockReset());

  it('denies a connection with no token', async () => {
    const res = await handler(event());
    expect(res.policyDocument.Statement[0]).toMatchObject({ Effect: 'Deny' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('denies an invalid token', async () => {
    verify.mockRejectedValue(new Error('bad signature'));
    const res = await handler(event('nope'));
    expect(res.policyDocument.Statement[0]).toMatchObject({ Effect: 'Deny' });
  });

  it('allows a valid token and passes the identity on', async () => {
    verify.mockResolvedValue({ sub: 'user-1', email: 'ada@example.com' });
    const res = await handler(event('good'));
    expect(res.policyDocument.Statement[0]).toMatchObject({ Effect: 'Allow' });
    expect(res.context).toEqual({ userId: 'user-1', displayName: 'ada' });
  });

  it('prefers the name claim for the display name', async () => {
    verify.mockResolvedValue({ sub: 'user-2', email: 'x@y.z', name: 'Ada L' });
    const res = await handler(event('good'));
    expect(res.context?.displayName).toBe('Ada L');
  });
});
