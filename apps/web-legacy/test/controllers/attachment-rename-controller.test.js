import assert from 'node:assert/strict';
import { createAttachmentRenameController } from '../../src/controllers/sidebar/attachment-rename-controller.js';

const state = {
  dataMode: 'api',
  attachments: [{
    id: 'attachment-1',
    fileName: 'diagram.png',
    mimeType: 'image/png'
  }],
  attachmentRenaming: null
};
const renderCalls = [];
const flashes = [];
const note = { id: 'note-1' };
const controller = createAttachmentRenameController({
  state,
  knowledgeApi: {
    renameAttachment: async (attachmentId, input) => ({
      id: attachmentId,
      fileName: input.fileName
    })
  },
  getCurrentNote: () => note,
  renderSidebar: (...args) => renderCalls.push(args),
  flashStatus: (message) => flashes.push(message)
});

assert.equal(controller.startAttachmentRename('attachment-1'), true);
assert.deepEqual(renderCalls.at(-1), [
  note,
  {
    selector: '[data-attachment-rename-input="attachment-1"]',
    select: true
  }
]);

assert.equal(controller.cancelAttachmentRename(), true);
assert.deepEqual(renderCalls.at(-1), [
  note,
  { selector: '[data-attachment-open="attachment-1"]' }
]);

controller.startAttachmentRename('attachment-1');
assert.equal(await controller.submitAttachmentRename('attachment-1', 'renamed'), true);
assert.equal(state.attachments[0].fileName, 'renamed.png');
assert.deepEqual(renderCalls.at(-1), [
  note,
  { selector: '[data-attachment-open="attachment-1"]' }
]);
assert.equal(flashes.at(-1), '附件名已更新');

console.log('attachment rename restores focus after start, cancel and submit');
