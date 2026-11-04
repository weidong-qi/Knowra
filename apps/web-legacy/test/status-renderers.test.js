import assert from 'node:assert/strict';
import {
  getStatusDocumentStats,
  renderStatusFeature,
  renderStatusGlobal,
  renderStatusIndicators,
  renderStatusMeta
} from '../lib/status/renderers.js';

const indicators = renderStatusIndicators({
  statusMessage: 'Saved <ok>',
  saveState: 'saved'
});
assert.match(indicators, /data-save-now/);
assert.match(indicators, /已自动保存/);
assert.match(indicators, /Saved &lt;ok&gt;/);
assert.doesNotMatch(indicators, /当前资料|笔记 \d|目录 \d/);

const pendingIndicators = renderStatusIndicators({
  statusMessage: '等待自动保存',
  saveState: 'pending'
});
assert.match(pendingIndicators, /data-state="pending"/);
assert.match(pendingIndicators, /等待保存/);
assert.match(pendingIndicators, /点击手动保存/);

const failedIndicators = renderStatusIndicators({
  statusMessage: '保存失败，请重试',
  saveState: 'error'
});
assert.match(failedIndicators, /data-state="error"/);
assert.match(failedIndicators, /保存失败/);
assert.match(failedIndicators, /保存失败，请重试/);

const indexFeature = renderStatusFeature({
  statusMessage: '后端资料已同步',
  saveState: 'saved',
  showEditorControls: false
});
assert.match(indexFeature, /data-status-feature-message/);
assert.match(indexFeature, /后端资料已同步/);
assert.doesNotMatch(indexFeature, /data-save-now|data-status-action/);

const homeFeature = renderStatusFeature({
  statusMessage: '主页概览',
  homeSummary: { recentCount: 4 },
  showEditorControls: false
});
assert.match(homeFeature, /data-status-home="context"/);
assert.match(homeFeature, /工作台/);
assert.match(homeFeature, /最近编辑 <strong>4<\/strong>/);

const editorFeature = renderStatusFeature({
  statusMessage: '已自动保存',
  saveState: 'saved',
  markdown: '# 标题',
  view: { mode: 'edit', showSourceEditor: false, showRightSidebar: true },
  showEditorControls: true
});
assert.match(editorFeature, /data-save-now/);
assert.match(editorFeature, /data-status-feature-controls/);
assert.match(editorFeature, /data-status-action="toggle-focus"/);

const globalStatus = renderStatusGlobal({ dataMode: 'api' });
assert.match(globalStatus, /data-status-global="encoding"[^>]*>UTF-8/);
assert.match(globalStatus, /data-status-global="connection"[^>]*>云端已连接/);

const meta = renderStatusMeta({
  dataMode: 'api',
  markdown: '# 标题\n正文 [链接](https://example.com)',
  view: { mode: 'focus', showSourceEditor: true, showRightSidebar: false }
});
assert.match(meta, /字数 4/);
assert.match(meta, /行数 2/);
assert.doesNotMatch(meta, /大纲/);
assert.match(meta, /链接 1/);
assert.match(meta, /data-status-action="toggle-source-editor" data-active="true"/);
assert.match(meta, /data-status-action="toggle-source-editor"[^>]*aria-pressed="true"/);
assert.match(meta, /data-status-action="toggle-right-sidebar" data-active="false"/);
assert.match(meta, /data-status-action="toggle-right-sidebar"[^>]*aria-pressed="false"/);
assert.match(meta, /data-status-action="toggle-focus"[\s\S]*data-active="true"[\s\S]*退出专注模式/);
assert.match(meta, /data-status-action="toggle-focus"[\s\S]*aria-pressed="true"/);
assert.match(meta, /云端已连接/);

assert.match(
  renderStatusMeta({
    dataMode: 'api'
  }),
  /云端已连接/
);

assert.match(
  renderStatusMeta({
    dataMode: 'local',
    currentSpaceId: 'ignored'
  }),
  /本地演示/
);

assert.match(
  renderStatusMeta({
    dataMode: 'cache'
  }),
  /只读缓存/
);

assert.deepEqual(getStatusDocumentStats('# A\n正文\n[[内部]]'), {
  characters: 9,
  lines: 3,
  links: 1
});

console.log('ok - status renderers escape and label workspace state');
