import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NotePrivacyDialog } from '../assistant/NotePrivacyDialog';
import type { Folder, Note } from '@study-accelerator/web-core';
import {
  IconButton,
  Menu,
  MenuItem,
  MenuPopover,
  MenuSeparator,
  MenuTrigger,
  PressableButton
} from '../../components/ui';
import {
  ChevronRightIcon,
  FolderIcon,
  MoreHorizontalIcon,
  NoteIcon,
  PdfFileIcon,
  PlusIcon,
  SidebarClosedFolderIcon,
  SolidExpandedFolderIcon,
  StarIcon
} from '../../components/icons/knowra';
import { useAppStore, useAppStoreApi } from '../../store/AppStoreProvider';
import { countFolderNotes, folderMatchesQuery } from './notesIndexModel';
import { useEntryDragDrop, useEntryDropTarget } from './EntryDragDrop';
import { SidebarEntryHoverCard, type HoverCardItem } from './SidebarEntryHoverCard';
import styles from './NotesContextSidebar.module.css';

type EntryKind = 'folder' | 'note';

interface HoveredEntryKey {
  kind: EntryKind;
  id: string;
}

interface HoverCardState {
  target: HoveredEntryKey;
  open: boolean;
}

interface TreeHoverController {
  activeTarget: HoveredEntryKey | null;
  onRowEnter(kind: EntryKind, id: string, element: HTMLElement): void;
  onRowLeave(kind: EntryKind, id: string): void;
  onMenuOpenChange(menuId: string, open: boolean): void;
  onDismiss(): void;
}

const HOVER_OPEN_DELAY_MS = 320;
const HOVER_SWITCH_DELAY_MS = 80;
const HOVER_CLOSE_DELAY_MS = 180;

function sameEntryKey(left: HoveredEntryKey | null, kind: EntryKind, id: string): boolean {
  return left?.kind === kind && left.id === id;
}

function findFolderInTree(folders: Folder[], folderId: string): Folder | undefined {
  for (const folder of folders) {
    if (folder.id === folderId) return folder;
    const nested = findFolderInTree(folder.children, folderId);
    if (nested) return nested;
  }
  return undefined;
}

export type SidebarTreeAction =
  | { type: 'create-folder'; folder: Folder }
  | { type: 'create-note'; folder: Folder }
  | { type: 'move-folder'; folder: Folder }
  | { type: 'move-note'; note: Note }
  | { type: 'rename-folder'; folder: Folder }
  | { type: 'delete-folder'; folder: Folder }
  | { type: 'toggle-favorite'; note: Note }
  | { type: 'rename-note'; note: Note }
  | { type: 'delete-note'; note: Note };

interface SidebarFolderTreeProps {
  folders: Folder[];
  notes: Note[];
  query: string;
  canWrite: boolean;
  onAction(action: SidebarTreeAction): void;
  onOpenIndex?(): void;
  onOpenNote?(noteId: string): void;
}

export function SidebarFolderTree({
  folders,
  notes,
  query,
  canWrite,
  onAction,
  onOpenIndex,
  onOpenNote
}: SidebarFolderTreeProps) {
  const foldersById = useAppStore(state => state.serverData.foldersById);
  const tags = useAppStore(state => state.serverData.tags);
  const openFolders = useAppStore(state => state.navigation.openFolders);
  const { controller, cardState, triggerRef, cardRef, onCardEnter, onCardLeave } = useSidebarHoverController();

  const hoverItem = useMemo<HoverCardItem | null>(() => {
    if (!cardState) return null;
    if (cardState.target.kind === 'folder') {
      const folder = findFolderInTree(folders, cardState.target.id);
      if (!folder || !folderMatchesQuery(folder, notes, query)) return null;
      const canExpand =
        folder.children.some(child => folderMatchesQuery(child, notes, query)) ||
        notes.some(note => !note.deleted && note.folderId === folder.id);
      const expanded = canExpand && (Boolean(openFolders[folder.id]) || Boolean(query.trim()));
      return { kind: 'folder', folder, expanded };
    }
    const note = notes.find(item => !item.deleted && item.id === cardState.target.id);
    if (!note) return null;
    return { kind: 'note', note };
  }, [cardState, folders, notes, openFolders, query]);

  const visibleFolders = folders.filter(folder => folderMatchesQuery(folder, notes, query));
  if (visibleFolders.length === 0) {
    const isEmptyLibrary = folders.length === 0 && !query.trim();
    return <p className={styles.empty}>{isEmptyLibrary ? '暂无文件夹，可使用右侧按钮创建' : '没有匹配的文件夹'}</p>;
  }
  return (
    <>
      <div className={styles.folderTree} role="tree" aria-label="笔记文件夹">
        {visibleFolders.map(folder => (
          <FolderBranch
            key={folder.id}
            folder={folder}
            notes={notes}
            query={query}
            level={1}
            canWrite={canWrite}
            hover={controller}
            onAction={onAction}
            onOpenIndex={onOpenIndex}
            onOpenNote={onOpenNote}
          />
        ))}
      </div>
      <SidebarEntryHoverCard
        key={cardState ? `${cardState.target.kind}:${cardState.target.id}` : 'none'}
        item={hoverItem}
        isOpen={Boolean(cardState?.open && hoverItem)}
        triggerRef={triggerRef}
        cardRef={cardRef}
        notes={notes}
        foldersById={foldersById}
        tags={tags}
        canWrite={canWrite}
        onAction={onAction}
        onDismiss={controller.onDismiss}
        onPointerEnter={onCardEnter}
        onPointerLeave={onCardLeave}
      />
    </>
  );
}

function useSidebarHoverController() {
  const [cardState, setCardState] = useState<HoverCardState | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const cardStateRef = useRef<HoverCardState | null>(null);
  cardStateRef.current = cardState;

  const openMenusRef = useRef<Set<string>>(new Set());
  const hoveredRowRef = useRef<{ kind: EntryKind; id: string; element: HTMLElement } | null>(null);
  const hoveredCardRef = useRef(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    hoveredCardRef.current = false;
    setCardState(prev => (prev?.open ? { target: prev.target, open: false } : prev));
  }, [clearCloseTimer, clearOpenTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      if (hoveredCardRef.current || hoveredRowRef.current) return;
      setCardState(prev => (prev?.open ? { target: prev.target, open: false } : prev));
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  const onRowEnter = useCallback(
    (kind: EntryKind, id: string, element: HTMLElement) => {
      hoveredRowRef.current = { kind, id, element };
      clearOpenTimer();
      clearCloseTimer();
      if (openMenusRef.current.size > 0) return;

      const current = cardStateRef.current;
      if (current?.open && sameEntryKey(current.target, kind, id)) {
        triggerRef.current = element;
        return;
      }

      const delay = current?.open ? HOVER_SWITCH_DELAY_MS : HOVER_OPEN_DELAY_MS;
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        if (openMenusRef.current.size > 0) return;
        const latestRow = hoveredRowRef.current;
        if (!latestRow || !sameEntryKey(latestRow, kind, id)) return;
        triggerRef.current = latestRow.element;
        setCardState({ target: { kind, id }, open: true });
      }, delay);
    },
    [clearCloseTimer, clearOpenTimer]
  );

  const onRowLeave = useCallback(
    (kind: EntryKind, id: string) => {
      if (hoveredRowRef.current && sameEntryKey(hoveredRowRef.current, kind, id)) {
        hoveredRowRef.current = null;
      }
      clearOpenTimer();
      if (cardStateRef.current?.open && !hoveredCardRef.current) {
        scheduleClose();
      }
    },
    [clearOpenTimer, scheduleClose]
  );

  const onCardEnter = useCallback(() => {
    hoveredCardRef.current = true;
    clearCloseTimer();
  }, [clearCloseTimer]);

  const onCardLeave = useCallback(() => {
    hoveredCardRef.current = false;
    scheduleClose();
  }, [scheduleClose]);

  const onMenuOpenChange = useCallback(
    (menuId: string, open: boolean) => {
      if (open) {
        openMenusRef.current.add(menuId);
        dismiss();
      } else {
        openMenusRef.current.delete(menuId);
      }
    },
    [dismiss]
  );

  useEffect(() => {
    return () => {
      clearOpenTimer();
      clearCloseTimer();
    };
  }, [clearCloseTimer, clearOpenTimer]);

  useEffect(() => {
    if (!cardState?.open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cardRef.current?.contains(target)) return;
      dismiss();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        dismiss();
      }
    }

    function handleScroll(event: Event) {
      const target = event.target;
      if (target instanceof Node && cardRef.current?.contains(target)) return;
      dismiss();
    }

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('blur', dismiss);
    };
  }, [cardState?.open, dismiss]);

  const activeTarget = cardState?.open ? cardState.target : null;
  const controller = useMemo<TreeHoverController>(
    () => ({
      activeTarget,
      onRowEnter,
      onRowLeave,
      onMenuOpenChange,
      onDismiss: dismiss
    }),
    [activeTarget, dismiss, onMenuOpenChange, onRowEnter, onRowLeave]
  );

  return {
    controller,
    cardState,
    triggerRef,
    cardRef,
    onCardEnter,
    onCardLeave
  };
}

function FolderBranch({
  folder,
  notes,
  query,
  level,
  canWrite,
  hover,
  onAction,
  onOpenIndex,
  onOpenNote
}: {
  folder: Folder;
  notes: Note[];
  query: string;
  level: number;
  canWrite: boolean;
  hover: TreeHoverController;
  onAction(action: SidebarTreeAction): void;
  onOpenIndex?(): void;
  onOpenNote?(noteId: string): void;
}) {
  const isOpen = useAppStore(state => Boolean(state.navigation.openFolders[folder.id]));
  const isSelected = useAppStore(state => state.navigation.selectedFolderId === folder.id);
  const selectedNoteId = useAppStore(state => state.navigation.selectedNoteId);
  const toggleFolder = useAppStore(state => state.toggleFolder);
  const storeApi = useAppStoreApi();
  const dragDrop = useEntryDragDrop();
  const selectFolder = useAppStore(state => state.selectNotesFolder);
  const directNotes = notes.filter(note => !note.deleted && note.folderId === folder.id);
  const childFolders = folder.children.filter(child => folderMatchesQuery(child, notes, query));
  const canExpand = childFolders.length > 0 || directNotes.length > 0;
  const forcedOpen = Boolean(query.trim());
  const expanded = canExpand && (isOpen || forcedOpen);
  const isHovered = sameEntryKey(hover.activeTarget, 'folder', folder.id);
  const { onRowLeave } = hover;
  const folderDrop = useEntryDropTarget(folder.id, () => {
    if (canExpand && !storeApi.getState().navigation.openFolders[folder.id]) {
      storeApi.getState().toggleFolder(folder.id);
    }
  });

  useEffect(() => {
    return () => onRowLeave('folder', folder.id);
  }, [folder.id, onRowLeave]);

  return (
    <div role="treeitem" aria-level={level} aria-expanded={canExpand ? expanded : undefined}>
      <div className={styles.folderLine}>
        <PressableButton
          type="button"
          className={styles.folderToggle}
          aria-label={`${expanded ? '收起' : '展开'}${folder.name}`}
          isDisabled={!canExpand}
          data-folder-toggle={folder.id}
          onPress={() => toggleFolder(folder.id)}
        >
          <ChevronRightIcon size={15} data-open={expanded || undefined} />
        </PressableButton>
        <div
          className={styles.entryDragArea}
          data-hover-active={isHovered || undefined}
          draggable={canWrite}
          onPointerEnter={event => {
            if (event.pointerType === 'touch') return;
            hover.onRowEnter('folder', folder.id, event.currentTarget);
          }}
          onPointerLeave={event => {
            if (event.pointerType === 'touch') return;
            hover.onRowLeave('folder', folder.id);
          }}
          onDragStart={event => {
            hover.onDismiss();
            dragDrop?.start(event, { kind: 'folder', id: folder.id });
          }}
          onDragEnd={() => dragDrop?.end()}
          onDragOver={folderDrop.onDragOver}
          onDragLeave={folderDrop.onDragLeave}
          onDrop={folderDrop.onDrop}
        >
          <FolderContextMenu
            folder={folder}
            canWrite={canWrite}
            onAction={onAction}
            onOpenChange={open => hover.onMenuOpenChange(`folder-ctx:${folder.id}`, open)}
          >
            <PressableButton
              type="button"
              className={styles.folderRow}
              data-folder-id={folder.id}
              data-drop-active={folderDrop.isOver || undefined}
              data-dragging={(dragDrop?.dragging?.kind === 'folder' && dragDrop.dragging.id === folder.id) || undefined}
              aria-current={isSelected ? 'page' : undefined}
              onClick={() => {
                hover.onDismiss();
                selectFolder(folder.id);
                onOpenIndex?.();
              }}
            >
              {expanded ? <SolidExpandedFolderIcon size={16} /> : <SidebarClosedFolderIcon size={16} />}
              <span>{folder.name}</span>
              <small>{countFolderNotes(folder, notes)}</small>
            </PressableButton>
          </FolderContextMenu>
          {canWrite ? (
            <span className={styles.rowActions}>
              <IconButton
                size={24}
                aria-label={`在${folder.name}中新建笔记`}
                title="新建笔记"
                onPress={() => {
                  hover.onDismiss();
                  onAction({ type: 'create-note', folder });
                }}
              >
                <PlusIcon size={14} />
              </IconButton>
              <FolderContextMenu
                folder={folder}
                canWrite={canWrite}
                onAction={onAction}
                contextMenu={false}
                onOpenChange={open => hover.onMenuOpenChange(`folder-more:${folder.id}`, open)}
              >
                <IconButton size={24} aria-label={`${folder.name}更多操作`} title="更多操作">
                  <MoreHorizontalIcon size={14} />
                </IconButton>
              </FolderContextMenu>
            </span>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div role="group" className={styles.folderChildren}>
          {childFolders.map(child => (
            <FolderBranch
              key={child.id}
              folder={child}
              notes={notes}
              query={query}
              level={level + 1}
              canWrite={canWrite}
              hover={hover}
              onAction={onAction}
              onOpenIndex={onOpenIndex}
              onOpenNote={onOpenNote}
            />
          ))}
          {directNotes
            .filter(note => note.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
            .map(note => (
              <SidebarNoteRow
                key={note.id}
                note={note}
                selected={selectedNoteId === note.id}
                canWrite={canWrite}
                hover={hover}
                onAction={onAction}
                onOpenNote={onOpenNote}
              />
            ))}
        </div>
      ) : null}
    </div>
  );
}

function SidebarNoteRow({
  note,
  selected,
  canWrite,
  hover,
  onAction,
  onOpenNote
}: {
  note: Note;
  selected: boolean;
  canWrite: boolean;
  hover: TreeHoverController;
  onAction(action: SidebarTreeAction): void;
  onOpenNote?(noteId: string): void;
}) {
  const dragDrop = useEntryDragDrop();
  const selectNote = useAppStore(state => state.selectNote);
  const isHovered = sameEntryKey(hover.activeTarget, 'note', note.id);
  const { onRowLeave } = hover;

  useEffect(() => {
    return () => onRowLeave('note', note.id);
  }, [note.id, onRowLeave]);

  return (
    <div
      className={styles.entryDragArea}
      data-hover-active={isHovered || undefined}
      draggable={canWrite}
      onPointerEnter={event => {
        if (event.pointerType === 'touch') return;
        hover.onRowEnter('note', note.id, event.currentTarget);
      }}
      onPointerLeave={event => {
        if (event.pointerType === 'touch') return;
        hover.onRowLeave('note', note.id);
      }}
      onDragStart={event => {
        hover.onDismiss();
        dragDrop?.start(event, { kind: 'note', id: note.id });
      }}
      onDragEnd={() => dragDrop?.end()}
    >
      <NoteContextMenu
        note={note}
        canWrite={canWrite}
        onAction={onAction}
        onOpenChange={open => hover.onMenuOpenChange(`note-ctx:${note.id}`, open)}
      >
        <PressableButton
          type="button"
          className={styles.documentRow}
          data-note-id={note.id}
          data-dragging={(dragDrop?.dragging?.kind === 'note' && dragDrop.dragging.id === note.id) || undefined}
          aria-current={selected ? 'page' : undefined}
          onClick={() => {
            hover.onDismiss();
            selectNote(note.id);
            onOpenNote?.(note.id);
          }}
        >
          {note.contentKind === 'pdf' ? <PdfFileIcon size={18} /> : <NoteIcon size={18} />}
          <span>{note.title || '未命名笔记'}</span>
        </PressableButton>
      </NoteContextMenu>
      {canWrite ? (
        <span className={styles.rowActions}>
          <IconButton
            size={24}
            aria-label={note.favorite ? `取消收藏${note.title || '未命名笔记'}` : `收藏${note.title || '未命名笔记'}`}
            title={note.favorite ? '取消收藏' : '收藏笔记'}
            aria-pressed={Boolean(note.favorite)}
            data-favorite={note.favorite || undefined}
            onPress={() => {
              hover.onDismiss();
              onAction({ type: 'toggle-favorite', note });
            }}
          >
            <StarIcon size={14} />
          </IconButton>
          <NoteContextMenu
            note={note}
            canWrite={canWrite}
            onAction={onAction}
            contextMenu={false}
            onOpenChange={open => hover.onMenuOpenChange(`note-more:${note.id}`, open)}
          >
            <IconButton size={24} aria-label={`${note.title || '未命名笔记'}更多操作`} title="更多操作">
              <MoreHorizontalIcon size={14} />
            </IconButton>
          </NoteContextMenu>
        </span>
      ) : null}
    </div>
  );
}

export function FolderContextMenu({
  folder,
  canWrite,
  onAction,
  children,
  contextMenu = true,
  onOpenChange
}: {
  folder: Folder;
  canWrite: boolean;
  onAction(action: SidebarTreeAction): void;
  children: ReactNode;
  contextMenu?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  return (
    <MenuTrigger {...(contextMenu ? { trigger: 'contextMenu' as const } : {})} onOpenChange={onOpenChange}>
      {children}
      <MenuPopover placement="right top">
        <Menu
          ariaLabel={`${folder.name}文件夹操作`}
          onAction={key => {
            if (key === 'create-folder') onAction({ type: 'create-folder', folder });
            if (key === 'create-note') onAction({ type: 'create-note', folder });
            if (key === 'move') onAction({ type: 'move-folder', folder });
            if (key === 'rename') onAction({ type: 'rename-folder', folder });
            if (key === 'delete') onAction({ type: 'delete-folder', folder });
          }}
        >
          <MenuItem id="create-folder" icon={<FolderIcon size={14} />} isDisabled={!canWrite}>
            新建子文件夹
          </MenuItem>
          <MenuItem id="create-note" icon={<NoteIcon size={14} />} isDisabled={!canWrite}>
            新建笔记
          </MenuItem>
          <MenuSeparator />
          <MenuItem id="move" isDisabled={!canWrite}>
            移动到…
          </MenuItem>
          <MenuItem id="rename" isDisabled={!canWrite}>
            重命名
          </MenuItem>
          <MenuItem id="delete" isDanger isDisabled={!canWrite}>
            删除
          </MenuItem>
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
}

export function NoteContextMenu({
  note,
  canWrite,
  onAction,
  children,
  contextMenu = true,
  onOpenChange
}: {
  note: Note;
  canWrite: boolean;
  onAction(action: SidebarTreeAction): void;
  children: ReactNode;
  contextMenu?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  return (
    <>
      <MenuTrigger {...(contextMenu ? { trigger: 'contextMenu' as const } : {})} onOpenChange={onOpenChange}>
        {children}
        <MenuPopover placement="right top">
          <Menu
            ariaLabel={`${note.title || '未命名笔记'}笔记操作`}
            onAction={key => {
              if (key === 'favorite') onAction({ type: 'toggle-favorite', note });
              if (key === 'move') onAction({ type: 'move-note', note });
              if (key === 'rename') onAction({ type: 'rename-note', note });
              if (key === 'delete') onAction({ type: 'delete-note', note });
              if (key === 'privacy') setPrivacyOpen(true);
            }}
          >
            <MenuItem id="favorite" isDisabled={!canWrite}>
              {note.favorite ? '取消收藏' : '收藏笔记'}
            </MenuItem>
            <MenuSeparator />
            <MenuItem id="move" isDisabled={!canWrite}>
              移动到…
            </MenuItem>
            <MenuItem id="rename" isDisabled={!canWrite}>
              重命名
            </MenuItem>
            <MenuItem id="privacy" isDisabled={!canWrite}>
              AI 隐私：{note.aiVisibility === 'private' ? '私密' : '普通'}
            </MenuItem>
            <MenuItem id="delete" isDanger isDisabled={!canWrite}>
              删除
            </MenuItem>
          </Menu>
        </MenuPopover>
      </MenuTrigger>
      <NotePrivacyDialog note={note} isOpen={privacyOpen} onOpenChange={setPrivacyOpen} />
    </>
  );
}
