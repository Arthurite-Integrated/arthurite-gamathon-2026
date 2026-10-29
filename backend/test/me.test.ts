import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handler } from '../src/handlers/me';

function eventWithClaims(claims: Record<string, string> | undefined): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    requestContext: { authorizer: claims ? { jwt: { claims, scopes: [] } } : undefined },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('GET /me', () => {
  it('returns the caller identity from the JWT claims', async () => {
    const res = (await handler(eventWithClaims({ sub: 'user-123', email: 'a@b.com' }))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toMatchObject({ userId: 'user-123', email: 'a@b.com' });
  });

  it('returns 401 when there is no sub claim', async () => {
    const res = (await handler(eventWithClaims(undefined))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ message: 'Unauthorized' });
  });
});
