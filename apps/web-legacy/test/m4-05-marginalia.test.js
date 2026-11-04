import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderAsideTabs, renderAttachments } from '../lib/sidebar/renderers.js';

const tabs = renderAsideTabs({
  tabs: [
    { key: 'info', label: '信息' },
    { key: 'outline', label: '大纲' },
    { key: 'concepts', label: '重点' },
    { key: 'ai', label: 'AI' }
  ],
  activeKey: 'outline'
});

assert.match(tabs, /id="aside-tab-outline"/);
assert.match(tabs, /data-aside-tab="outline"[\s\S]*role="tab"[\s\S]*aria-selected="true"[\s\S]*tabindex="0"/);
assert.match(tabs, /data-aside-tab="info"[\s\S]*aria-selected="false"[\s\S]*tabindex="-1"/);

const attachment = renderAttachments(
  [{ id: 'attachment-1', fileName: 'draft.md', mimeType: 'text/markdown' }],
  { id: 'attachment-1', draft: 'draft', extension: '.md' }
);
assert.match(attachment, /data-attachment-rename-form="attachment-1"/);
assert.match(attachment, /data-attachment-rename-input="attachment-1"/);
assert.match(attachment, /data-attachment-rename-cancel/);

const longAttachmentName = '2026年度多模态Transformer模型架构研究资料与实验结果汇总最终审阅版本附件截图.png';
const longAttachment = renderAttachments([
  { id: 'attachment-long', fileName: longAttachmentName, mimeType: 'image/png', isReferenced: true }
]);
assert.match(longAttachment, new RegExp(`aria-label="附件：${longAttachmentName}；image/png；已引用"`));
assert.match(longAttachment, new RegExp(`<strong title="${longAttachmentName}">${longAttachmentName}</strong>`));

const aggregateCss = readFileSync(new URL('../styles/components/knowra-inkgrid.css', import.meta.url), 'utf8');
const editorCss = readFileSync(new URL('../styles/components/knowra-inkgrid-editor.css', import.meta.url), 'utf8');
const marginaliaCss = readFileSync(new URL('../styles/components/knowra-inkgrid-editor-marginalia.css', import.meta.url), 'utf8');
assert.match(aggregateCss, /@import '.\/knowra-inkgrid-editor-marginalia\.css';/);
assert.match(marginaliaCss, /\.editor-inspector/);
assert.match(marginaliaCss, /\.aside-tab:focus-visible/);
assert.match(marginaliaCss, /\.resource-rename-form/);
assert.match(
  editorCss,
  /\.editor-inspector \.resource-entry\s*\{[^}]*justify-items:\s*stretch;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;/,
  'attachment entries should constrain long file names to the inspector column'
);
assert.match(
  editorCss,
  /\.editor-inspector \.resource-meta\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;/,
  'attachment metadata should provide a real ellipsis containing block'
);

console.log('ok - M4-05 marginalia exposes accessible tabs and attachment actions');
