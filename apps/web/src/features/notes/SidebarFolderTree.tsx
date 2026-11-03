import { useState, type ReactNode } from 'react';
import { NotePrivacyDialog } from '../assistant/NotePrivacyDialog';
import type { Folder, Note } from '@study-accelerator/web-core';
import {
  Menu,
  MenuItem,
  MenuPopover,
  MenuSeparator,
  MenuTrigger,
  PressableButton
} from '../../components/ui';
import { ChevronRightIcon, FolderIcon, NoteIcon, SolidFolderIcon, SolidExpandedFolderIcon } from '../../components/icons/knowra';
import { useAppStore, useAppStoreApi } from '../../store/AppStoreProvider';
import { countFolderNotes, folderMatchesQuery } from './notesIndexModel';
import { useEntryDragDrop, useEntryDropTarget } from './EntryDragDrop';
import styles from './NotesContextSidebar.module.css';

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

export function SidebarFolderTree({ folders, notes, query, canWrite, onAction, onOpenIndex, onOpenNote }: SidebarFolderTreeProps) {
  const visibleFolders = folders.filter((folder) => folderMatchesQuery(folder, notes, query));
  if (visibleFolders.length === 0) {
    const isEmptyLibrary = folders.length === 0 && !query.trim();
    return (
      <p className={styles.empty}>
        {isEmptyLibrary ? '暂无文件夹，可使用右侧按钮创建' : '没有匹配的文件夹'}
      </p>
    );
  }
  return (
    <div className={styles.folderTree} role="tree" aria-label="笔记文件夹">
      {visibleFolders.map((folder) => (
        <FolderBranch
          key={folder.id}
          folder={folder}
          notes={notes}
          query={query}
          level={1}
          canWrite={canWrite}
          onAction={onAction}
          onOpenIndex={onOpenIndex}
          onOpenNote={onOpenNote}
        />
      ))}
    </div>
  );
}

function FolderBranch({ folder, notes, query, level, canWrite, onAction, onOpenIndex, onOpenNote }: {
  folder: Folder;
  notes: Note[];
  query: string;
  level: number;
  canWrite: boolean;
  onAction(action: SidebarTreeAction): void;
  onOpenIndex?(): void;
  onOpenNote?(noteId: string): void;
}) {
  const isOpen = useAppStore((state) => Boolean(state.navigation.openFolders[folder.id]));
  const isSelected = useAppStore((state) => state.navigation.selectedFolderId === folder.id);
  const selectedNoteId = useAppStore((state) => state.navigation.selectedNoteId);
  const toggleFolder = useAppStore((state) => state.toggleFolder);
  const storeApi = useAppStoreApi();
  const dragDrop = useEntryDragDrop();
  const selectFolder = useAppStore((state) => state.selectNotesFolder);
  const directNotes = notes.filter((note) => !note.deleted && note.folderId === folder.id);
  const childFolders = folder.children.filter((child) => folderMatchesQuery(child, notes, query));
  const canExpand = childFolders.length > 0 || directNotes.length > 0;
  const forcedOpen = Boolean(query.trim());
  const expanded = canExpand && (isOpen || forcedOpen);
  const folderDrop = useEntryDropTarget(folder.id, () => {
    if (canExpand && !storeApi.getState().navigation.openFolders[folder.id]) {
      storeApi.getState().toggleFolder(folder.id);
    }
  });

  return (
    <div role="treeitem" aria-level={level} aria-expanded={canExpand ? expanded : undefined}>
      <div className={styles.folderLine}>
        <button
          type="button"
          className={styles.folderToggle}
          aria-label={`${expanded ? '收起' : '展开'}${folder.name}`}
          disabled={!canExpand}
          data-folder-toggle={folder.id}
          onClick={() => toggleFolder(folder.id)}
        >
          <ChevronRightIcon size={14} data-open={expanded || undefined} />
        </button>
        <div className={styles.entryDragArea}
          draggable={canWrite}
          onDragStart={(event) => dragDrop?.start(event, { kind: 'folder', id: folder.id })}
          onDragEnd={() => dragDrop?.end()}
          onDragOver={folderDrop.onDragOver}
          onDragLeave={folderDrop.onDragLeave}
          onDrop={folderDrop.onDrop}
        >
        <FolderContextMenu folder={folder} canWrite={canWrite} onAction={onAction}>
          <PressableButton
            type="button"
            className={styles.folderRow}
            data-folder-id={folder.id}
            data-drop-active={folderDrop.isOver || undefined}
            data-dragging={dragDrop?.dragging?.kind === 'folder' && dragDrop.dragging.id === folder.id || undefined}
            aria-current={isSelected ? 'page' : undefined}
            onClick={() => {
              selectFolder(folder.id);
              if (canExpand) toggleFolder(folder.id);
              onOpenIndex?.();
            }}
          >
            {expanded ? <SolidExpandedFolderIcon size={16} /> : <SolidFolderIcon size={16} />}
            <span>{folder.name}</span>
            <small>{countFolderNotes(folder, notes)}</small>
          </PressableButton>
        </FolderContextMenu>
        </div>
      </div>
      {expanded ? (
        <div role="group" className={styles.folderChildren}>
          {childFolders.map((child) => (
            <FolderBranch
              key={child.id}
              folder={child}
              notes={notes}
              query={query}
              level={level + 1}
              canWrite={canWrite}
              onAction={onAction}
              onOpenIndex={onOpenIndex}
              onOpenNote={onOpenNote}
            />
          ))}
          {directNotes
            .filter((note) => note.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
            .map((note) => (
              <SidebarNoteRow key={note.id} note={note} selected={selectedNoteId === note.id}
                canWrite={canWrite} onAction={onAction} onOpenNote={onOpenNote} />
            ))}
        </div>
      ) : null}
    </div>
  );
}

function SidebarNoteRow({ note, selected, canWrite, onAction, onOpenNote }: {
  note: Note;
  selected: boolean;
  canWrite: boolean;
  onAction(action: SidebarTreeAction): void;
  onOpenNote?(noteId: string): void;
}) {
  const dragDrop = useEntryDragDrop();
  const selectNote = useAppStore((state) => state.selectNote);
  return <div className={styles.entryDragArea}
    draggable={canWrite}
    onDragStart={(event) => dragDrop?.start(event, { kind: 'note', id: note.id })}
    onDragEnd={() => dragDrop?.end()}
  >
  <NoteContextMenu note={note} canWrite={canWrite} onAction={onAction}>
    <PressableButton
      type="button"
      className={styles.documentRow}
      data-note-id={note.id}
      data-dragging={dragDrop?.dragging?.kind === 'note' && dragDrop.dragging.id === note.id || undefined}
      aria-current={selected ? 'page' : undefined}
      onClick={() => {
        selectNote(note.id);
        onOpenNote?.(note.id);
      }}
    >
      <NoteIcon size={15} />
      <span>{note.title || '未命名笔记'}</span>
    </PressableButton>
  </NoteContextMenu>
  </div>;
}

export function FolderContextMenu({ folder, canWrite, onAction, children, contextMenu = true }: {
  folder: Folder;
  canWrite: boolean;
  onAction(action: SidebarTreeAction): void;
  children: ReactNode;
  contextMenu?: boolean;
}) {
  return (
    <MenuTrigger {...(contextMenu ? { trigger: 'contextMenu' as const } : {})}>
      {children}
      <MenuPopover placement="right top">
        <Menu ariaLabel={`${folder.name}文件夹操作`} onAction={(key) => {
          if (key === 'create-folder') onAction({ type: 'create-folder', folder });
          if (key === 'create-note') onAction({ type: 'create-note', folder });
          if (key === 'move') onAction({ type: 'move-folder', folder });
          if (key === 'rename') onAction({ type: 'rename-folder', folder });
          if (key === 'delete') onAction({ type: 'delete-folder', folder });
        }}>
          <MenuItem id="create-folder" icon={<FolderIcon size={14} />} isDisabled={!canWrite}>新建子文件夹</MenuItem>
          <MenuItem id="create-note" icon={<NoteIcon size={14} />} isDisabled={!canWrite}>新建笔记</MenuItem>
          <MenuSeparator />
          <MenuItem id="move" isDisabled={!canWrite}>移动到…</MenuItem>
          <MenuItem id="rename" isDisabled={!canWrite}>重命名</MenuItem>
          <MenuItem id="delete" isDanger isDisabled={!canWrite}>删除</MenuItem>
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
}

export function NoteContextMenu({ note, canWrite, onAction, children, contextMenu = true }: {
  note: Note;
  canWrite: boolean;
  onAction(action: SidebarTreeAction): void;
  children: ReactNode;
  contextMenu?: boolean;
}) {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  return (
    <><MenuTrigger {...(contextMenu ? { trigger: 'contextMenu' as const } : {})}>
      {children}
      <MenuPopover placement="right top">
        <Menu ariaLabel={`${note.title || '未命名笔记'}笔记操作`} onAction={(key) => {
          if (key === 'favorite') onAction({ type: 'toggle-favorite', note });
          if (key === 'move') onAction({ type: 'move-note', note });
          if (key === 'rename') onAction({ type: 'rename-note', note });
          if (key === 'delete') onAction({ type: 'delete-note', note });
          if (key === 'privacy') setPrivacyOpen(true);
        }}>
          <MenuItem id="favorite" isDisabled={!canWrite}>{note.favorite ? '取消收藏' : '收藏笔记'}</MenuItem>
          <MenuSeparator />
          <MenuItem id="move" isDisabled={!canWrite}>移动到…</MenuItem>
          <MenuItem id="rename" isDisabled={!canWrite}>重命名</MenuItem>
          <MenuItem id="privacy" isDisabled={!canWrite}>AI 隐私：{note.aiVisibility === 'private' ? '私密' : '普通'}</MenuItem>
          <MenuItem id="delete" isDanger isDisabled={!canWrite}>删除</MenuItem>
        </Menu>
      </MenuPopover>
    </MenuTrigger><NotePrivacyDialog note={note} isOpen={privacyOpen} onOpenChange={setPrivacyOpen} /></>
  );
}
