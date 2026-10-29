import { Annotations, IAspect, TagManager } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

/**
 * Arthurite AWS partner tag. Every taggable resource in every stack must carry it.
 * Do NOT change, remove, or override this tag. See .kiro/steering/aws-partner-tag.md.
 */
export const PARTNER_TAG_KEY = 'aws-apn-id';
export const PARTNER_TAG_VALUE = 'pc:8l8gcn23lmlgammd8572tk6va';

/**
 * Fails `cdk synth` / `cdk deploy` if any taggable construct is missing the partner
 * tag or carries a different value. Runs after the tagging aspect, so it only reports
 * real problems (e.g. someone called Tags.of(...).remove or set another value).
 */
export class PartnerTagEnforcer implements IAspect {
  public visit(node: IConstruct): void {
    if (!TagManager.isTaggable(node)) return;

    const actual = (node as unknown as { tags: TagManager }).tags.tagValues()[PARTNER_TAG_KEY];
    if (actual !== PARTNER_TAG_VALUE) {
      Annotations.of(node).addError(
        `Missing or incorrect partner tag. Expected ${PARTNER_TAG_KEY}=${PARTNER_TAG_VALUE}, found ${
          actual === undefined ? 'no tag' : `"${actual}"`
        }. Every resource must carry this tag.`,
      );
    }
  }
}
