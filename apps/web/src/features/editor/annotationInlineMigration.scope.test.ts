import { afterAll, beforeAll, expect, it } from 'vitest';
import { anchorForBlock, projectMarkdown, type ContentAnchor } from '@study-accelerator/content-anchor';
import type { Annotation } from '@study-accelerator/web-core';
import { planNoteMigration, type MigrationCodec } from './annotationInlineMigration';
import { createMigrationCodec } from './annotationInlineMigration.testing';

let codec: MigrationCodec & { destroy(): Promise<void> };
beforeAll(async () => {
  codec = await createMigrationCodec();
});
afterAll(async () => {
  await codec.destroy();
});

const annotation = (id: string, anchor: ContentAnchor, extra: Partial<Annotation> = {}) =>
  ({
    id,
    schemaVersion: 2,
    scopeType: anchor.scopeType,
    anchor,
    quoteText: anchor.quoteText,
    kind: 'important',
    importance: 'normal',
    lifecycleStatus: 'active',
    anchorStatus: 'resolved',
    status: 'active',
    ...extra
  }) as unknown as Annotation;

it.each(['> alpha\n>\n> beta\n\noutside\n', '- alpha\n\n  beta\n\n- outside\n'])(
  '迁移续段重点不会扩大到祖先或下一个同级项：%s',
  source => {
    const markdown = codec.serialize(codec.parse(source));
    const projection = projectMarkdown(markdown);
    const target = projection.blocks.findIndex(
      block => block.type === 'paragraph' && markdown.slice(block.sourceStart, block.sourceEnd).includes('beta')
    );
    const original = annotation('child', anchorForBlock(projection, target));
    const plan = planNoteMigration({ markdown, annotations: [original] }, codec);
    expect(plan.issues).toEqual([]);
    expect(plan.outcomes[0].placedText).toBe('beta');
  }
);
