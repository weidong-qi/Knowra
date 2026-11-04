import { renderIcon } from '../icons/icon-map.js';

const CONTEXT_ICON_NAMES = Object.freeze({
  cut: 'editorCut',
  copy: 'editorCopy',
  paste: 'editorPaste',
  delete: 'editorDelete',
  bold: 'editorBold',
  italic: 'editorItalic',
  highlight: 'editorHighlight',
  code: 'editorCode',
  codeblock: 'editorCodeblock',
  quote: 'editorQuote',
  ordered: 'editorOrdered',
  bullet: 'editorBullet',
  'task-list': 'editorTaskList',
  outdent: 'editorOutdent',
  indent: 'editorIndent',
  table: 'editorTable',
  important: 'editorImportant'
});

/**
 * Kept as a compatibility export for the existing editor renderers. The
 * formal implementation is a local Remix asset reference, not page-local SVG
 * path markup.
 */
export function renderEditorContextIconSvg(icon) {
  return renderIcon(CONTEXT_ICON_NAMES[icon] ?? 'editorQuestion', {
    className: 'editor-context-glyph'
  });
}
