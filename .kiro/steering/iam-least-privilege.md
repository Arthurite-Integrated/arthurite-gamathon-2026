---
inclusion: always
---

# IAM and security: least privilege

## Lambda roles

- Every Lambda gets its OWN execution role. Create functions with the `createFunction` helper in `backend/lib/backend-stack.ts`, which creates one role and one log group per function. Do not share a role between functions.
- The role starts with logging only (`AWSLambdaBasicExecutionRole`). Add permissions per resource, per action.

## Granting access

- Use the narrowest CDK grant method: `table.grantReadData(fn)`, `table.grantWriteData(fn)`, `bucket.grantRead(fn)`, `queue.grantSendMessages(fn)`.
- Do NOT use `grantReadWriteData`/`grantFullAccess` unless the function truly reads and writes.
- Do NOT use wildcard actions (`*`, `dynamodb:*`, `s3:*`) or wildcard resources (`Resource: "*"`) in policies. If a wildcard resource is unavoidable (for example `xray:PutTraceSegments`), add a one-line comment explaining why.
- Do NOT attach `AdministratorAccess` or other broad managed policies to anything.

## API and auth

- Every HTTP route is protected by the Cognito JWT authorizer unless a requirement explicitly says it is public. Public routes must be listed in the spec.
- The ONE documented exception is the realtime WebSocket API (`backend/lib/realtime.ts`). API Gateway WebSocket APIs cannot use the built-in JWT authorizer, so `$connect` uses a Lambda REQUEST authorizer that verifies the Cognito ID token with `aws-jwt-verify`. Do not remove it, and do not add other routes without an authorizer.
- Never log tokens, including the WebSocket `?token=` query string.
- Identify the caller from the verified token (`event.requestContext.authorizer.jwt.claims.sub`). Never accept a user id from the request body, path, or query string for authorization.
- Validate and bound all input (types, lengths, ranges) and return `400` with `{ "message": "..." }` for bad input.

## Secrets and logging

- Never hard-code secrets, tokens, or keys. Use Secrets Manager or SSM Parameter Store and read them at runtime or deploy time.
- Never log JWTs, passwords, or full request bodies that may contain personal data.
- Keep S3 buckets private with `blockPublicAccess: BLOCK_ALL`, enforce SSL, and turn on encryption.
- Keep DynamoDB point-in-time recovery enabled for tables holding user data.
