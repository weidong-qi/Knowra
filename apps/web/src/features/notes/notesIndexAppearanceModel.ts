import { useSyncExternalStore } from 'react';

export interface NotesIndexAppearance {
  mode: 'light' | 'dark';
  theme: 'orange';
  shape: 'pill';
  overlayMaterial: 'glass' | 'acrylic';
  dialogStyle: DialogStyle;
  inspectorStyle: InspectorStyle;
  stageStyle: StageStyle;
  accentColor: AccentColor;
  topbarColorLight: string | null;
  topbarColorDark: string | null;
  railColorLight: string | null;
  railColorDark: string | null;
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

/** 对话框面板外观：浮起卡片、内嵌托盘。 */
export const DIALOG_STYLES = ['float', 'tray'] as const;
export type DialogStyle = (typeof DIALOG_STYLES)[number];

/** 文档检查器外壳形态：浮岛卡片、贴边分栏。 */
export const INSPECTOR_STYLES = ['float', 'docked'] as const;
export type InspectorStyle = (typeof INSPECTOR_STYLES)[number];

/** 中间功能页面质感：纸面柔影（#fbfcfd/#18191d + 四层投影）、经典平面（#fefefe/#1a1c20 + 短描边投影）。 */
export const STAGE_STYLES = ['soft', 'flat'] as const;
export type StageStyle = (typeof STAGE_STYLES)[number];

export const NOTES_INDEX_APPEARANCE_KEY = 'knowra:notes-index-appearance:v1';
const LEGACY_SHELL_V2_KEY = 'knowra:notes-index-appearance:shell-v2';
export const DEFAULT_NOTES_INDEX_APPEARANCE: Readonly<NotesIndexAppearance> = {
  mode: 'light',
  theme: 'orange',
  shape: 'pill',
  overlayMaterial: 'glass',
  dialogStyle: 'float',
  inspectorStyle: 'float',
  stageStyle: 'soft',
  accentColor: 'ink',
  topbarColorLight: null,
  topbarColorDark: null,
  railColorLight: null,
  railColorDark: null,
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
    dialogStyle: DIALOG_STYLES.includes(candidate.dialogStyle as DialogStyle)
      ? (candidate.dialogStyle as DialogStyle)
      : 'float',
    inspectorStyle: INSPECTOR_STYLES.includes(candidate.inspectorStyle as InspectorStyle)
      ? (candidate.inspectorStyle as InspectorStyle)
      : 'float',
    stageStyle: STAGE_STYLES.includes(candidate.stageStyle as StageStyle)
      ? (candidate.stageStyle as StageStyle)
      : 'soft',
    accentColor: ACCENT_COLORS.includes(candidate.accentColor as AccentColor)
      ? (candidate.accentColor as AccentColor)
      : 'ink',
    topbarColorLight: parseColor(candidate.topbarColorLight),
    topbarColorDark: parseColor(candidate.topbarColorDark),
    railColorLight: parseColor(candidate.railColorLight),
    railColorDark: parseColor(candidate.railColorDark),
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
    const parsed = parseNotesIndexAppearance(JSON.parse(localStorage.getItem(NOTES_INDEX_APPEARANCE_KEY) ?? 'null'));
    if (localStorage.getItem(LEGACY_SHELL_V2_KEY) !== null) {
      // 撤销临时分层外壳升级留下的本地开关缓存，恢复默认贴边分栏。
      const reverted: NotesIndexAppearance = {
        ...parsed,
        sidebarCard: false,
        sidebarRounded: false,
        sidebarBorder: false
      };
      try {
        localStorage.setItem(NOTES_INDEX_APPEARANCE_KEY, JSON.stringify(reverted));
        localStorage.removeItem(LEGACY_SHELL_V2_KEY);
      } catch {
        // 无存储权限时仅在当前会话生效。
      }
      return reverted;
    }
    return parsed;
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
