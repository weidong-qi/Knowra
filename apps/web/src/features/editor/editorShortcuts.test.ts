import { describe, expect, it } from 'vitest';
import { getEditorShortcutLabel, resolveEditorShortcutCommand } from './editorShortcuts';

const baseShortcut = {
  key: '',
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false
};

describe('editorShortcuts', () => {
  it.each([
    ['0', 'paragraph'],
    ['1', 'heading-1'],
    ['2', 'heading-2'],
    ['3', 'heading-3'],
    ['4', 'heading-4']
  ] as const)('maps Ctrl+%s to %s', (key, command) => {
    expect(resolveEditorShortcutCommand({ ...baseShortcut, key })).toBe(command);
  });

  it('supports cross-platform list shortcuts', () => {
    expect(resolveEditorShortcutCommand({
      ...baseShortcut, key: '{', code: 'BracketLeft', shiftKey: true
    })).toBe('ordered-list');
    expect(resolveEditorShortcutCommand({
      ...baseShortcut, key: '}', code: 'BracketRight', ctrlKey: false, metaKey: true, shiftKey: true
    })).toBe('bullet-list');
    expect(resolveEditorShortcutCommand({
      ...baseShortcut, key: 'X', shiftKey: true
    })).toBe('task-list');
  });

  it('reuses the V3 formatting shortcuts on Ctrl and Meta', () => {
    expect(resolveEditorShortcutCommand({ ...baseShortcut, key: 'b' })).toBe('bold');
    expect(resolveEditorShortcutCommand({ ...baseShortcut, key: 'e', ctrlKey: false, metaKey: true })).toBe('inline-code');
    expect(resolveEditorShortcutCommand({ ...baseShortcut, key: 'H', code: 'KeyH', shiftKey: true })).toBe('highlight');
  });

  it('routes the native Milkdown code-block shortcut through Typora semantics', () => {
    expect(resolveEditorShortcutCommand({
      ...baseShortcut, key: 'c', altKey: true
    })).toBe('code-block');
    expect(resolveEditorShortcutCommand({
      ...baseShortcut, key: 'C', ctrlKey: false, metaKey: true, altKey: true
    })).toBe('code-block');
  });

  it('routes Mod+Shift+M to the math block like Typora', () => {
    expect(resolveEditorShortcutCommand({ ...baseShortcut, key: 'M', code: 'KeyM', shiftKey: true })).toBe('math-block');
  });

  it('uses the physical C key when macOS Option changes the typed character', () => {
    expect(resolveEditorShortcutCommand({ ...baseShortcut, key: 'ç', code: 'KeyC', ctrlKey: false, metaKey: true, altKey: true })).toBe('code-block');
  });

  it('maps Typora style Mac combinations and preserves the existing list aliases', () => {
    const mac = { ...baseShortcut, ctrlKey: false, metaKey: true };
    expect(resolveEditorShortcutCommand({ ...mac, key: 'i', code: 'KeyI' })).toBe('italic');
    expect(resolveEditorShortcutCommand({ ...mac, key: 'œ', code: 'KeyQ', altKey: true })).toBe('blockquote');
    expect(resolveEditorShortcutCommand({ ...mac, key: 'ø', code: 'KeyO', altKey: true })).toBe('ordered-list');
    expect(resolveEditorShortcutCommand({ ...mac, key: '¨', code: 'KeyU', altKey: true })).toBe('bullet-list');
    expect(resolveEditorShortcutCommand({ ...mac, key: '†', code: 'KeyT', altKey: true })).toBe('table');
    expect(resolveEditorShortcutCommand({ ...mac, key: '~', code: 'Backquote', shiftKey: true })).toBe('inline-code');
    expect(resolveEditorShortcutCommand({ ...baseShortcut, key: '~', code: 'Backquote', shiftKey: true })).toBe('strikethrough');
  });

  it('prioritizes indentation while focus is inside the editor', () => {
    expect(resolveEditorShortcutCommand({
      ...baseShortcut, key: 'Tab', ctrlKey: false
    })).toBe('indent');
    expect(resolveEditorShortcutCommand({
      ...baseShortcut, key: 'Tab', ctrlKey: false, shiftKey: true
    })).toBe('outdent');
    expect(resolveEditorShortcutCommand({
      ...baseShortcut, key: 'Tab', metaKey: true
    })).toBeNull();
  });

  it('does not intercept composition or unrelated modifier combinations', () => {
    expect(resolveEditorShortcutCommand({ ...baseShortcut, key: '1', isComposing: true })).toBeNull();
    expect(resolveEditorShortcutCommand({ ...baseShortcut, key: 'Tab', ctrlKey: false, isComposing: true })).toBeNull();
    expect(resolveEditorShortcutCommand({ ...baseShortcut, key: '1', altKey: true })).toBeNull();
    expect(resolveEditorShortcutCommand({ ...baseShortcut, key: '8' })).toBeNull();
  });

  it('exposes the reference shortcut labels used by the menu', () => {
    expect(getEditorShortcutLabel('paragraph')).toBe('Ctrl+0');
    expect(getEditorShortcutLabel('task-list')).toBe('Ctrl+Shift+X');
    expect(getEditorShortcutLabel('bold')).toBe('Ctrl+B');
    expect(getEditorShortcutLabel('inline-code')).toBe('Ctrl+E');
    expect(getEditorShortcutLabel('highlight')).toBe('Ctrl+Shift+H');
    expect(getEditorShortcutLabel('blockquote', true)).toBe('⌘+⌥+Q');
    expect(getEditorShortcutLabel('italic', true)).toBe('⌘+I');
    expect(getEditorShortcutLabel('inline-code', true)).toBe('⌘+Shift+`');
    expect(getEditorShortcutLabel('table', true)).toBe('⌘+⌥+T');
  });
});
