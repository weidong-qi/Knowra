import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { Note } from '@study-accelerator/web-core';
import { IconButton, Menu, MenuItem, MenuPopover, MenuTrigger } from '../../components/ui';
import { DeleteIcon, MoreHorizontalIcon, RefreshIcon } from '../../components/icons/knowra';
import { FolderContextMenu, NoteContextMenu, type SidebarTreeAction } from './SidebarFolderTree';
import type { IndexItem } from './notesIndexPresentation';
import { useAppStore } from '../../store/AppStoreProvider';
import { workspaceCapabilities } from '../../store/workspaceCapabilities';

export function openIndexItemMenu(event: ReactMouseEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
  const trigger = event.currentTarget.querySelector<HTMLButtonElement>('[data-index-item-menu-trigger]');
  trigger?.click();
}
export function IndexItemActions({ item, canWrite, onAction }: {
  item: IndexItem;
  canWrite: boolean;
  onAction(action: SidebarTreeAction): void;
}) {
  const name = item.kind === 'folder' ? item.folder.name : item.note.title || '未命名笔记';
  const trigger = (
    <IconButton data-index-item-menu-trigger="true" size={30} aria-label={`${name}的${item.kind === 'folder' ? '文件夹' : '笔记'}操作`}>
      <MoreHorizontalIcon size={16} />
    </IconButton>
  );
  return item.kind === 'folder'
    ? <FolderContextMenu folder={item.folder} canWrite={canWrite} onAction={onAction} contextMenu={false}>{trigger}</FolderContextMenu>
    : <NoteContextMenu note={item.note} canWrite={canWrite} onAction={onAction} contextMenu={false}>{trigger}</NoteContextMenu>;
}

export function RecycleNoteActions({ note, pending, onRestore, onRequestPermanentDelete }: {
  note: Note;
  pending: boolean;
  onRestore(note: Note): void;
  onRequestPermanentDelete(note: Note): void;
}) {
  const title = note.title || '无标题笔记';
  return (
    <RecycleNoteMenu
      note={note}
      pending={pending}
      onRestore={onRestore}
      onRequestPermanentDelete={onRequestPermanentDelete}
    >
      <IconButton data-index-item-menu-trigger="true" size={30} aria-label={`${title}的回收站操作`} disabled={pending}>
        <MoreHorizontalIcon size={16} />
      </IconButton>
    </RecycleNoteMenu>
  );
}

function RecycleNoteMenu({ note, pending, onRestore, onRequestPermanentDelete, children }: {
  note: Note;
  pending: boolean;
  onRestore(note: Note): void;
  onRequestPermanentDelete(note: Note): void;
  children: ReactNode;
}) {
  const canWrite = useAppStore(state => state.canWriteWorkspace());
  const supportsPermanentDelete = useAppStore(state => workspaceCapabilities(state.persistenceMode).permanentDelete);
  const title = note.title || '无标题笔记';
  return (
    <MenuTrigger>
      {children}
      <MenuPopover placement="bottom end">
        <Menu ariaLabel={`${title}的回收站操作`}>
          <MenuItem id="restore" icon={<RefreshIcon size={14} />} isDisabled={pending || !canWrite} onAction={() => onRestore(note)}>恢复笔记</MenuItem>
          <MenuItem id="permanent-delete" icon={<DeleteIcon size={14} />} isDanger isDisabled={pending || !canWrite || !supportsPermanentDelete} onAction={() => onRequestPermanentDelete(note)}>{supportsPermanentDelete ? '彻底删除' : '彻底删除（请在网页版操作）'}</MenuItem>
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
}
