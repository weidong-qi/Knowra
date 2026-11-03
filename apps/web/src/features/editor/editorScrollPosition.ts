import type { KeyValueStorage } from '@study-accelerator/web-core';

export const EDITOR_SCROLL_POSITIONS_KEY = 'study-accelerator.editor-scroll-positions';

export type EditorScrollPositions = Record<string, number>;

export function captureEditorScrollPosition(
  positions: EditorScrollPositions,
  noteId: string | null | undefined,
  scrollTop: number
): void {
  if (!noteId || !Number.isFinite(scrollTop)) return;
  if (scrollTop <= 0) {
    delete positions[noteId];
    return;
  }
  positions[noteId] = scrollTop;
}

export function getEditorScrollTop(
  positions: EditorScrollPositions,
  noteId: string | null | undefined
): number {
  if (!noteId) return 0;
  const saved = positions[noteId];
  return typeof saved === 'number' && Number.isFinite(saved) && saved > 0 ? saved : 0;
}

export function readEditorScrollPositions(
  storage: KeyValueStorage | null = getBrowserStorage(),
  key = EDITOR_SCROLL_POSITIONS_KEY
): EditorScrollPositions {
  try {
    const parsed = JSON.parse(storage?.getItem(key) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => (
      typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0
    )));
  } catch {
    return {};
  }
}

export function writeEditorScrollPositions(
  positions: EditorScrollPositions,
  storage: KeyValueStorage | null = getBrowserStorage(),
  key = EDITOR_SCROLL_POSITIONS_KEY
): boolean {
  try {
    storage?.setItem(key, JSON.stringify(positions));
    return Boolean(storage);
  } catch {
    return false;
  }
}

function getBrowserStorage(): KeyValueStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
