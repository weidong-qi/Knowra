import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const source = fs.readFileSync(
  path.resolve(__dirname, '../../src/controllers/editor/host-controller.js'),
  'utf8'
);

assert.match(
  source,
  /async function insertAttachmentAtCursor\(attachment\) \{/,
  'editor host controller should expose an attachment reinsertion command'
);

assert.match(
  source,
  /if \(state\.view\.showSourceEditor\) \{[\s\S]*flashStatus\('请先切回富文本编辑区后再插入附件'\);[\s\S]*return false;/,
  'attachment reinsertion should guard against source-editor mode'
);

assert.match(
  source,
  /const referenceUrl = buildAttachmentReferenceUrl\(attachmentId\);[\s\S]*String\(attachment\?\.mimeType \|\| ''\)\.startsWith\('image\/'\)[\s\S]*`!\[\$\{label\}\]\(\$\{referenceUrl\}\).*`[\s\S]*`\[\$\{label\}\]\(\$\{referenceUrl\}\)`/,
  'attachment reinsertion should emit image markdown for images and link markdown for other attachments'
);

assert.match(
  source,
  /await editorHost\.focus\(\);[\s\S]*const inserted = await editorHost\.pasteMarkdown\(markdown\);/,
  'attachment reinsertion should insert into the current editor selection through pasteMarkdown'
);

assert.match(
  source,
  /flashStatus\('附件已插入到当前光标位置'\);[\s\S]*return true;/,
  'attachment reinsertion should report success after inserting into the editor'
);

assert.match(
  source,
  /async function removeAttachmentFromCurrentNote\(attachment\) \{/,
  'editor host controller should expose a command to remove attachment references from the current note'
);

assert.match(
  source,
  /removeAttachmentReferencesFromMarkdown\(currentMarkdown,\s*attachmentId\)/,
  'attachment removal should rewrite the current note markdown through the shared attachment helper'
);

assert.match(
  source,
  /await editorHost\.setMarkdown\(nextMarkdown\);[\s\S]*state\.draftMarkdown = nextMarkdown;[\s\S]*renderSidebar\(getCurrentNote\(\)\);[\s\S]*getController\(\)\.scheduleAutosave\(\);/,
  'attachment removal should immediately refresh the editor draft and sidebar state before autosave'
);

assert.match(
  source,
  /flashStatus\('已从当前笔记移除该附件引用'\);[\s\S]*return true;/,
  'attachment removal should report success after removing references from the note'
);

console.log('editor-host-controller source tests passed');
