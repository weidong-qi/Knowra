import assert from 'node:assert/strict';
import {
  buildAttachmentContentUrl,
  buildAttachmentReferenceUrl,
  collectReferencedAttachmentIds,
  extractAttachmentIdFromUrl,
  decorateAttachmentsForDisplay,
  isAttachmentReferencedInMarkdown,
  removeAttachmentReferencesFromMarkdown
} from '../lib/sidebar/attachments.js';

const markdown = [
  '![diagram](/api/storage/attachments/attachment-1/content)',
  '',
  '[spec](/api/storage/attachments/attachment-2/content)',
  '',
  '![encoded](/api/storage/attachments/attachment%203/content)'
].join('\n');

const referencedIds = collectReferencedAttachmentIds(markdown);
assert.deepEqual(
  Array.from(referencedIds).sort(),
  ['attachment 3', 'attachment-1', 'attachment-2']
);

assert.equal(
  buildAttachmentContentUrl('attachment 3'),
  '/api/storage/attachments/attachment%203/content'
);
assert.equal(
  buildAttachmentReferenceUrl('attachment 3'),
  '/api/storage/attachments/attachment%203/content#attachment=attachment%203'
);
assert.equal(
  extractAttachmentIdFromUrl('/api/storage/attachments/attachment%203/content#attachment=attachment%203'),
  'attachment 3'
);
assert.equal(
  extractAttachmentIdFromUrl('http://localhost:3000/api/storage/attachments/attachment-2/content'),
  'attachment-2'
);

assert.equal(
  isAttachmentReferencedInMarkdown({ id: 'attachment-1' }, markdown),
  true
);
assert.equal(
  isAttachmentReferencedInMarkdown({ id: 'attachment-missing' }, markdown),
  false
);

assert.deepEqual(
  decorateAttachmentsForDisplay([
    { id: 'attachment-1', fileName: 'diagram.png' },
    { id: 'attachment-missing', fileName: 'draft.md' }
  ], markdown).map((attachment) => ({
    id: attachment.id,
    contentUrl: attachment.contentUrl,
    referenceUrl: attachment.referenceUrl,
    isReferenced: attachment.isReferenced
  })),
  [
    {
      id: 'attachment-1',
      contentUrl: '/api/storage/attachments/attachment-1/content',
      referenceUrl: '/api/storage/attachments/attachment-1/content#attachment=attachment-1',
      isReferenced: true
    },
    {
      id: 'attachment-missing',
      contentUrl: '/api/storage/attachments/attachment-missing/content',
      referenceUrl: '/api/storage/attachments/attachment-missing/content#attachment=attachment-missing',
      isReferenced: false
    }
  ]
);

assert.equal(
  removeAttachmentReferencesFromMarkdown([
    '![diagram](/api/storage/attachments/attachment-1/content#attachment=attachment-1)',
    '',
    '[spec](/api/storage/attachments/attachment-2/content)',
    '',
    '尾部正文'
  ].join('\n'), 'attachment-1'),
  '[spec](/api/storage/attachments/attachment-2/content)\n\n尾部正文'
);

console.log('ok - sidebar attachment helpers derive reference state from markdown');
