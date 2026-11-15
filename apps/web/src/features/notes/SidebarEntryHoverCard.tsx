import type { RefObject } from 'react';
import type { Folder, Note, Tag } from '@study-accelerator/web-core';
import { Button, IconButton, Popover } from '../../components/ui';
import {
  ArrowRightIcon,
  ClockIcon,
  DeleteIcon,
  EditIcon,
  FolderIcon,
  NoteIcon,
  PdfFileIcon,
  PlusIcon,
  SidebarClosedFolderIcon,
  SolidExpandedFolderIcon,
  StarIcon,
  TagIcon
} from '../../components/icons/knowra';
import { TagChip } from '../tags';
import { itemTags } from './NotesIndexItemMeta';
import { folderRecentActivity, folderTypeCounts, formatUpdatedAt } from './notesIndexModel';
import { folderLocation } from './notesIndexNavigation';
import type { SidebarTreeAction } from './SidebarFolderTree';
import styles from './NotesContextSidebar.module.css';

export interface HoverCardFolderItem {
  kind: 'folder';
  folder: Folder;
  expanded: boolean;
}

export interface HoverCardNoteItem {
  kind: 'note';
  note: Note;
}

export type HoverCardItem = HoverCardFolderItem | HoverCardNoteItem;

interface SidebarEntryHoverCardProps {
  item: HoverCardItem | null;
  isOpen: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  cardRef: RefObject<HTMLDivElement | null>;
  notes: Note[];
  foldersById: Record<string, Folder>;
  tags: Tag[];
  canWrite: boolean;
  onAction(action: SidebarTreeAction): void;
  onDismiss(): void;
  onPointerEnter(): void;
  onPointerLeave(): void;
}

export function SidebarEntryHoverCard({
  item,
  isOpen,
  triggerRef,
  cardRef,
  notes,
  foldersById,
  tags,
  canWrite,
  onAction,
  onDismiss,
  onPointerEnter,
  onPointerLeave
}: SidebarEntryHoverCardProps) {
  function runDialogAction(action: SidebarTreeAction) {
    onDismiss();
    onAction(action);
  }

  return (
    <Popover
      triggerRef={triggerRef}
      isOpen={isOpen && Boolean(item)}
      isNonModal
      placement="right top"
      offset={10}
      containerPadding={12}
      shouldFlip
      shouldCloseOnInteractOutside={element => !triggerRef.current?.contains(element)}
      onOpenChange={open => {
        if (!open) onDismiss();
      }}
      className={styles.hoverCardPopover}
    >
      {item ? (
        <div
          ref={cardRef}
          role="region"
          aria-label={
            item.kind === 'folder' ? `${item.folder.name}文件夹信息` : `${item.note.title || '未命名笔记'}信息`
          }
          className={styles.hoverCard}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
        >
          {item.kind === 'folder' ? (
            <FolderHoverCardBody
              folder={item.folder}
              expanded={item.expanded}
              notes={notes}
              foldersById={foldersById}
              canWrite={canWrite}
              onDialogAction={runDialogAction}
            />
          ) : (
            <NoteHoverCardBody
              note={item.note}
              foldersById={foldersById}
              tags={tags}
              canWrite={canWrite}
              onAction={onAction}
              onDialogAction={runDialogAction}
            />
          )}
        </div>
      ) : null}
    </Popover>
  );
}

function FolderHoverCardBody({
  folder,
  expanded,
  notes,
  foldersById,
  canWrite,
  onDialogAction
}: {
  folder: Folder;
  expanded: boolean;
  notes: Note[];
  foldersById: Record<string, Folder>;
  canWrite: boolean;
  onDialogAction(action: SidebarTreeAction): void;
}) {
  const counts = folderTypeCounts(folder, notes);
  const recent = folderRecentActivity(folder, notes, 0);
  const statParts: string[] = [];
  if (counts.notes > 0) statParts.push(`${counts.notes} 篇笔记`);
  if (counts.pdfs > 0) statParts.push(`${counts.pdfs} 份 PDF`);
  if (statParts.length === 0) statParts.push('暂无文档');
  if (folder.children.length > 0) statParts.push(`${folder.children.length} 个子文件夹`);

  return (
    <>
      <div className={styles.hoverCardSection}>
        <div className={styles.hoverCardHeader}>
          <span className={styles.hoverCardIcon} aria-hidden="true">
            {expanded ? <SolidExpandedFolderIcon size={16} /> : <SidebarClosedFolderIcon size={16} />}
          </span>
          <strong className={styles.hoverCardTitle}>{folder.name}</strong>
          <IconButton
            size={24}
            aria-label="新建笔记"
            title="新建笔记"
            isDisabled={!canWrite}
            onPress={() => onDialogAction({ type: 'create-note', folder })}
          >
            <PlusIcon size={14} />
          </IconButton>
        </div>
        <div className={styles.hoverCardMetaRow}>
          <NoteIcon size={14} />
          <span>{statParts.join(' · ')}</span>
        </div>
      </div>

      <div className={`${styles.hoverCardSection} ${styles.hoverCardDivider}`}>
        <div className={styles.hoverCardMetaList}>
          <div className={styles.hoverCardMetaRow}>
            <FolderIcon size={14} />
            <span>{folderLocation(folder.parentId, foldersById)}</span>
          </div>
          <div className={styles.hoverCardMetaRow}>
            <ClockIcon size={14} />
            <span>更新于 {formatUpdatedAt(recent.updatedAt)}</span>
          </div>
        </div>
      </div>

      <div className={`${styles.hoverCardActions} ${styles.hoverCardDivider}`}>
        <Button
          variant="ghost"
          size="mini"
          shape="square"
          isDisabled={!canWrite}
          onPress={() => onDialogAction({ type: 'create-folder', folder })}
        >
          <FolderIcon size={13} />
          新建子文件夹
        </Button>
        <Button
          variant="ghost"
          size="mini"
          shape="square"
          isDisabled={!canWrite}
          onPress={() => onDialogAction({ type: 'rename-folder', folder })}
        >
          <EditIcon size={13} />
          重命名
        </Button>
        <Button
          variant="ghost"
          size="mini"
          shape="square"
          isDisabled={!canWrite}
          onPress={() => onDialogAction({ type: 'move-folder', folder })}
        >
          <ArrowRightIcon size={13} />
          移动到…
        </Button>
        <Button
          variant="ghost"
          size="mini"
          shape="square"
          className={styles.hoverCardDangerAction}
          isDisabled={!canWrite}
          onPress={() => onDialogAction({ type: 'delete-folder', folder })}
        >
          <DeleteIcon size={13} />
          删除
        </Button>
      </div>
    </>
  );
}

function NoteHoverCardBody({
  note,
  foldersById,
  tags,
  canWrite,
  onAction,
  onDialogAction
}: {
  note: Note;
  foldersById: Record<string, Folder>;
  tags: Tag[];
  canWrite: boolean;
  onAction(action: SidebarTreeAction): void;
  onDialogAction(action: SidebarTreeAction): void;
}) {
  const noteTitle = note.title || '未命名笔记';
  const noteTags = itemTags(note, tags);

  return (
    <>
      <div className={styles.hoverCardSection}>
        <div className={styles.hoverCardHeader}>
          <span className={styles.hoverCardIcon} aria-hidden="true">
            {note.contentKind === 'pdf' ? <PdfFileIcon size={16} /> : <NoteIcon size={16} />}
          </span>
          <strong className={styles.hoverCardTitle}>{noteTitle}</strong>
          <IconButton
            size={24}
            className={styles.hoverCardFav}
            aria-label={note.favorite ? '取消收藏' : '收藏笔记'}
            title={note.favorite ? '取消收藏' : '收藏笔记'}
            aria-pressed={note.favorite}
            data-favorite={note.favorite || undefined}
            isDisabled={!canWrite}
            onPress={() => onAction({ type: 'toggle-favorite', note })}
          >
            <StarIcon size={14} />
          </IconButton>
        </div>

        <div className={styles.hoverCardMetaList}>
          <div className={styles.hoverCardMetaRow}>
            <FolderIcon size={14} />
            <span>{folderLocation(note.folderId, foldersById)}</span>
          </div>
          <div className={styles.hoverCardMetaRow}>
            <ClockIcon size={14} />
            <span>更新于 {formatUpdatedAt(note.updatedAt)}</span>
          </div>
          {noteTags.length > 0 ? (
            <div className={styles.hoverCardMetaRow}>
              <TagIcon size={14} />
              <div className={styles.hoverCardTags}>
                {noteTags.slice(0, 4).map(tag => (
                  <TagChip key={tag.id} tag={tag} className={styles.hoverCardTagChip} />
                ))}
                {noteTags.length > 4 ? <span className={styles.hoverCardTagMore}>+{noteTags.length - 4}</span> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className={`${styles.hoverCardActions} ${styles.hoverCardDivider}`}>
        <Button
          variant="ghost"
          size="mini"
          shape="square"
          isDisabled={!canWrite}
          onPress={() => onDialogAction({ type: 'rename-note', note })}
        >
          <EditIcon size={13} />
          重命名
        </Button>
        <Button
          variant="ghost"
          size="mini"
          shape="square"
          isDisabled={!canWrite}
          onPress={() => onDialogAction({ type: 'move-note', note })}
        >
          <ArrowRightIcon size={13} />
          移动到…
        </Button>
        <Button
          variant="ghost"
          size="mini"
          shape="square"
          className={styles.hoverCardDangerAction}
          isDisabled={!canWrite}
          onPress={() => onDialogAction({ type: 'delete-note', note })}
        >
          <DeleteIcon size={13} />
          删除
        </Button>
      </div>
    </>
  );
}
