import { escapeHtml } from '../../src/app/formatting.js';
import { getNoteStats } from '../sidebar/stats.js';

export function renderStatusIndicators({
  statusMessage,
  saveState = 'idle'
}) {
  return `
      ${renderStatusSave({ saveState })}
      ${renderStatusMessage(statusMessage)}
    `;
}

export function renderStatusFeature({
  statusMessage,
  saveState = 'idle',
  markdown = '',
  view = {},
  showEditorControls = false,
  homeSummary = null
}) {
  if (!showEditorControls) {
    return homeSummary ? renderHomeStatus(homeSummary) : renderStatusMessage(statusMessage);
  }

  return `
    ${renderStatusIndicators({ statusMessage, saveState })}
    ${renderStatusFeatureControls({ markdown, view })}
  `;
}

function renderHomeStatus(summary) {
  return `
    <span class="status-inline status-home-context" data-status-home="context">${renderStatusHomeIcon()}<strong>工作台</strong></span>
    <span class="status-inline status-home-separator" aria-hidden="true">·</span>
    <span class="status-inline">今日工作面</span>
    <span class="status-home-stats">
      <span class="status-inline">模块 <strong>3</strong></span>
      <span class="status-inline">最近编辑 <strong>${summary.recentCount}</strong></span>
    </span>
  `;
}

function renderStatusHomeIcon() {
  return '<span class="status-home-icon" aria-hidden="true">⌂</span>';
}

export function renderStatusGlobal({ dataMode }) {
  const modeLabel = getDataModeLabel(dataMode);

  return `
    <span class="status-inline status-global-encoding" data-status-global="encoding">UTF-8</span>
    <span class="status-inline status-global-connection" data-status-global="connection" data-state="${escapeHtml(dataMode ?? 'local')}">${escapeHtml(modeLabel)}</span>
  `;
}

export function renderStatusMeta({ dataMode, markdown = '', view = {} }) {
  return `
      ${renderStatusFeatureControls({ markdown, view })}
      ${renderStatusGlobal({ dataMode })}
    `;
}

export function renderStatusFeatureControls({ markdown = '', view = {} }) {
  const stats = getStatusDocumentStats(markdown);

  return `
    <span class="status-feature-controls" data-status-feature-controls>
      <span class="status-inline">字数 ${stats.characters}</span>
      <span class="status-inline">行数 ${stats.lines}</span>
      <span class="status-inline">链接 ${stats.links}</span>
      <button type="button" class="status-action" data-status-action="toggle-source-editor" data-active="${String(Boolean(view.showSourceEditor))}" aria-pressed="${String(Boolean(view.showSourceEditor))}" aria-label="${view.showSourceEditor ? '关闭源码分栏' : '打开源码分栏'}">源码</button>
      <button type="button" class="status-action" data-status-action="toggle-right-sidebar" data-active="${String(Boolean(view.showRightSidebar))}" aria-pressed="${String(Boolean(view.showRightSidebar))}" aria-label="${view.showRightSidebar ? '收起边注面板' : '展开边注面板'}">边注</button>
      <button
        type="button"
        class="status-action"
        data-status-action="toggle-focus"
        data-active="${String(view.mode === 'focus')}"
        aria-pressed="${String(view.mode === 'focus')}"
        aria-label="${view.mode === 'focus' ? '退出专注模式' : '进入专注模式'}"
      >专注</button>
    </span>
  `;
}

function renderStatusSave({ saveState }) {
  const saveLabel = {
    pending: '等待保存',
    dirty: '等待保存',
    saving: '正在保存',
    saved: '已自动保存',
    error: '保存失败'
  }[saveState] ?? '保存当前资料';

  return `
      <button type="button" class="status-action status-save" data-save-now data-state="${saveState}" aria-label="${saveLabel}，点击手动保存" title="点击手动保存">
        <i aria-hidden="true"></i>${saveLabel}
      </button>
  `;
}

function renderStatusMessage(statusMessage) {
  return `<span class="status-inline status-message" data-status-feature-message aria-live="polite">${escapeHtml(statusMessage ?? '')}</span>`;
}

function getDataModeLabel(dataMode) {
  return {
    api: '云端已连接',
    cache: '只读缓存',
    loading: '正在连接',
    local: '本地演示'
  }[dataMode] ?? '本地演示';
}

export function getStatusDocumentStats(markdown = '') {
  const value = String(markdown);
  return {
    characters: getNoteStats(value).characterCount,
    lines: value ? value.split(/\r?\n/).length : 0,
    links: (value.match(/\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\]/g) ?? []).length
  };
}
