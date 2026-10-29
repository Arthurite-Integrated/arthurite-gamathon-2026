import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { sanitizeDisplayName } from '../shared/validate';

/**
 * WebSocket $connect authorizer.
 * API Gateway WebSocket APIs cannot use the built-in JWT authorizer, so this Lambda verifies the
 * Cognito ID token (sent as ?token=...) and passes the caller's identity on to $connect.
 *
 * Never log the token: it is a credential and appears in the URL.
 */
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID as string,
  clientId: process.env.USER_POOL_CLIENT_ID as string,
  tokenUse: 'id',
});

function policy(effect: 'Allow' | 'Deny', methodArn: string, context?: Record<string, string>): APIGatewayAuthorizerResult {
  return {
    principalId: context?.userId ?? 'anonymous',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: methodArn }],
    },
    context,
  };
}

export const handler = async (event: APIGatewayRequestAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  const token = event.queryStringParameters?.token;
  if (!token) return policy('Deny', event.methodArn);

  try {
    const claims = await verifier.verify(token);
    const email = typeof claims.email === 'string' ? claims.email : '';
    const name = typeof claims.name === 'string' ? claims.name : email.split('@')[0];
    return policy('Allow', event.methodArn, {
      userId: claims.sub,
      displayName: sanitizeDisplayName(name, 'player'),
    });
  } catch {
    return policy('Deny', event.methodArn);
  }
};
