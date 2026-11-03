import { escapeHtml, escapeAttribute } from '../../src/app/formatting.js';

export function renderPreviewPane({ headings = [], previewHtml = '' } = {}) {
  return `
    <section class="preview-pane preview-frame">
      <div class="pane-body">
        ${headings.length ? `
          <div class="toc-list" data-preview-toc>
            ${headings.map((heading) => `<a class="toc-item" data-level="${heading.level}" href="#${escapeAttribute(heading.id)}">${escapeHtml(heading.title)}</a>`).join('')}
          </div>
        ` : ''}
        <article class="preview-rendered" data-preview-content>${previewHtml}</article>
      </div>
    </section>
  `;
}

export function renderSourceEditorPane({ markdown = '' } = {}) {
  return renderSourceEditorShell({
    markdown,
    ariaLabel: 'Markdown 源码编辑器'
  });
}

export function renderSourceEditorView({ markdown = '' } = {}) {
  return renderSourceEditorShell({
    markdown,
    ariaLabel: 'Markdown source editor'
  });
}

function renderSourceEditorShell({ markdown, ariaLabel }) {
  return `
    <section class="editor-pane">
      <div class="pane-body pane-body-editor">
        <div class="source-toolbar">
          <span class="editor-save-indicator" id="editor-save-indicator"></span>
          <button type="button" class="subtle-button editor-save-button" data-source-save>保存源码</button>
        </div>
        <textarea class="markdown-input" data-source-editor-input spellcheck="false" aria-label="${escapeAttribute(ariaLabel)}">${escapeHtml(markdown)}</textarea>
      </div>
    </section>
  `;
}
