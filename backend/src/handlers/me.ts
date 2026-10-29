import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';

/**
 * GET /me
 * Returns the identity of the caller, taken from the verified Cognito JWT.
 * API Gateway has already validated the token before this function runs.
 * Never trust a user id sent in the body or query string; always use the token's `sub`.
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  const claims = event.requestContext.authorizer?.jwt?.claims;

  if (!claims?.sub) {
    return json(401, { message: 'Unauthorized' });
  }

  return json(200, {
    userId: claims.sub,
    email: claims.email ?? null,
    issuedAt: claims.iat ?? null,
    message: 'Authentication is working.',
  });
};

function json(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
