import { useSyncExternalStore } from 'react';

export interface NotesIndexAppearance {
  mode: 'light' | 'dark';
  theme: 'orange';
  shape: 'pill';
  overlayMaterial: 'glass' | 'acrylic';
  buttonStyle: ButtonStyle;
  defaultButtonStyle: DefaultButtonStyle;
  dialogStyle: DialogStyle;
}

/** 主按钮（Button primary）外观：纸感、白玻璃。 */
export const BUTTON_STYLES = ['paper', 'frost'] as const;
export type ButtonStyle = typeof BUTTON_STYLES[number];

/** 默认按钮（Button default）外观：无边软影、乳白玻璃。 */
export const DEFAULT_BUTTON_STYLES = ['soft', 'glass'] as const;
export type DefaultButtonStyle = typeof DEFAULT_BUTTON_STYLES[number];

/** 对话框面板外观：浮起卡片、内嵌托盘。 */
export const DIALOG_STYLES = ['float', 'tray'] as const;
export type DialogStyle = typeof DIALOG_STYLES[number];

export const NOTES_INDEX_APPEARANCE_KEY = 'knowra:notes-index-appearance:v1';
export const DEFAULT_NOTES_INDEX_APPEARANCE: Readonly<NotesIndexAppearance> = {
  mode: 'light', theme: 'orange', shape: 'pill', overlayMaterial: 'glass', buttonStyle: 'paper', defaultButtonStyle: 'soft', dialogStyle: 'float'
};
const listeners = new Set<() => void>();
let snapshot = readAppearance();
let hasUnsavedChanges = false;

export function parseNotesIndexAppearance(value: unknown): NotesIndexAppearance {
  const candidate = value && typeof value === 'object' ? value as Partial<NotesIndexAppearance> : {};
  return {
    mode: candidate.mode === 'dark' ? 'dark' : 'light',
    // 保留旧外观存储格式及明暗偏好；pill 仅作为兼容值，实际形状由组件用途决定。
    theme: 'orange',
    shape: 'pill',
    overlayMaterial: candidate.overlayMaterial === 'acrylic' ? 'acrylic' : 'glass',
    buttonStyle: BUTTON_STYLES.includes(candidate.buttonStyle as ButtonStyle) ? candidate.buttonStyle as ButtonStyle : 'paper',
    defaultButtonStyle: DEFAULT_BUTTON_STYLES.includes(candidate.defaultButtonStyle as DefaultButtonStyle) ? candidate.defaultButtonStyle as DefaultButtonStyle : 'soft',
    dialogStyle: DIALOG_STYLES.includes(candidate.dialogStyle as DialogStyle) ? candidate.dialogStyle as DialogStyle : 'float'
  };
}

function readAppearance(): NotesIndexAppearance {
  try {
    return parseNotesIndexAppearance(JSON.parse(localStorage.getItem(NOTES_INDEX_APPEARANCE_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_NOTES_INDEX_APPEARANCE };
  }
}

function publish(next: NotesIndexAppearance) {
  if (Object.keys(next).every(key => next[key as keyof NotesIndexAppearance] === snapshot[key as keyof NotesIndexAppearance])) return;
  snapshot = next;
  listeners.forEach(listener => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key === NOTES_INDEX_APPEARANCE_KEY || event.key === null) {
    hasUnsavedChanges = false;
    publish(readAppearance());
  }
}

function subscribe(listener: () => void) {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
    if (!hasUnsavedChanges) publish(readAppearance());
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

export function setNotesIndexAppearance(patch: Partial<NotesIndexAppearance>) {
  const next = parseNotesIndexAppearance({ ...snapshot, ...patch });
  try {
    localStorage.setItem(NOTES_INDEX_APPEARANCE_KEY, JSON.stringify(next));
    hasUnsavedChanges = false;
  } catch {
    hasUnsavedChanges = true; // 无存储权限时保留本次会话的外观，包括组件重新挂载。
  }
  publish(next);
}

export function useNotesIndexAppearance() {
  return useSyncExternalStore(subscribe, () => snapshot, () => DEFAULT_NOTES_INDEX_APPEARANCE);
}
