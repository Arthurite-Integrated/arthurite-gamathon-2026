---
inclusion: always
---

# AWS partner tag (mandatory)

Every AWS resource created by this repository MUST carry this tag:

| Key          | Value                            |
| ------------ | -------------------------------- |
| `aws-apn-id` | `pc:8l8gcn23lmlgammd8572tk6va`   |

## How it is applied

- The tag is applied once, at the CDK `App` level, in `backend/bin/app.ts` using `Tags.of(app).add(...)`. It cascades to every stack and every taggable resource automatically.
- The constants live in `backend/lib/partner-tag.ts`. A `PartnerTagEnforcer` aspect fails `cdk synth` if any taggable resource is missing the tag or has a different value.

## Rules for Kiro

- NEVER remove, rename, or change the value of this tag.
- NEVER call `Tags.of(...).remove('aws-apn-id')`, never add `excludeResourceTypes` for it, and never set a different value on any construct.
- NEVER disable, weaken, or delete the `PartnerTagEnforcer` aspect or its tests in `backend/test/stack.test.ts`.
- Do not add a second tagging mechanism for this key. Keep it in `bin/app.ts` only.
- New stacks must be created in `bin/app.ts` so they sit under the same `App` and inherit the tag.
- If a new resource type is not tagged by the app-level aspect, fix it (for example by tagging its taggable L1 child) instead of exempting it.
- After adding resources, run `npm test` and `npx cdk synth` in `backend/`. Both must pass.
