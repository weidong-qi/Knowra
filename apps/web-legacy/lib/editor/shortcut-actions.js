export const EDITOR_SHORTCUT_LABELS = {
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  'select-all': 'Ctrl+A',
  bold: 'Ctrl+B',
  code: 'Ctrl+E',
  paragraph: 'Ctrl+0',
  'heading-1': 'Ctrl+1',
  'heading-2': 'Ctrl+2',
  'heading-3': 'Ctrl+3',
  'heading-4': 'Ctrl+4',
  ordered: 'Ctrl+Shift+{',
  bullet: 'Ctrl+Shift+}',
  'task-list': 'Ctrl+Shift+X',
  highlight: 'Ctrl+Shift+H',
  indent: 'Tab',
  outdent: 'Shift+Tab'
};

export function getEditorShortcutLabel(action) {
  return EDITOR_SHORTCUT_LABELS[action] ?? '';
}

export function resolveEditorShortcutAction({
  key = '',
  code = '',
  ctrlKey = false,
  metaKey = false,
  shiftKey = false,
  altKey = false,
  isComposing = false,
  keyCode = 0
} = {}) {
  if (isComposing || keyCode === 229) {
    return null;
  }

  const normalizedKey = String(key).toLowerCase();
  const normalizedCode = String(code);
  const hasModifier = ctrlKey || metaKey;

  if (normalizedKey === 'tab') {
    return shiftKey ? 'outdent' : 'indent';
  }

  if (!hasModifier || altKey) {
    return null;
  }

  if (!shiftKey) {
    switch (normalizedKey) {
      case 'b':
        return 'bold';
      case 'e':
        return 'code';
      case '0':
        return 'paragraph';
      case '1':
        return 'heading-1';
      case '2':
        return 'heading-2';
      case '3':
        return 'heading-3';
      case '4':
        return 'heading-4';
      default:
        return null;
    }
  }

  switch (normalizedKey) {
    case '{':
      return 'ordered';
    case '}':
      return 'bullet';
    case 'x':
      return 'task-list';
    case 'h':
      return 'highlight';
    default:
      break;
  }

  switch (normalizedCode) {
    case 'BracketLeft':
      return 'ordered';
    case 'BracketRight':
      return 'bullet';
    case 'KeyX':
      return 'task-list';
    case 'KeyH':
      return 'highlight';
    default:
      return null;
  }
}
