import { escapeHtml } from '../../src/app/formatting.js';
import { renderIcon } from '../icons/icon-map.js';

export function getEditorPanelStatusText({ query, matchCount } = {}) {
  if (!query) {
    return '输入内容后开始查找';
  }

  return matchCount > 0 ? `已找到 ${matchCount} 处` : '未找到匹配项';
}

export function renderEditorPanelMarkup(panel = {}) {
  const isReplace = panel.mode === 'replace';
  const queryValue = escapeHtml(panel.query ?? '');
  const replacementValue = escapeHtml(panel.replacement ?? '');
  const statusText = getEditorPanelStatusText(panel);

  return `
    <div class="editor-utility-panel-head">
      <div class="editor-utility-panel-title">${isReplace ? '替换' : '查找'}</div>
      <button type="button" class="editor-utility-close" data-editor-panel-action="close" aria-label="关闭查找面板">${renderIcon('cancel', { className: 'editor-utility-close-icon' })}</button>
    </div>
    <div class="editor-utility-panel-body">
      <label class="editor-utility-field">
        <span>查找内容</span>
        <input
          type="text"
          class="editor-utility-input"
          data-panel-field="query"
          value="${queryValue}"
          placeholder="输入要查找的文字"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      ${isReplace ? `
        <label class="editor-utility-field">
          <span>替换为</span>
          <input
            type="text"
            class="editor-utility-input"
            data-panel-field="replacement"
            value="${replacementValue}"
            placeholder="输入替换后的文字"
            autocomplete="off"
            spellcheck="false"
          />
        </label>
      ` : ''}
      <div class="editor-utility-panel-status">${escapeHtml(statusText)}</div>
      ${!isReplace ? '<div class="editor-utility-panel-hint">F3 下一个，Shift+F3 上一个</div>' : ''}
    </div>
    <div class="editor-utility-panel-actions">
      ${!isReplace ? '<button type="button" class="ghost-button" data-editor-panel-action="submit-previous">查找上一个</button>' : ''}
      <button type="button" class="subtle-button" data-editor-panel-action="submit">${isReplace ? '替换一次' : '查找下一个'}</button>
      ${isReplace ? '<button type="button" class="subtle-button" data-editor-panel-action="replace-all">全部替换</button>' : ''}
      <button type="button" class="ghost-button" data-editor-panel-action="close">关闭</button>
    </div>
  `;
}
