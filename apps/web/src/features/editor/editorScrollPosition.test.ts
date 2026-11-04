import { describe, expect, it } from 'vitest';
import {
  captureEditorScrollPosition,
  getEditorScrollTop,
  readEditorScrollPositions,
  writeEditorScrollPositions
} from './editorScrollPosition';

describe('editorScrollPosition', () => {
  it('captures positive offsets and treats returning to the top as clearing the saved position', () => {
    const positions = {};
    captureEditorScrollPosition(positions, 'note-a', 420);
    expect(getEditorScrollTop(positions, 'note-a')).toBe(420);
    captureEditorScrollPosition(positions, 'note-a', 0);
    expect(getEditorScrollTop(positions, 'note-a')).toBe(0);
  });

  it('reads only valid positive offsets and persists with the shared V3-compatible shape', () => {
    const values = new Map<string, string>([
      ['scroll', JSON.stringify({ valid: 120, zero: 0, text: '90', infinite: null })]
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); }
    };
    expect(readEditorScrollPositions(storage, 'scroll')).toEqual({ valid: 120 });
    expect(writeEditorScrollPositions({ valid: 240 }, storage, 'scroll')).toBe(true);
    expect(values.get('scroll')).toBe('{"valid":240}');
  });

  it('recovers safely from unavailable or malformed storage', () => {
    const storage = {
      getItem: () => '{invalid',
      setItem: () => { throw new Error('quota'); },
      removeItem: () => undefined
    };
    expect(readEditorScrollPositions(storage)).toEqual({});
    expect(writeEditorScrollPositions({ note: 12 }, storage)).toBe(false);
  });
});
