import { ScopedAppearanceProvider } from '../../components/ui/overlay';
import { CreateEntryMenu } from './CreateEntryMenu';
import { workspaceCapabilities } from '../../store/workspaceCapabilities';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronRightIcon,
  ClockIcon,
  DeleteIcon,
  EditIcon,
  FolderIcon,
  InboxIcon,
  MoreHorizontalIcon,
  MoreVerticalIcon,
  NoteIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  StarIcon
} from '../../components/icons/knowra';
import {
  IconButton, SideNavItem,
  Menu,
  MenuItem,
  MenuPopover,
  MenuTrigger,
  PointMenu
} from '../../components/ui';
import { Button, Dialog, DialogBody, DialogClose, DialogFooter, TextField } from '../../components/ui';
import { useAppStore } from '../../store/AppStoreProvider';
import { useLocation, useNavigate } from '../../app/router';
import { TagChip } from '../tags';
import { countTagUsage } from '../tags/tagUsage';
import type { NotesIndexScope } from '../../store/types';
import { NOTES_SEARCH_DEBOUNCE_MS, getScopeCount } from './notesIndexModel';
import { EmptyRecycleDialog } from './EmptyRecycleDialog';
import { SidebarFolderTree } from './SidebarFolderTree';
import { useSidebarTreeOperations } from './useSidebarTreeOperations';
import type { Folder } from '@study-accelerator/web-core';
import { scrollEntryContainer, useEntryDragDrop, useEntryDropTarget } from './EntryDragDrop';
import styles from './NotesContextSidebar.module.css';
import { useNotesIndexAppearance } from './notesIndexAppearanceModel';
import { notesIndexAppearanceProps } from './NotesIndexAppearance';
import { NotesUpdateDistribution, NotesTrashDecoration, NotesLibraryDecoration } from './NotesSidebarDecoration';

interface NavEntry {
  scope: Exclude<NotesIndexScope, 'root' | 'trash'>;
  label: string;
  Icon: typeof NoteIcon;
}

const QUICK_ENTRIES: readonly NavEntry[] = [
  { scope: 'all', label: '全部笔记', Icon: NoteIcon },
  { scope: 'recent', label: '最近编辑', Icon: ClockIcon },
  { scope: 'favorites', label: '收藏', Icon: StarIcon },
  { scope: 'unfiled', label: '未整理', Icon: InboxIcon }
];

export function NotesContextSidebar({
  onOpenNote,
  onOpenIndex,
  onOpenSearch
}: {
  onOpenNote?(noteId: string): void;
  onOpenIndex?(): void;
  onOpenSearch?(): void;
}) {
  const appearance = useNotesIndexAppearance();
  const appearanceProps = notesIndexAppearanceProps(appearance);
  const serverData = useAppStore((state) => state.serverData);
  const notesIndex = useAppStore((state) => state.notesIndex);
  const selectedFolderId = useAppStore((state) => state.navigation.selectedFolderId);
  const selectNotesScope = useAppStore((state) => state.selectNotesScope);
  const selectNotesTag = useAppStore((state) => state.selectNotesTag);
  const searchNotes = useAppStore((state) => state.searchNotes);
  const retryWorkspace = useAppStore((state) => state.retryWorkspace);
  const canWrite = useAppStore((state) => state.canWriteWorkspace());
  const supportsPermanentDelete = useAppStore(state => workspaceCapabilities(state.persistenceMode).permanentDelete);
  const emptyRecycleBin = useAppStore((state) => state.emptyRecycleBin);
  const createTag = useAppStore((state) => state.createTag);
  const listDeletedFolders = useAppStore((state) => state.listDeletedFolders);
  const restoreFolder = useAppStore((state) => state.restoreFolder);
  const navigate = useNavigate();
  const location = useLocation();
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);
  const [folderTrashOpen, setFolderTrashOpen] = useState(false);
  const [deletedFolders, setDeletedFolders] = useState<Folder[]>([]);
  const [folderTrashError, setFolderTrashError] = useState('');
  const [createTagOpen, setCreateTagOpen] = useState(false);
  const [tagMenu, setTagMenu] = useState<{ tagId: string; x: number; y: number } | null>(null);
  const [pinnedTagIds, setPinnedTagIds] = useState<string[]>(() => readPinnedTagIds());
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const treeOperations = useSidebarTreeOperations();
  const entryDragDrop = useEntryDragDrop();
  const rootDrop = useEntryDropTarget(null);
  const trashCount = getScopeCount('trash', serverData.notes);
  const rootCount = serverData.folderTree.length + getScopeCount('root', serverData.notes);
  const activeTagIds = (new URLSearchParams(location.pathname.split('?')[1] ?? '').get('tags') ?? '').split(',').filter(Boolean);
  const visibleTags = useMemo(() => {
    const usage = countTagUsage(serverData.tags, serverData.notes);
    const pinned = pinnedTagIds.map((id) => serverData.tags.find((tag) => tag.id === id)).filter(Boolean);
    return (pinned.length ? pinned : serverData.tags.slice().sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0))).slice(0, 8);
  }, [pinnedTagIds, serverData.notes, serverData.tags]);
  const contextTag = serverData.tags.find((tag) => tag.id === tagMenu?.tagId);

  useEffect(() => {
    if (!folderTrashOpen || !serverData.currentSpaceId) return;
    let active = true;
    void listDeletedFolders(serverData.currentSpaceId).then(rows => { if (active) setDeletedFolders(rows); })
      .catch(cause => { if (active) setFolderTrashError(cause instanceof Error ? cause.message : '文件夹回收站加载失败'); });
    return () => { active = false; };
  }, [folderTrashOpen, listDeletedFolders, serverData.currentSpaceId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void searchNotes(notesIndex.query);
    }, NOTES_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [notesIndex.query, searchNotes]);

  return (
    <ScopedAppearanceProvider value={appearanceProps}><div {...appearanceProps} className={`${appearanceProps.className} ${styles.sidebarContent}`} data-index-appearance>
      <header className={styles.header}>
        <span className={styles.title}>笔记</span>
        <MenuTrigger>
          <IconButton aria-label="笔记更多操作" title="更多操作">
            <MoreHorizontalIcon size={16} />
          </IconButton>
          <MenuPopover>
            <Menu
              ariaLabel="笔记目录操作"
              onAction={(key) => {
                if (key === 'new-folder') treeOperations.openCreate('folder', selectedFolderId);
                if (key === 'refresh') void retryWorkspace();
                if (key === 'empty-trash' && supportsPermanentDelete && canWrite) setTrashDialogOpen(true);
                if (key === 'folder-trash') setFolderTrashOpen(true);
              }}
            >
              <MenuItem id="new-folder" icon={<FolderIcon size={14} />} isDisabled={!canWrite}>新建文件夹</MenuItem>
              <MenuItem id="refresh" icon={<RefreshIcon size={14} />}>刷新目录</MenuItem>
              <MenuItem id="folder-trash" icon={<FolderIcon size={14} />}>文件夹回收站</MenuItem>
              <MenuItem id="empty-trash" icon={<DeleteIcon size={14} />} isDanger isDisabled={!canWrite || !supportsPermanentDelete || trashCount === 0}>
                {supportsPermanentDelete ? '清空回收站' : '清空回收站（请在网页版操作）'}
              </MenuItem>
            </Menu>
          </MenuPopover>
        </MenuTrigger>
        <IconButton aria-label="搜索笔记" title="搜索笔记" onPress={onOpenSearch} disabled={!onOpenSearch}>
          <SearchIcon size={16} />
        </IconButton>
        <CreateEntryMenu canWrite={canWrite} onCreate={mode => treeOperations.openCreate(mode, selectedFolderId)}>
          <IconButton tone="floating" aria-label="新建" title="新建" disabled={!canWrite}><EditIcon size={16} /></IconButton>
        </CreateEntryMenu>
      </header>

      <div className={styles.scrollBody} data-entry-scroll
        onDragOver={event => { if (entryDragDrop?.isInternal(event)) scrollEntryContainer(event); }}>
        <SidebarSection id="quick" title="快速入口">
          {QUICK_ENTRIES.map((entry) => {
            const current = notesIndex.scope === entry.scope
              && !selectedFolderId
              && !notesIndex.selectedTagId;
            return (
              <SideNavItem
                key={entry.scope}
                density="compact"
                icon={<entry.Icon size={15} />}
                label={entry.label}
                count={getScopeCount(entry.scope, serverData.notes)}
                aria-current={current ? 'page' : undefined}
                onPress={() => {
                  selectNotesScope(entry.scope);
                  onOpenIndex?.();
                }}
              />
            );
          })}
        </SidebarSection>

        <SidebarSection
          id="folders"
          title="文件夹"
          action={(
            <IconButton
              size={24}
              aria-label="新建文件夹"
              title="新建文件夹"
              disabled={!canWrite}
              onClick={() => treeOperations.openCreate('folder', selectedFolderId)}
            >
              <PlusIcon size={16} />
            </IconButton>
          )}
        >
          <div className={styles.entryDragArea}
            onDragOver={rootDrop.onDragOver}
            onDragLeave={rootDrop.onDragLeave}
            onDrop={rootDrop.onDrop}
          >
          <CreateEntryMenu canWrite={canWrite} onCreate={mode => treeOperations.openCreate(mode, null)} contextMenu>
          <SideNavItem
            className={styles.libraryRow}
            density="compact"
            icon={<NotesLibraryDecoration />}
            label="笔记库"
            count={rootCount}
            data-drop-active={rootDrop.isOver || undefined}
            aria-current={notesIndex.scope === 'root' ? 'page' : undefined}
            onPress={() => {
              selectNotesScope('root');
              onOpenIndex?.();
            }}
          />
          </CreateEntryMenu>
          </div>
          <SidebarFolderTree
            folders={serverData.folderTree}
            notes={serverData.notes}
            query={notesIndex.query}
            canWrite={canWrite}
            onAction={treeOperations.handleTreeAction}
            onOpenIndex={onOpenIndex}
            onOpenNote={onOpenNote}
          />
        </SidebarSection>

        <SidebarSection id="tags" title={`标签 ${serverData.tags.length}`} collapsible expanded={tagsExpanded} onExpandedChange={setTagsExpanded} action={<div className={styles.tagHeaderActions}><IconButton size={24} aria-label="新建标签" title="新建标签" disabled={!canWrite} onClick={() => setCreateTagOpen(true)}><PlusIcon size={16} /></IconButton><MenuTrigger><IconButton size={24} aria-label="标签更多操作" title="更多"><MoreVerticalIcon size={16} /></IconButton><MenuPopover><Menu ariaLabel="标签操作" onAction={(key) => { if (key === 'manage') navigate('/materials/tags'); if (key === 'expand') setTagsExpanded(true); if (key === 'collapse') setTagsExpanded(false); }}><MenuItem id="manage">管理标签</MenuItem><MenuItem id="expand">展开全部</MenuItem><MenuItem id="collapse">收起全部</MenuItem></Menu></MenuPopover></MenuTrigger></div>}>
          <div className={styles.tags} aria-label="标签筛选">
            {visibleTags.map((tag) => tag ? (
              <TagChip
                key={tag.id}
                tag={tag}
                selected={activeTagIds.includes(tag.id)}
                aria-pressed={activeTagIds.includes(tag.id)}
                onClick={() => {
                  selectNotesTag(activeTagIds.includes(tag.id) ? null : tag.id);
                  if (activeTagIds.includes(tag.id)) navigate('/materials');
                  else navigate(`/materials?tags=${encodeURIComponent(tag.id)}&match=all`);
                }}
                onContextMenu={(event) => { event.preventDefault(); setTagMenu({ tagId: tag.id, x: event.clientX, y: event.clientY }); }}
              />
            ) : null)}
            {serverData.tags.length === 0 ? <div className={styles.tagEmpty}><span className={styles.emptyInline}>暂无标签</span>{canWrite ? <Button variant="ghost" size="compact" onPress={() => setCreateTagOpen(true)}>新建标签</Button> : null}</div> : null}
            {serverData.tags.length > visibleTags.length ? <Button className={styles.allTags} variant="ghost" size="compact" onPress={() => navigate('/materials/tags')}>全部标签·{serverData.tags.length}</Button> : null}
          </div>
        </SidebarSection>
        <NotesUpdateDistribution notes={serverData.notes} />
      </div>

      <footer className={styles.footer}>
        <SideNavItem
          density="compact"
          icon={<NotesTrashDecoration full={trashCount > 0} />}
          label="回收站"
          count={trashCount}
          aria-current={notesIndex.scope === 'trash' ? 'page' : undefined}
          onPress={() => {
            selectNotesScope('trash');
            onOpenIndex?.();
          }}
        />
      </footer>

      {treeOperations.dialogs}
      <EmptyRecycleDialog
        isOpen={trashDialogOpen}
        count={trashCount}
        onOpenChange={setTrashDialogOpen}
        onEmpty={emptyRecycleBin}
      />
      <Dialog title="文件夹回收站" isOpen={folderTrashOpen} onOpenChange={setFolderTrashOpen}>
        <DialogBody>{folderTrashError ? <p role="alert">{folderTrashError}</p> : null}
          {deletedFolders.length === 0 ? <p>暂无已删除的文件夹。</p> : deletedFolders.map(folder => <p key={folder.id}><strong>{folder.name}</strong> · {folder.deletionPackage?.mode === 'with-content' ? `包含 ${folder.deletionPackage.noteIds.length} 篇随同删除的笔记` : '笔记已移出'} <Button variant="ghost" isDisabled={!canWrite} onPress={() => void restoreFolder(folder.id).then(() => setDeletedFolders(rows => rows.filter(row => row.id !== folder.id))).catch(cause => setFolderTrashError(cause instanceof Error ? cause.message : '恢复失败'))}>恢复</Button></p>)}
        </DialogBody><DialogFooter><DialogClose variant="ghost">关闭</DialogClose></DialogFooter>
      </Dialog>
      <QuickCreateTagDialog isOpen={createTagOpen} groups={serverData.tagGroups} onOpenChange={setCreateTagOpen} onCreate={createTag} />
      <PointMenu point={tagMenu} onOpenChange={(open) => { if (!open) setTagMenu(null); }}>
        <Menu ariaLabel="标签操作" onAction={(key) => {
          const tagId = tagMenu?.tagId;
          if (!tagId) return;
          if (key === 'view') navigate(`/materials?tags=${encodeURIComponent(tagId)}&match=all`);
          if (key === 'pin') {
            const next = pinnedTagIds.includes(tagId) ? pinnedTagIds.filter((id) => id !== tagId) : [...pinnedTagIds, tagId];
            setPinnedTagIds(next);
            writePinnedTagIds(next);
          }
          if (key === 'edit' || key === 'manage') navigate('/materials/tags');
          setTagMenu(null);
        }}>
          <MenuItem id="view">查看相关笔记</MenuItem>
          <MenuItem id="pin">{tagMenu && pinnedTagIds.includes(tagMenu.tagId) ? '取消固定' : '固定标签'}</MenuItem>
          {canWrite ? <MenuItem id="edit">编辑标签{contextTag?.name ? `“${contextTag.name}”` : ''}</MenuItem> : null}
          <MenuItem id="manage">进入标签管理</MenuItem>
        </Menu>
      </PointMenu>
    </div></ScopedAppearanceProvider>
  );
}

function SidebarSection({
  id,
  title,
  action,
  collapsible = false,
  expanded: controlledExpanded,
  onExpandedChange,
  children
}: {
  id: string;
  title: string;
  action?: ReactNode;
  collapsible?: boolean;
  expanded?: boolean;
  onExpandedChange?(expanded: boolean): void;
  children: ReactNode;
}) {
  const [internalExpanded, setInternalExpanded] = useState(true);
  const expanded = controlledExpanded ?? internalExpanded;
  const setExpanded = (next: boolean) => {
    if (controlledExpanded === undefined) setInternalExpanded(next);
    onExpandedChange?.(next);
  };
  const bodyId = `sidebar-${id}-body`;
  return (
    <section className={styles.section} aria-labelledby={`sidebar-${id}`}>
      {action || collapsible ? (
        <div className={styles.sectionHeader}>
          <h2 id={`sidebar-${id}`} className={styles.sectionTitle}>
            {collapsible ? (
              <button
                type="button"
                className={styles.sectionToggle}
                aria-label={id === 'tags' ? '标签' : undefined}
                aria-expanded={expanded}
                aria-controls={bodyId}
                onClick={() => setExpanded(!expanded)}
              >
                <span className={styles.sectionChevron} data-expanded={expanded || undefined} aria-hidden="true">
                  <ChevronRightIcon size={14} />
                </span>
                <span>{title}</span>
              </button>
            ) : title}
          </h2>
          {action}
        </div>
      ) : (
        <h2 id={`sidebar-${id}`} className={styles.sectionTitle}>{title}</h2>
      )}
      <div id={bodyId} className={styles.sectionBody} hidden={collapsible && !expanded}>{children}</div>
    </section>
  );
}

function QuickCreateTagDialog({ isOpen, groups, onOpenChange, onCreate }: { isOpen: boolean; groups: import('@study-accelerator/web-core').TagGroup[]; onOpenChange(open: boolean): void; onCreate(input: { name: string; color: import('@study-accelerator/web-core').TagColor; groupId: string }): Promise<unknown> }) {
  const [name, setName] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState(''); const ordinary = groups.find((group) => group.code === 'ordinary') ?? groups[0];
  if (!isOpen) return null;
  return <Dialog title="新建标签" description="默认创建到“普通标签”分组，更多属性可在标签管理中调整。" isOpen onOpenChange={onOpenChange} isPending={pending}><DialogBody><TextField label="标签名称" autoFocus value={name} maxLength={30} onChange={setName} />{error ? <p className={styles.tagError} role="alert">{error}</p> : null}</DialogBody><DialogFooter><DialogClose variant="ghost">取消</DialogClose><Button variant="primary" isDisabled={!name.trim() || !ordinary} isPending={pending} onPress={() => { if (!ordinary) return; setPending(true); setError(''); void onCreate({ name: name.trim(), color: 'blue', groupId: ordinary.id }).then(() => { setName(''); onOpenChange(false); }).catch((cause) => setError(cause instanceof Error ? cause.message : '创建失败')).finally(() => setPending(false)); }}>创建标签</Button></DialogFooter></Dialog>;
}

function readPinnedTagIds(): string[] { try { const value = localStorage.getItem('knowra:pinned-tags'); return value ? JSON.parse(value) : []; } catch { return []; } }
function writePinnedTagIds(ids: string[]) { try { localStorage.setItem('knowra:pinned-tags', JSON.stringify(ids)); } catch { /* local preference is best effort */ } }
