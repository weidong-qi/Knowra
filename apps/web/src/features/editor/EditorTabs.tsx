import { MathText } from '../../components/math/MathText';
import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Note } from '@study-accelerator/web-core';
import { IconButton, PressableButton } from '../../components/ui/button';
import { Menu, MenuItem, MenuPopover, MenuSeparator, MenuTrigger } from '../../components/ui/overlay';
import { ChevronDownIcon, CloseIcon, PlusIcon, NoteIcon } from '../../components/icons/knowra';
import { cx } from '../../components/ui/classnames';
import styles from './NoteEditorView.module.css';

export interface EditorTabsProps {
  notes: Note[];
  activeNoteId: string;
  canWrite: boolean;
  onOpenNote(noteId: string): void;
  onCloseNote(noteId: string): void;
  onCloseOtherNotes(noteId: string): void;
  onReorderNotes(sourceNoteId: string, targetNoteId: string): void;
  onCopyTabPath(note: Note): void;
  onCreateNote(): void;
  windowTitlebar?: boolean;
}

export function EditorTabs(props: EditorTabsProps) {
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const pendingClose = useRef<{ id: string; index: number } | null>(null);
  useLayoutEffect(() => {
    const pending = pendingClose.current;
    if (pending && !props.notes.some(note => note.id === pending.id)) {
      const tabs = tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      const next = tabs?.[Math.min(pending.index, (tabs?.length ?? 1) - 1)];
      (next ?? tabsRef.current?.querySelector<HTMLButtonElement>('[aria-label="新建笔记"]'))?.focus({ preventScroll: true });
      pendingClose.current = null;
    }
  }, [props.notes]);
  // 标签页放不下时才提供“全部标签页”入口，避免顶栏常驻一个用途不明的“更多”图标。
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () => setOverflowing(scroller.scrollWidth > scroller.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [props.notes]);
  useLayoutEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [props.activeNoteId]);

  function closeNote(noteId: string) {
    pendingClose.current = { id: noteId, index: props.notes.findIndex(note => note.id === noteId) };
    props.onCloseNote(noteId);
  }


  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Delete' && (event.target as HTMLElement).getAttribute('role') === 'tab') {
      const noteId = (event.target as HTMLElement).dataset.noteId;
      if (noteId) { event.preventDefault(); closeNote(noteId); }
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    if (tabs.length === 0) return;
    const current = Math.max(0, tabs.indexOf(document.activeElement as HTMLButtonElement));
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  }

  function handleDrop(event: DragEvent, targetNoteId: string) {
    event.preventDefault();
    const sourceNoteId = draggedNoteId || event.dataTransfer.getData('text/x-note-id');
    setDraggedNoteId(null);
    if (sourceNoteId) props.onReorderNotes(sourceNoteId, targetNoteId);
  }

  return (
    <div ref={tabsRef} className={cx(styles.tabs, props.windowTitlebar ? styles.windowTabs : undefined)} role="tablist" aria-label="打开的笔记" onKeyDown={handleKeyDown}>
      <div ref={scrollerRef} className={styles.tabScroller}>
        {props.notes.map((note, index) => {
          const selected = note.id === props.activeNoteId;
          return (
            <div
              key={note.id}
              className={styles.tabItem}
              data-selected={selected || undefined}
              draggable
              onDragStart={(event) => {
                setDraggedNoteId(note.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/x-note-id', note.id);
              }}
              onDragEnd={() => setDraggedNoteId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, note.id)}
            >
              <TabContextMenu note={note} noteIndex={index} {...props} onCloseNote={closeNote}>
                <PressableButton
                  type="button"
                  role="tab"
                  data-note-id={note.id}
                  aria-selected={selected}
                  aria-label={note.title || '无标题笔记'}
                  tabIndex={selected || (!props.activeNoteId && index === 0) ? 0 : -1}
                  className={styles.tab}
                  title={`${String(index + 1).padStart(2, '0')} · ${note.title || '无标题笔记'}`}
                  onPress={() => props.onOpenNote(note.id)}
                >
                  <span className={styles.tabNumber}><NoteIcon size={14} /></span>
                  <span className={styles.tabLabel}>{note.title ? <MathText text={note.title} inlineOnly /> : '无标题笔记'}</span>
                </PressableButton>
              </TabContextMenu>
              <PressableButton type="button" className={styles.tabClose} aria-label={`关闭${note.title || '无标题笔记'}`} onPress={() => closeNote(note.id)}>
                <CloseIcon size={12} />
              </PressableButton>
            </div>
          );
        })}
      </div>
      {overflowing ? <MenuTrigger>
        <IconButton
          className={styles.tabAction}
          aria-label="查看全部标签页"
          title="查看全部标签页"
        >
          <ChevronDownIcon size={16} />
        </IconButton>
        <MenuPopover placement="bottom end">
          <Menu ariaLabel="全部标签页">
            {props.notes.map((note, index) => (
              <MenuItem key={note.id} id={note.id} onAction={() => props.onOpenNote(note.id)}>
                {String(index + 1).padStart(2, '0')} · {note.title || '无标题笔记'}
              </MenuItem>
            ))}
          </Menu>
        </MenuPopover>
      </MenuTrigger> : null}
      <IconButton
        className={styles.tabAction}
        aria-label="新建笔记"
        title={props.canWrite ? '新建笔记' : '后端离线时无法新建'}
        disabled={!props.canWrite}
        onPress={props.onCreateNote}
      >
        <PlusIcon size={18} />
      </IconButton>
    </div>
  );
}

function TabContextMenu({ note, noteIndex, notes, children, onCloseNote, onCloseOtherNotes, onCopyTabPath, onReorderNotes }: EditorTabsProps & {
  note: Note;
  noteIndex: number;
  children: ReactNode;
}) {
  return (
    <MenuTrigger trigger="contextMenu">
      {children}
      <MenuPopover>
        <Menu ariaLabel={`${note.title || '无标题笔记'}标签操作`}>
          <MenuItem id="copy-path" onAction={() => onCopyTabPath(note)}>复制笔记路径</MenuItem>
          <MenuSeparator />
          <MenuItem id="move-left" isDisabled={noteIndex === 0} onAction={() => onReorderNotes(note.id, notes[noteIndex - 1]?.id ?? note.id)}>向左移动标签</MenuItem>
          <MenuItem id="move-right" isDisabled={noteIndex === notes.length - 1} onAction={() => onReorderNotes(note.id, notes[noteIndex + 1]?.id ?? note.id)}>向右移动标签</MenuItem>
          <MenuSeparator />
          <MenuItem id="close" onAction={() => onCloseNote(note.id)}>关闭标签页</MenuItem>
          <MenuItem id="close-others" isDisabled={notes.length < 2} onAction={() => onCloseOtherNotes(note.id)}>关闭其他标签页</MenuItem>
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
}
