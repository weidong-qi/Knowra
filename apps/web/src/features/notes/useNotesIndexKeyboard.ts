import { useEffect, useRef, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { itemKey, type IndexItem } from './notesIndexPresentation';

interface KeyboardOptions {
  contentRef: RefObject<HTMLDivElement | null>;
  peekKey: string | null; peekOpen: boolean;
  setPeekOpen(value: boolean): void; setPeekKey(value: string): void;
  allItems: IndexItem[]; canWrite: boolean; isRecycleView: boolean;
  selectedNoteIds: Set<string>;
  toggleNoteSelection(id: string, selected: boolean): void;
  selectFolder(id: string): void; openNote(id: string): void;
}

/** 索引主条目的快捷键；菜单、复选框和回收站操作保留各自的键盘行为。 */
export function useNotesIndexKeyboard({ contentRef, peekKey, peekOpen, setPeekOpen, setPeekKey,
  allItems, canWrite, isRecycleView, selectedNoteIds, toggleNoteSelection, selectFolder, openNote }: KeyboardOptions) {
  // 焦点不在列表条目上时（刚进入页面、点了空白处），J/K 先把焦点送进列表：已预览的条目优先，否则第一项。
  const peekKeyRef = useRef(peekKey);
  peekKeyRef.current = peekKey;
  useEffect(() => {
    const enterList = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || (key !== 'j' && key !== 'k')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"], [data-entry-item]')) return;
      if (target !== document.body && !target.closest('[aria-label="笔记索引"]')) return;
      const entries = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('[data-entry-item]') ?? []);
      const entry = entries.find(value => value.dataset.entryKey === peekKeyRef.current) ?? entries[0];
      const button = entry?.querySelector<HTMLElement>('[data-index-primary]:not([disabled])');
      if (!button) return;
      event.preventDefault(); button.focus();
    };
    window.addEventListener('keydown', enterList);
    return () => window.removeEventListener('keydown', enterList);
  }, []);
  /** 列表快捷键：J/K 移动、X 选择、Space 预览；Enter 沿用按钮自身的“打开”。 */
  function handleEntryKeys(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const target = event.target as Element;
    if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]')) return;
    const entry = target.closest<HTMLElement>('[data-entry-item]');
    if (!entry || !target.closest('[data-index-primary]')) return;
    const key = event.key.toLowerCase();
    if (key === 'j' || key === 'k') {
      const entries = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-entry-item]'));
      const next = entries[entries.indexOf(entry) + (key === 'j' ? 1 : -1)];
      event.preventDefault();
      next?.querySelector<HTMLElement>('[data-index-primary]:not([disabled])')?.focus();
      return;
    }
    const item = allItems.find(value => itemKey(value) === entry.dataset.entryKey);
    if (event.key === 'Enter' && peekOpen && item && target === entry.querySelector('[data-index-primary]')) {
      // 预览栏开着时点击只切换预览；Enter 始终是“打开”。
      event.preventDefault(); event.stopPropagation();
      if (item.kind === 'folder') selectFolder(item.folder.id); else openNote(item.note.id);
      return;
    }
    if (key === 'x') {
      event.preventDefault();
      if (item?.kind === 'note' && canWrite && !isRecycleView) toggleNoteSelection(item.note.id, !selectedNoteIds.has(item.note.id));
    } else if (event.key === ' ') {
      // 阻止按钮把空格当作“按下”，改为预览。
      event.preventDefault(); event.stopPropagation();
      if (!item) return;
      const itemId = itemKey(item);
      if (peekOpen && peekKey === itemId) setPeekOpen(false);
      else { setPeekOpen(true); setPeekKey(itemId); }
    }
  }
  function swallowEntrySpace(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const target = event.target as Element;
    if (target.closest('input, textarea, select, [role="menu"], [role="dialog"]') || !target.closest('[data-index-primary]')) return;
    event.preventDefault(); event.stopPropagation();
  }
  return { handleEntryKeys, swallowEntrySpace };
}
