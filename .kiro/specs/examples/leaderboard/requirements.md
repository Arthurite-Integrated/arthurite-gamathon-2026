<!--
WORKED EXAMPLE (read-only reference). Nothing in the code depends on this file.
It shows what a small, good requirements doc in EARS format looks like.
For your own project, copy .kiro/specs/requirements.template.md instead.
-->

# Requirements Document

## Introduction

A simple authenticated Leaderboard API built on AWS serverless services
(API Gateway, Lambda, DynamoDB, Cognito). It maintains a single global
leaderboard where each authenticated user has one best score. Higher
scores rank higher.

## Requirements

### Requirement 1: Authentication

**User Story:** As a player, I want to sign in so that only I can submit scores under my identity.

#### Acceptance Criteria

1. WHEN a request is made to any endpoint without a valid JWT THEN the system SHALL respond with 401 Unauthorized.
2. WHEN a request carries a valid JWT from the configured Cognito user pool THEN the system SHALL identify the caller by the token's `sub` claim.
3. The system SHALL NOT accept a user identifier from the request body or query string for score submission.

### Requirement 2: Submit a score

**User Story:** As a player, I want to submit my score so that I can appear on the leaderboard.

#### Acceptance Criteria

1. WHEN an authenticated user sends POST /scores with a numeric `score` THEN the system SHALL record it for that user.
2. WHEN the submitted score is higher than the user's stored best THEN the system SHALL replace the stored best and respond with 200 and the new best score.
3. WHEN the submitted score is less than or equal to the user's stored best THEN the system SHALL keep the existing best and respond with 200 and the existing best score.
4. IF `score` is missing, not a number, negative, or not a finite value THEN the system SHALL respond with 400 Bad Request.

### Requirement 3: View the leaderboard

**User Story:** As a player, I want to see the top scores so that I know who is leading.

#### Acceptance Criteria

1. WHEN an authenticated user sends GET /leaderboard THEN the system SHALL return the top 10 entries ordered by score descending.
2. WHERE a `limit` query parameter is provided THEN the system SHALL return that many entries, up to a maximum of 100.
3. IF `limit` is not a positive integer or exceeds 100 THEN the system SHALL respond with 400 Bad Request.
4. WHEN two users have the same score THEN the system SHALL rank the user who achieved it earlier first.
5. Each entry SHALL include `rank`, `userId`, `displayName`, and `score`.

### Requirement 4: View my rank

**User Story:** As a player, I want to see my own rank so that I know where I stand.

#### Acceptance Criteria

1. WHEN an authenticated user sends GET /leaderboard/me THEN the system SHALL return that user's `rank` and `score`.
2. IF the user has not submitted a score THEN the system SHALL respond with 404 Not Found.

### Requirement 5: Non-functional

#### Acceptance Criteria

1. The system SHALL be fully serverless, with no servers to provision or manage.
2. The system SHALL define all infrastructure as code (AWS CDK).
3. The system SHALL return JSON responses with consistent error bodies containing a `message` field.
4. The system SHALL log errors to CloudWatch without logging JWTs.

## Out of Scope (v1)

- Multiple leaderboards, seasons, or resets
- Score history or deleting scores
- Anti-cheat or score verification
- Admin endpoints
