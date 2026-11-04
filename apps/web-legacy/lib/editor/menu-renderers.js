import { escapeHtml } from '../../src/app/formatting.js';
import { renderEditorContextIconSvg } from './context-menu-icons.js';

export const EDIT_MENU_ITEMS = [
  { key: 'undo', label: '撤销' },
  { key: 'redo', label: '重做' },
  { key: 'separator' },
  { key: 'cut', label: '剪切' },
  { key: 'copy', label: '复制' },
  { key: 'paste', label: '粘贴' },
  { key: 'separator' },
  { key: 'find', label: '查找' },
  { key: 'replace', label: '替换' },
  { key: 'select-all', label: '全选' }
];


export const PARAGRAPH_MENU_ITEMS = [
  { key: 'paragraph', label: '正文' },
  { key: 'heading-1', label: 'H1' },
  { key: 'heading-2', label: 'H2' },
  { key: 'heading-3', label: 'H3' },
  { key: 'heading-4', label: 'H4' },
  { key: 'separator' },
  { key: 'bullet', label: '无序列表' },
  { key: 'ordered', label: '有序列表' },
  { key: 'task-list', label: '任务列表' },
  { key: 'separator' },
  { key: 'quote', label: '引用块' },
  { key: 'codeblock', label: '代码块' },
  { key: 'hr', label: '分割线' },
  { key: 'table', label: '表格' }
];

export const FORMAT_MENU_ITEMS = [
  { key: 'image', label: '图片' },
  { key: 'internal-link', label: '内部链接' },
  { key: 'separator' },
  { key: 'bold', label: '加粗' },
  { key: 'italic', label: '斜体' },
  { key: 'strikethrough', label: '删除线' },
  { key: 'code', label: '行内代码' },
  { key: 'highlight', label: '高亮' }
];

export function renderEditorMenuBarMarkup({
  note,
  effectiveView,
  openMenu,
  getShortcutLabel = () => ''
}) {
  const fileMenuOpen = openMenu === 'file';
  const paragraphMenuOpen = openMenu === 'paragraph';
  const editMenuOpen = openMenu === 'edit';
  const formatMenuOpen = openMenu === 'format';
  const viewMenuOpen = openMenu === 'view';
  const moreMenuOpen = openMenu === 'more';

  return `
    <div class="editor-menu-shell">
      <div class="editor-menu-groups">
      <div class="editor-menu-group" data-editor-menu-group="file">
        <button
          type="button"
          class="editor-menu-text"
          data-editor-menu-toggle="file"
          data-open="${fileMenuOpen}"
          aria-haspopup="menu"
          aria-expanded="${fileMenuOpen}"
          ${fileMenuOpen ? 'aria-controls="editor-menu-file"' : ''}
        >
          文件
        </button>
        ${fileMenuOpen ? renderFileMenu({ note, getShortcutLabel }) : ''}
      </div>
      <div class="editor-menu-group" data-editor-menu-group="paragraph">
        <button
          type="button"
          class="editor-menu-text"
          data-editor-menu-toggle="paragraph"
          data-open="${paragraphMenuOpen}"
          aria-haspopup="menu"
          aria-expanded="${paragraphMenuOpen}"
          ${paragraphMenuOpen ? 'aria-controls="editor-menu-paragraph"' : ''}
        >
          段落
        </button>
        ${paragraphMenuOpen ? renderParagraphMenu({ note, getShortcutLabel }) : ''}
      </div>
      <div class="editor-menu-group" data-editor-menu-group="edit">
        <button
          type="button"
          class="editor-menu-text"
          data-editor-menu-toggle="edit"
          data-open="${editMenuOpen}"
          aria-haspopup="menu"
          aria-expanded="${editMenuOpen}"
          ${editMenuOpen ? 'aria-controls="editor-menu-edit"' : ''}
        >
          编辑
        </button>
        ${editMenuOpen ? renderEditMenu({ note, getShortcutLabel }) : ''}
      </div>
      <div class="editor-menu-group" data-editor-menu-group="format">
        <button
          type="button"
          class="editor-menu-text"
          data-editor-menu-toggle="format"
          data-open="${formatMenuOpen}"
          aria-haspopup="menu"
          aria-expanded="${formatMenuOpen}"
          ${formatMenuOpen ? 'aria-controls="editor-menu-format"' : ''}
        >
          格式
        </button>
        ${formatMenuOpen ? renderFormatMenu({ note, getShortcutLabel }) : ''}
      </div>
      <div class="editor-menu-group" data-editor-menu-group="view">
        <button
          type="button"
          class="editor-menu-text"
          data-editor-menu-toggle="view"
          data-open="${viewMenuOpen}"
          aria-haspopup="menu"
          aria-expanded="${viewMenuOpen}"
          ${viewMenuOpen ? 'aria-controls="editor-menu-view"' : ''}
        >
          视图
        </button>
        ${viewMenuOpen ? renderViewMenu({ note, effectiveView }) : ''}
      </div>
      </div>
      <span class="quick-tools-divider" aria-hidden="true"></span>
      <div class="editor-quick-tools" role="toolbar" aria-label="常用格式工具">
        <button type="button" data-format="heading-1" data-quick-action="heading-1" aria-label="一级标题">H1</button>
        <button type="button" data-format="heading-2" data-quick-action="heading-2" aria-label="二级标题">H2</button>
        <button type="button" data-format="heading-3" data-quick-action="heading-3" aria-label="三级标题">H3</button>
        <span class="editor-quick-divider" aria-hidden="true"></span>
        <button type="button" data-format="bold" data-quick-action="bold" aria-label="加粗">${renderEditorContextIconSvg('bold')}</button>
        <button type="button" data-format="italic" data-quick-action="italic" aria-label="斜体">${renderEditorContextIconSvg('italic')}</button>
        <button type="button" data-format="bullet" data-quick-action="bullet" aria-label="无序列表">${renderEditorContextIconSvg('bullet')}</button>
        <button type="button" data-format="quote" data-quick-action="quote" aria-label="引用">${renderEditorContextIconSvg('quote')}</button>
        <button type="button" data-format="code" data-quick-action="code" aria-label="行内代码">${renderEditorContextIconSvg('code')}</button>
      </div>
      <div class="editor-menu-group editor-menu-more-group" data-editor-menu-group="more">
        <button
          type="button"
          class="editor-menu-text editor-menu-more-toggle"
          data-editor-menu-toggle="more"
          data-open="${moreMenuOpen}"
          aria-haspopup="menu"
          aria-expanded="${moreMenuOpen}"
          ${moreMenuOpen ? 'aria-controls="editor-menu-more"' : ''}
        >
          更多
        </button>
        ${moreMenuOpen ? renderMoreMenu({ note, effectiveView, getShortcutLabel }) : ''}
      </div>
    </div>
  `;
}

export function renderMoreMenu({ note, effectiveView, getShortcutLabel = () => '' } = {}) {
  return `
    <div class="editor-menu-popover editor-menu-more-popover" data-editor-menu="more" id="editor-menu-more" role="menu">
      ${renderMenuSection({ label: '文件', content: renderFileMenuItems({ note, getShortcutLabel }) })}
      ${renderMenuSection({ label: '编辑', content: renderActionMenuItems({ items: EDIT_MENU_ITEMS, actionAttr: 'data-edit-menu-action', note, getShortcutLabel }) })}
      ${renderMenuSection({ label: '段落', content: renderActionMenuItems({ items: PARAGRAPH_MENU_ITEMS, actionAttr: 'data-paragraph-menu-action', note, getShortcutLabel }) })}
      ${renderMenuSection({ label: '格式', content: renderActionMenuItems({ items: FORMAT_MENU_ITEMS, actionAttr: 'data-format-menu-action', note, getShortcutLabel }) })}
      ${renderMenuSection({ label: '视图', content: renderViewMenuItems({ note, effectiveView }) })}
    </div>
  `;
}

export function renderEditMenu({ note, getShortcutLabel = () => '' } = {}) {
  return renderActionMenu({
    menuKey: 'edit',
    items: EDIT_MENU_ITEMS,
    actionAttr: 'data-edit-menu-action',
    note,
    getShortcutLabel
  });
}

export function renderParagraphMenu({ note, getShortcutLabel = () => '' } = {}) {
  return renderActionMenu({
    menuKey: 'paragraph',
    items: PARAGRAPH_MENU_ITEMS,
    actionAttr: 'data-paragraph-menu-action',
    note,
    getShortcutLabel
  });
}

export function renderFormatMenu({ note, getShortcutLabel = () => '' } = {}) {
  return renderActionMenu({
    menuKey: 'format',
    items: FORMAT_MENU_ITEMS,
    actionAttr: 'data-format-menu-action',
    note,
    getShortcutLabel
  });
}

export function renderViewMenu({ note, effectiveView }) {
  return `
    <div class="editor-menu-popover" data-editor-menu="view" id="editor-menu-view" role="menu">
      ${renderViewMenuItems({ note, effectiveView })}
    </div>
  `;
}

function renderViewMenuItems({ note, effectiveView }) {
  const hasEditableNote = Boolean(note && !note.deleted);

  return `
    <button type="button" class="editor-menu-item" role="menuitem" data-view-menu-action="mode-read" data-active="${effectiveView.mode === 'read'}">阅读模式</button>
    <button type="button" class="editor-menu-item" role="menuitem" data-view-menu-action="mode-edit" data-active="${effectiveView.mode === 'edit'}">编辑模式</button>
    <button type="button" class="editor-menu-item" role="menuitem" data-view-menu-action="mode-focus" data-active="${effectiveView.mode === 'focus'}">专注模式</button>
    <div class="editor-menu-divider" aria-hidden="true"></div>
    <button type="button" class="editor-menu-item" role="menuitem" data-view-menu-action="toggle-left-sidebar" data-active="${effectiveView.showLeftSidebar}">${effectiveView.showLeftSidebar ? '隐藏左侧目录区' : '显示左侧目录区'}</button>
    <button type="button" class="editor-menu-item" role="menuitem" data-view-menu-action="toggle-right-sidebar" data-active="${effectiveView.showRightSidebar}">${effectiveView.showRightSidebar ? '隐藏右侧辅助区' : '显示右侧辅助区'}</button>
    <button type="button" class="editor-menu-item" role="menuitem" data-view-menu-action="toggle-source-editor" data-active="${effectiveView.showSourceEditor}" ${hasEditableNote ? '' : 'disabled'}>${effectiveView.showSourceEditor ? '隐藏源码编辑器' : '显示源码编辑器'}</button>
  `;
}

export function renderFileMenu({ note, getShortcutLabel = () => '' } = {}) {
  return `
    <div class="editor-menu-popover" data-editor-menu="file" id="editor-menu-file" role="menu">
      ${renderFileMenuItems({ note, getShortcutLabel })}
    </div>
  `;
}

function renderFileMenuItems({ note, getShortcutLabel = () => '' } = {}) {
  const hasEditableNote = Boolean(note && !note.deleted);
  const isDeletedNote = Boolean(note?.deleted);

  return `
    <button type="button" class="editor-menu-item" role="menuitem" data-file-menu-action="new-note">新建笔记</button>
    <button type="button" class="editor-menu-item" role="menuitem" data-file-menu-action="new-folder">新建文件夹</button>
    <button type="button" class="editor-menu-item" role="menuitem" data-file-menu-action="import-markdown">导入 Markdown</button>
    <div class="editor-menu-divider" aria-hidden="true"></div>
    ${renderEditorMenuItem({ actionAttr: 'data-file-menu-action', actionKey: 'save', disabled: !hasEditableNote, label: '保存', getShortcutLabel })}
    ${renderEditorMenuItem({ actionAttr: 'data-file-menu-action', actionKey: 'save-as', disabled: !hasEditableNote, label: '另存为', getShortcutLabel })}
    ${renderEditorMenuItem({ actionAttr: 'data-file-menu-action', actionKey: 'rename', disabled: !hasEditableNote, label: '重命名', getShortcutLabel })}
    ${isDeletedNote
      ? '<button type="button" class="editor-menu-item" role="menuitem" data-file-menu-action="restore-note">恢复笔记</button>'
      : hasEditableNote
        ? `
          <button type="button" class="editor-menu-item" role="menuitem" data-file-menu-action="favorite-note">${note.favorite ? '取消收藏' : '收藏笔记'}</button>
          <button type="button" class="editor-menu-item" role="menuitem" data-file-menu-action="delete-note">删除</button>
        `
        : ''}
    <div class="editor-menu-divider" aria-hidden="true"></div>
    ${renderEditorMenuItem({ actionAttr: 'data-file-menu-action', actionKey: 'export-markdown', disabled: !hasEditableNote, label: '导出 Markdown', getShortcutLabel })}
    ${renderEditorMenuItem({ actionAttr: 'data-file-menu-action', actionKey: 'export-pdf', disabled: !hasEditableNote, label: '导出', getShortcutLabel })}
  `;
}

function renderActionMenu({ menuKey, items, actionAttr, note, getShortcutLabel }) {
  return `
    <div class="editor-menu-popover" data-editor-menu="${menuKey}" id="editor-menu-${menuKey}" role="menu">
      ${renderActionMenuItems({ items, actionAttr, note, getShortcutLabel })}
    </div>
  `;
}

function renderActionMenuItems({ items, actionAttr, note, getShortcutLabel }) {
  const hasNote = Boolean(note);

  return items
    .map((item) => {
      if (item.key === 'separator') {
        return '<div class="editor-menu-divider" aria-hidden="true"></div>';
      }

      return renderEditorMenuItem({
        actionAttr,
        actionKey: item.key,
        disabled: !hasNote,
        label: item.label,
        getShortcutLabel
      });
    })
    .join('');
}

function renderMenuSection({ label, content }) {
  const sectionId = `editor-menu-section-${label}`;
  return `
    <section class="editor-menu-section" role="group" aria-labelledby="${sectionId}">
      <h3 class="editor-menu-section-label" id="${sectionId}">${escapeHtml(label)}</h3>
      ${content}
    </section>
  `;
}

function renderEditorMenuItem({
  actionAttr,
  actionKey,
  disabled = false,
  label,
  getShortcutLabel = () => ''
}) {
  const shortcut = getShortcutLabel(actionKey);
  return `
    <button type="button" class="editor-menu-item" role="menuitem" ${actionAttr}="${actionKey}" ${disabled ? 'disabled' : ''}>
      <span class="editor-menu-item-label">${escapeHtml(label)}</span>
      ${shortcut ? `<span class="editor-menu-shortcut">${escapeHtml(shortcut)}</span>` : ''}
    </button>
  `;
}
