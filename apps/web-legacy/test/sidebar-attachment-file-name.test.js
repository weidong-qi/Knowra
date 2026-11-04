import assert from 'node:assert/strict';
import {
  buildAttachmentFileName,
  splitAttachmentFileName
} from '../lib/sidebar/attachment-file-name.js';

assert.deepEqual(splitAttachmentFileName('diagram.png'), {
  stem: 'diagram',
  extension: '.png'
});

assert.deepEqual(splitAttachmentFileName('clipboard-image'), {
  stem: 'clipboard-image',
  extension: '.png'
});

assert.equal(
  buildAttachmentFileName({ draft: 'renamed-diagram', extension: '.png' }),
  'renamed-diagram.png'
);

assert.equal(
  buildAttachmentFileName({ draft: 'renamed-diagram.png', extension: '.png' }),
  'renamed-diagram.png'
);

console.log('ok - attachment file name helpers preserve extension policy');
