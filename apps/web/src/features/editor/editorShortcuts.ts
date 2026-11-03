import type { EditorCommand } from './editorCommands';

export interface EditorShortcutInput {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

const shortcutLabels: Partial<Record<EditorCommand, string>> = {
  paragraph: 'Mod+0',
  'heading-1': 'Mod+1',
  'heading-2': 'Mod+2',
  'heading-3': 'Mod+3',
  'heading-4': 'Mod+4',
  'bullet-list': 'Mod+Alt+U',
  'ordered-list': 'Mod+Alt+O',
  'task-list': 'Mod+Shift+X',
  blockquote: 'Mod+Alt+Q',
  'code-block': 'Mod+Alt+C',
  'math-block': 'Mod+Shift+M',
  'horizontal-rule': 'Mod+Alt+R',
  table: 'Mod+Alt+T',
  bold: 'Mod+B',
  italic: 'Mod+I',
  strikethrough: 'Ctrl+Shift+`',
  'inline-code': 'Mod+E',
  highlight: 'Mod+Shift+H',
  'internal-link': 'Mod+Alt+K',
  'paragraph-above': 'Mod+Alt+↑',
  'paragraph-below': 'Mod+Alt+↓'
};

export function getEditorShortcutLabel(command: EditorCommand, isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)): string | undefined {
  if (command === 'inline-code' && isMac) return '⌘+Shift+`';
  return shortcutLabels[command]?.replaceAll('Mod', isMac ? '⌘' : 'Ctrl').replaceAll('Alt', isMac ? '⌥' : 'Alt');
}

export function getEditorPageShortcutLabel(keys: string, isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)): string {
  return keys.replace('Mod+Ctrl+', isMac ? '⌘+Ctrl+' : 'Ctrl+Alt+').replaceAll('Mod', isMac ? '⌘' : 'Ctrl');
}

export function resolveEditorShortcutCommand(input: EditorShortcutInput): EditorCommand | null {
  if (input.isComposing || input.keyCode === 229) {
    return null;
  }

  if (input.key === 'Tab' && !input.ctrlKey && !input.metaKey && !input.altKey) {
    return input.shiftKey ? 'outdent' : 'indent';
  }

  const mod = input.ctrlKey || input.metaKey;
  const physicalKey = input.code?.startsWith('Key') ? input.code.slice(3).toLowerCase() : input.key.toLowerCase();
  if (input.ctrlKey && !input.metaKey && !input.altKey && input.shiftKey && input.code === 'Backquote') {
    return 'strikethrough';
  }
  if (!mod) return null;

  if (input.altKey && !input.shiftKey) {
    const optionCommands: Record<string, EditorCommand> = {
      c: 'code-block',
      k: 'internal-link',
      o: 'ordered-list',
      q: 'blockquote',
      r: 'horizontal-rule',
      t: 'table',
      u: 'bullet-list',
      arrowup: 'paragraph-above',
      arrowdown: 'paragraph-below'
    };
    return optionCommands[physicalKey] ?? null;
  }
  if (input.altKey) return null;

  if (!input.shiftKey) {
    const headingCommands: Record<string, EditorCommand> = {
      '0': 'paragraph',
      '1': 'heading-1',
      '2': 'heading-2',
      '3': 'heading-3',
      '4': 'heading-4'
    };
    const formattingCommands: Record<string, EditorCommand> = {
      b: 'bold',
      e: 'inline-code',
      i: 'italic'
    };
    return headingCommands[input.key] ?? formattingCommands[input.key.toLowerCase()] ?? null;
  }

  if (input.key.toLowerCase() === 'x') return 'task-list';
  if (input.key.toLowerCase() === 'm' || input.code === 'KeyM') return 'math-block';
  if (input.key.toLowerCase() === 'h' || input.code === 'KeyH') return 'highlight';
  if (input.code === 'Backquote') return 'inline-code';
  if (input.code === 'BracketLeft' || input.key === '{') return 'ordered-list';
  if (input.code === 'BracketRight' || input.key === '}') return 'bullet-list';
  return null;
}
