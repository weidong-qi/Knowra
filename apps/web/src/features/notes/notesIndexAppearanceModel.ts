import { useSyncExternalStore } from 'react';

export interface NotesIndexAppearance {
  mode: 'light' | 'dark';
  theme: 'orange';
  shape: 'pill';
  overlayMaterial: 'glass' | 'acrylic';
  buttonStyle: ButtonStyle;
  dialogStyle: DialogStyle;
  accentColor: AccentColor;
  documentIconStyle: DocumentIconStyle;
  shellColorLight: string | null;
  shellColorDark: string | null;
  sidebarColorLight: string | null;
  sidebarColorDark: string | null;
  sidebarCard: boolean;
  sidebarRounded: boolean;
  sidebarBorder: boolean;
}

export const ACCENT_COLORS = ['ink', 'orange'] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

export const DOCUMENT_ICON_STYLES = ['capsule', 'layout'] as const;
export type DocumentIconStyle = (typeof DOCUMENT_ICON_STYLES)[number];

/** 主按钮（Button primary）外观：纸感、白玻璃。 */
export const BUTTON_STYLES = ['paper', 'frost'] as const;
export type ButtonStyle = (typeof BUTTON_STYLES)[number];

/** 对话框面板外观：浮起卡片、内嵌托盘。 */
export const DIALOG_STYLES = ['float', 'tray'] as const;
export type DialogStyle = (typeof DIALOG_STYLES)[number];

export const NOTES_INDEX_APPEARANCE_KEY = 'knowra:notes-index-appearance:v1';
export const DEFAULT_NOTES_INDEX_APPEARANCE: Readonly<NotesIndexAppearance> = {
  mode: 'light',
  theme: 'orange',
  shape: 'pill',
  overlayMaterial: 'glass',
  buttonStyle: 'paper',
  dialogStyle: 'float',
  accentColor: 'ink',
  documentIconStyle: 'capsule',
  shellColorLight: null,
  shellColorDark: null,
  sidebarColorLight: null,
  sidebarColorDark: null,
  sidebarCard: false,
  sidebarRounded: false,
  sidebarBorder: false
};
const listeners = new Set<() => void>();
let snapshot = readAppearance();
let hasUnsavedChanges = false;

function parseColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

export function parseNotesIndexAppearance(value: unknown): NotesIndexAppearance {
  const candidate = value && typeof value === 'object' ? (value as Partial<NotesIndexAppearance>) : {};
  return {
    mode: candidate.mode === 'dark' ? 'dark' : 'light',
    // 保留旧外观存储格式及明暗偏好；pill 仅作为兼容值，实际形状由组件用途决定。
    theme: 'orange',
    shape: 'pill',
    overlayMaterial: candidate.overlayMaterial === 'acrylic' ? 'acrylic' : 'glass',
    buttonStyle: BUTTON_STYLES.includes(candidate.buttonStyle as ButtonStyle)
      ? (candidate.buttonStyle as ButtonStyle)
      : 'paper',
    dialogStyle: DIALOG_STYLES.includes(candidate.dialogStyle as DialogStyle)
      ? (candidate.dialogStyle as DialogStyle)
      : 'float',
    accentColor: ACCENT_COLORS.includes(candidate.accentColor as AccentColor)
      ? (candidate.accentColor as AccentColor)
      : 'ink',
    documentIconStyle: DOCUMENT_ICON_STYLES.includes(candidate.documentIconStyle as DocumentIconStyle)
      ? (candidate.documentIconStyle as DocumentIconStyle)
      : 'capsule',
    shellColorLight: parseColor(candidate.shellColorLight),
    shellColorDark: parseColor(candidate.shellColorDark),
    sidebarColorLight: parseColor(candidate.sidebarColorLight),
    sidebarColorDark: parseColor(candidate.sidebarColorDark),
    sidebarCard: candidate.sidebarCard === true,
    sidebarRounded: candidate.sidebarRounded === true,
    sidebarBorder: candidate.sidebarBorder === true
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
  if (
    Object.keys(next).every(
      key => next[key as keyof NotesIndexAppearance] === snapshot[key as keyof NotesIndexAppearance]
    )
  )
    return;
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
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => DEFAULT_NOTES_INDEX_APPEARANCE
  );
}
