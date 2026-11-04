import { escapeHtml, escapeAttribute } from '../../src/app/formatting.js';

export function normalizeTableDialogValue(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(20, Math.max(1, parsed));
}

export function renderTableInsertDialogMarkup({ rows = '4', cols = '3' } = {}) {
  return `
    <div class="editor-table-dialog-backdrop" data-editor-table-dialog-action="cancel"></div>
    <div class="editor-table-dialog-card" role="dialog" aria-modal="true" aria-labelledby="editor-table-dialog-title">
      <div class="editor-table-dialog-title" id="editor-table-dialog-title">插入表格</div>
      <div class="editor-table-dialog-grid">
        <label class="editor-table-dialog-field">
          <span>行</span>
          <input
            type="number"
            min="1"
            max="20"
            step="1"
            inputmode="numeric"
            class="editor-table-dialog-input"
            data-table-dialog-field="rows"
            value="${escapeAttribute(rows)}"
          />
        </label>
        <label class="editor-table-dialog-field">
          <span>列</span>
          <input
            type="number"
            min="1"
            max="20"
            step="1"
            inputmode="numeric"
            class="editor-table-dialog-input"
            data-table-dialog-field="cols"
            value="${escapeAttribute(cols)}"
          />
        </label>
      </div>
      <div class="editor-table-dialog-actions">
        <button type="button" class="ghost-button" data-editor-table-dialog-action="cancel">取消</button>
        <button type="button" class="subtle-button" data-editor-table-dialog-action="confirm">确定</button>
      </div>
    </div>
  `;
}
