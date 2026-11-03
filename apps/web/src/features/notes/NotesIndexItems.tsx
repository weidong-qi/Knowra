import type { Folder, Note, Tag } from '@study-accelerator/web-core';
import { Checkbox } from '../../components/ui';
import { FolderIcon, NoteIcon } from '../../components/icons/knowra';
import type { SidebarTreeAction } from './SidebarFolderTree';
import { countFolderNotes, formatUpdatedAt } from './notesIndexModel';
import { folderLocation, displayNoteStatus } from './notesIndexNavigation';
import { itemKey, DEFAULT_DISPLAY_PROPERTIES, type IndexDisplayProperties, type IndexItem } from './notesIndexPresentation';
import { IndexItemActions, RecycleNoteActions, openIndexItemMenu } from './IndexItemActions';
import { useEntryDragDrop, useEntryDropTarget } from './EntryDragDrop';
import { NotesIndexArt } from './NotesIndexArt';
import { MathText } from '../../components/math/MathText';
import { ItemTags, ItemStatus, ItemFavorite, itemTags, notePreview } from './NotesIndexItemMeta';
import styles from './NotesIndexItems.module.css';

interface ItemDisplayProps { tags?: Tag[]; properties?: IndexDisplayProperties; iconSize?: 's' | 'm' | 'l' }

interface NotesTableProps extends ItemDisplayProps {
  items: IndexItem[];
  selectedNoteId: string | null;
  onSelectFolder(id: string): void;
  onSelectNote(id: string): void;
  foldersById: Record<string, Folder>;
  isRecycleView: boolean;
  recyclePendingId: string | null;
  onRestore(note: Note): void;
  onRequestPermanentDelete(note: Note): void;
  selectionMode: boolean;
  selectedNoteIds: Set<string>;
  onToggleSelection(noteId: string, selected: boolean): void;
  canWrite: boolean;
  onItemAction(action: SidebarTreeAction): void;
}

export function NotesTable(props: NotesTableProps) {
  const { items, selectionMode, properties = DEFAULT_DISPLAY_PROPERTIES } = props;
  const canSelect = props.canWrite && !props.isRecycleView;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} data-selection-mode={selectionMode || undefined} data-can-select={canSelect || undefined} data-show-tags={properties.tags} data-show-status={properties.status} data-show-location={properties.location} data-show-updated={properties.updated}>
        <colgroup>
          {canSelect ? <col className={styles.selectionColumn} /> : null}
          <col className={styles.nameColumn} />
          <col className={styles.tagsColumn} /><col className={styles.statusColumn} />
          <col className={styles.locationColumn} /><col className={styles.updatedColumn} />
          <col className={styles.actionColumn} />
        </colgroup>
        <thead><tr>{canSelect ? <th scope="col" className={styles.selectionColumn}><span className={styles.srOnly}>选择</span></th> : null}<th scope="col" className={styles.nameColumn}>名称</th><th scope="col" className={styles.tagsColumn}>标签</th><th scope="col" className={styles.statusColumn}>状态</th><th scope="col" className={styles.locationColumn}>位置</th><th scope="col" className={styles.updatedColumn}>最近更新</th><th scope="col" className={styles.actionColumn}><span className={styles.srOnly}>操作</span></th></tr></thead>
        <tbody>{items.map((item) => <IndexTableRow key={itemKey(item)} {...props} item={item} />)}</tbody>
      </table>
    </div>
  );
}

function IndexTableRow({ item, selectedNoteId, onSelectFolder, onSelectNote, foldersById, isRecycleView, recyclePendingId, onRestore, onRequestPermanentDelete, selectionMode, selectedNoteIds, onToggleSelection, canWrite, onItemAction, tags = [], properties = DEFAULT_DISPLAY_PROPERTIES }: NotesTableProps & { item: IndexItem }) {
  const dragDrop = useEntryDragDrop();
  const isFolder = item.kind === 'folder';
  const id = isFolder ? item.folder.id : item.note.id;
  const name = isFolder ? item.folder.name : item.note.title;
  const updatedAt = isFolder ? item.folder.updatedAt : item.note.updatedAt;
  const location = folderLocation(isFolder ? item.folder.parentId : item.note.folderId, foldersById);
  const status = isFolder ? '文件夹' : (item.note.deleted ? '回收站' : displayNoteStatus(item.note.status));
  const folderDrop = useEntryDropTarget(isFolder && !isRecycleView && !selectionMode ? id : undefined);
  return <tr
    data-entry-item
    data-entry-key={itemKey(item)}
    data-kind={item.kind}
    data-selected={!isFolder && (selectedNoteId === id || selectedNoteIds.has(id)) ? true : undefined}
    data-drop-active={folderDrop.isOver || undefined}
    data-dragging={dragDrop?.dragging?.kind === item.kind && dragDrop.dragging.id === id || undefined}
    onDragOver={folderDrop.onDragOver}
    onDragLeave={folderDrop.onDragLeave}
    onDrop={folderDrop.onDrop}
    onContextMenu={openIndexItemMenu}
    onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>('[data-index-item-menu-trigger]')?.click(); } }}
  >
    {canWrite && !isRecycleView ? <td className={styles.selectionCell}>{!isFolder ? (
      <Checkbox
        aria-label={`选择${name || '未命名笔记'}`}
        isSelected={selectedNoteIds.has(id)}
        onChange={(selected) => onToggleSelection(id, selected)}
      />
    ) : null}</td> : null}
    <td className={styles.nameData}>
      <button type="button" data-index-primary className={styles.nameCell} aria-label={name || '未命名笔记'}
        aria-description={properties.updated ? `最近更新${formatUpdatedAt(updatedAt)}` : undefined} disabled={isRecycleView && !isFolder}
        draggable={canWrite && !isRecycleView && !selectionMode}
        onDragStart={(event) => dragDrop?.start(event, { kind: item.kind, id })}
        onDragEnd={() => dragDrop?.end()}
        onClick={() => {
        if (!isFolder && selectionMode) onToggleSelection(id, !selectedNoteIds.has(id));
        else if (isFolder) onSelectFolder(id);
        else onSelectNote(id);
      }}>
        <span className={styles.entryIcon} data-art-kind={isFolder ? 'folder' : 'document'} aria-hidden="true">{isFolder ? <FolderIcon size={18} /> : <NoteIcon size={18} />}</span>
        <strong title={name || '未命名笔记'}>{name || '未命名笔记'}</strong>
        {!isFolder && item.note.favorite ? <ItemFavorite /> : null}
        {!isFolder && properties.summary ? <span className={styles.rowSummary} aria-hidden="true"><MathText text={notePreview(item.note)} inlineOnly /></span> : null}
      </button>
    </td>
    <td className={styles.tagsData}>{!isFolder ? <ItemTags tags={itemTags(item.note, tags)} /> : null}</td>
    <td className={styles.statusData}><ItemStatus status={status} /></td>
    <td className={styles.locationData} title={location}>{location}</td>
    <td className={styles.updatedData}>{formatUpdatedAt(updatedAt)}</td>
    <td className={`${styles.more} ${styles.actionData}`}>{!isFolder && isRecycleView ? (
      <RecycleNoteActions
        note={item.note}
        pending={recyclePendingId === item.note.id}
        onRestore={onRestore}
        onRequestPermanentDelete={onRequestPermanentDelete}
      />
    ) : (
      <IndexItemActions item={item} canWrite={canWrite} onAction={onItemAction} />
    )}</td>
  </tr>;
}
export function IndexTile({ item, notes, selectedNoteId, onSelectFolder, onSelectNote, isRecycleView, recyclePendingId, onRestore, onRequestPermanentDelete, selectionMode, selected, onToggleSelection, canWrite, onItemAction, view = 'grid', tags = [], properties = DEFAULT_DISPLAY_PROPERTIES, iconSize = 'm' }: ItemDisplayProps & {
  view?: 'grid' | 'card';
  item: IndexItem; notes: Note[]; selectedNoteId: string | null;
  onSelectFolder(id: string): void; onSelectNote(id: string): void;
  isRecycleView: boolean;
  recyclePendingId: string | null;
  onRestore(note: Note): void;
  onRequestPermanentDelete(note: Note): void;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelection(noteId: string, selected: boolean): void;
  canWrite: boolean;
  onItemAction(action: SidebarTreeAction): void;
}) {
  const isFolder = item.kind === 'folder';
  const entity = isFolder ? item.folder : item.note;
  const count = isFolder ? countFolderNotes(item.folder, notes) : 0;
  const status = isFolder ? '文件夹' : item.note.deleted ? '回收站' : displayNoteStatus(item.note.status);
  const noteTags = isFolder ? [] : itemTags(item.note, tags);
  const dragDrop = useEntryDragDrop();
  const folderDrop = useEntryDropTarget(isFolder && !isRecycleView && !selectionMode ? entity.id : undefined);
  return (
    <div className={styles.tileShell} data-entry-item data-entry-key={itemKey(item)} data-view={view} data-icon-size={iconSize} data-kind={item.kind} data-selection-mode={selectionMode || undefined} data-selected={selected || undefined} onContextMenu={openIndexItemMenu}
      onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>('[data-index-item-menu-trigger]')?.click(); } }}>
      {!isFolder && canWrite && !isRecycleView ? <span className={styles.tileSelection}>
        <Checkbox aria-label={`选择${item.note.title || '未命名笔记'}`} isSelected={selected} onChange={(next) => onToggleSelection(item.note.id, next)} />
      </span> : null}
      <button
        type="button"
        className={styles.tile}
        data-index-primary
        aria-label={isFolder ? item.folder.name : item.note.title || '未命名笔记'}
        aria-description={isFolder ? `${count} 项` : [status, item.note.favorite ? '已收藏' : '', ...noteTags.map(tag => tag.name),
          properties.updated ? `最近更新${formatUpdatedAt(entity.updatedAt)}` : ''].filter(Boolean).join('，')}
        disabled={isRecycleView && !isFolder}
        data-selected={!isFolder && (selectedNoteId === entity.id || selected) ? true : undefined}
        data-drop-active={folderDrop.isOver || undefined}
        data-dragging={dragDrop?.dragging?.kind === item.kind && dragDrop.dragging.id === entity.id || undefined}
        draggable={canWrite && !isRecycleView && !selectionMode}
        onDragStart={(event) => dragDrop?.start(event, { kind: item.kind, id: entity.id })}
        onDragEnd={() => dragDrop?.end()}
        onDragOver={folderDrop.onDragOver}
        onDragLeave={folderDrop.onDragLeave}
        onDrop={folderDrop.onDrop}
        onClick={() => {
          if (!isFolder && selectionMode) onToggleSelection(entity.id, !selected);
          else if (isFolder) onSelectFolder(entity.id);
          else onSelectNote(entity.id);
        }}
      >
      <span className={styles.tileArt}>
        <NotesIndexArt item={item} tags={noteTags} cover={view === 'card' && !isFolder} folderStyle={view === 'card' ? 'badge' : 'illustrated'} noteCount={count} />
        {view === 'grid' && !isFolder && item.note.favorite ? <span className={styles.artFavorite}><ItemFavorite /></span> : null}
      </span>
      <span className={styles.tileCopy}>
        <span className={styles.tileTitle}><strong title={isFolder ? item.folder.name : item.note.title || '未命名笔记'}>{isFolder ? item.folder.name : item.note.title || '未命名笔记'}</strong>
          {view === 'card' && !isFolder && item.note.favorite ? <ItemFavorite /> : null}
        </span>
        {view === 'card' && !isFolder && properties.summary ? <span className={styles.cardSummary}><MathText text={notePreview(item.note)} inlineOnly /></span> : null}
        <small>
          {!isFolder && properties.status ? <ItemStatus status={status} compact /> : null}
          {isFolder ? <span>{count} 项</span> : null}
          {view === 'card' && properties.tags ? <ItemTags tags={noteTags} limit={1} /> : null}
          {properties.updated && !isFolder ? <span className={styles.tileDate}>{formatUpdatedAt(entity.updatedAt)}</span> : null}
        </small>
        {view === 'grid' && properties.tags ? <ItemTags tags={noteTags} dots /> : null}
      </span>
      </button>
      {!isFolder && isRecycleView ? (
        <span className={styles.tileActions}>
          <RecycleNoteActions
            note={item.note}
            pending={recyclePendingId === item.note.id}
            onRestore={onRestore}
            onRequestPermanentDelete={onRequestPermanentDelete}
          />
        </span>
      ) : (
        <span className={styles.tileActions}>
          <IndexItemActions item={item} canWrite={canWrite} onAction={onItemAction} />
        </span>
      )}
    </div>
  );
}
