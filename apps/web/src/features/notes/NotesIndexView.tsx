import { ScopedAppearanceProvider } from '../../components/ui/overlay';
import { Button, Checkbox, EmptyArt, PressableButton } from '../../components/ui';
import { ChevronDownIcon, PlusIcon } from '../../components/icons/knowra';
import { WorkspacePanel, WorkspacePanelBody } from '../../components/workspace/WorkspacePanel';
import type { PathSegment } from '../../shell/path';
import { LOCAL_PERMANENT_DELETE_REASON } from '../../store/workspaceCapabilities';
import { NotesIndexHeader } from './NotesIndexHeader';
import { NotesIndexCompactTools, NotesIndexDesktopTools } from './NotesIndexToolbar';
import { useCompactLayout } from '../../shell/useCompactLayout';
import { NotesIndexDialogs } from './NotesIndexDialogs';
import { NotesIndexPreview } from './NotesIndexPreview';
import { NotesIndexPagination } from './NotesIndexPagination';
import { NotesTable, IndexTile } from './NotesIndexItems';
import { NotesIndexFilterChips } from './NotesIndexFilterChips';
import { NotesIndexFilterMenu } from './NotesIndexFilterMenu';
import { scrollEntryContainer } from './EntryDragDrop';
import { itemKey } from './notesIndexPresentation';
import { useNotesIndexController } from './useNotesIndexController';
import { useNotesIndexAppearance } from './notesIndexAppearanceModel';
import { notesIndexAppearanceProps } from './NotesIndexAppearance';
import styles from './NotesIndexView.module.css';
import itemStyles from './NotesIndexItems.module.css';

export function NotesIndexView({ onOpenNote }: { path: PathSegment[]; onOpenNote?(id: string): void }) {
  const c = useNotesIndexController(onOpenNote);
  const appearance = useNotesIndexAppearance();
  const theme = notesIndexAppearanceProps(appearance);
  const compact = useCompactLayout();
  if (!c.indexPath.length) return null;
  const filtered = Boolean(c.notesIndex.query || c.filters.statuses.length || c.filters.updatedWithin || c.urlTagIds.length || c.typeFilter !== 'all');
  const itemProps = {
    selectedNoteId: c.navigation.selectedNoteId,
    onSelectFolder: (id: string) => { const item = c.allItems.find(value => value.kind === 'folder' && value.folder.id === id); if (item) c.selectItem(item); },
    onSelectNote: (id: string) => { const item = c.allItems.find(value => value.kind === 'note' && value.note.id === id); if (item) c.selectItem(item); },
    isRecycleView: c.isRecycleView, recyclePendingId: c.recyclePendingId,
    onRestore: c.handleRestore, onRequestPermanentDelete: c.setPermanentDeleteTarget,
    selectionMode: c.selectionMode, onToggleSelection: c.toggleNoteSelection,
    canWrite: c.canWrite, onItemAction: c.treeOperations.handleTreeAction,
    tags: c.serverData.tags, properties: c.properties, iconSize: c.iconSize
  };
  return <ScopedAppearanceProvider value={theme}><WorkspacePanel {...theme} className={`${theme.className} ${styles.panel}`} aria-label="笔记索引">
    <NotesIndexHeader path={c.indexPath} count={c.data.counts.all} canWrite={c.canWrite} isRecycleView={c.isRecycleView}
      onOpenSpaces={() => c.navigate('/materials/spaces')} selectionMode={c.selectionMode}
      onToggleSelection={() => { c.setSelectionMode(value => !value); c.setSelectedNoteIds(new Set()); }}
      onImport={() => c.setImportOpen(true)} onCreate={mode => c.treeOperations.openCreate(mode, c.navigation.selectedFolderId)}
      renderTools={slots => compact ? <NotesIndexCompactTools c={c} {...slots} /> : <NotesIndexDesktopTools c={c} {...slots} />} />
    <NotesIndexFilterChips c={c} />
    <NotesIndexFilterMenu c={c} />
    {c.isRecycleView ? <p className={styles.capabilityNotice}>{c.supportsPermanentDelete ? '回收站里的笔记不会出现在其他位置，可以恢复或在确认后永久删除。' : LOCAL_PERMANENT_DELETE_REASON}</p> : null}
    {c.data.remoteLoading ? <div className={styles.loadState} role="status">正在从服务端加载筛选结果…</div> : null}
    {c.data.remoteError ? <div className={styles.loadError} role="alert"><span>{c.data.remoteError}，已显示本地缓存结果。</span><Button variant="ghost" size="compact" onPress={c.refresh}>重新加载</Button></div> : null}
    {c.batchError && !c.batchDeleteOpen && !c.batchTagOpen ? <div className={styles.loadError} role="alert">{c.batchError}<Button size="mini" variant="ghost" onPress={() => c.setBatchError('')}>关闭</Button></div> : null}
    <div className={styles.indexWrap}><div className={styles.indexMain}>
      <WorkspacePanelBody ref={c.contentRef} className={styles.content} data-testid="notes-index-scroll" data-entry-scroll
        data-drop-active={c.backgroundDrop.isOver || undefined} aria-label="索引内容" tabIndex={0}
        onDragOver={event => {
          if ((event.target as Element).closest('[data-entry-item], table')) { c.backgroundDrop.clear(); if (c.entryDragDrop?.isInternal(event)) scrollEntryContainer(event); }
          else { c.backgroundDrop.onDragOver(event); if (!event.defaultPrevented && c.entryDragDrop?.isInternal(event)) scrollEntryContainer(event); }
        }} onDragLeave={c.backgroundDrop.onDragLeave}
        onDrop={event => { if (!(event.target as Element).closest('[data-entry-item], table')) c.backgroundDrop.onDrop(event); }}
        onContextMenu={event => { if (event.defaultPrevented || c.isRecycleView) return; event.preventDefault(); c.setBackgroundMenu({ x: event.clientX, y: event.clientY }); }}
        onKeyDownCapture={c.handleEntryKeys} onKeyUpCapture={c.swallowEntrySpace}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || c.isRecycleView) return;
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); c.setBackgroundMenu({ x: rect.left + 16, y: rect.top + 16 }); }
        }}>
        {!c.allItems.length ? <div className={styles.empty} role="status">
          {filtered ? <><EmptyArt variant="search" /><strong>没有符合当前条件的结果</strong><p>试试换个关键词，或者清除筛选条件。</p>
            <Button variant="ghost" onPress={() => { c.clearFilters(); c.setTypeFilter('all'); if (c.notesIndex.query) c.store.setNotesQuery(''); }}>清除搜索与筛选</Button></>
            : <><EmptyArt variant="note" /><strong>{c.isRecycleView ? '回收站是空的' : '这里还没有内容'}</strong>
              <p>{c.isRecycleView ? '删除的笔记会先放在这里。' : '新建一篇笔记或文件夹，也可以从 Markdown 导入。'}</p>
              {c.canWrite && !c.isRecycleView ? <Button variant="primary" onPress={() => c.treeOperations.openCreate('note', c.navigation.selectedFolderId)}><PlusIcon size={16} />新建笔记</Button> : null}</>}
        </div>
          : c.groups.map(section => <section key={section.id} aria-label={section.label}>
            {c.group !== 'none' ? <PressableButton type="button" className={styles.groupHeading} aria-expanded={!c.collapsed.has(section.id)}
              onPress={() => c.setCollapsed(current => { const next = new Set(current); if (next.has(section.id)) next.delete(section.id); else next.add(section.id); return next; })}>
              <ChevronDownIcon size={13} /><strong>{section.label}</strong><span>{section.total ?? section.items.length}</span>
              <small>{section.detail}</small>
            </PressableButton> : null}
            {!c.collapsed.has(section.id) ? c.view === 'list'
              ? <NotesTable {...itemProps} items={section.items} foldersById={c.serverData.foldersById} selectedNoteIds={c.selectedNoteIds} />
              : <div className={c.view === 'card' ? itemStyles.cardGrid : itemStyles.grid} data-view={c.view} aria-label={c.view === 'card' ? '笔记卡片视图' : '笔记图标视图'}>
                {section.items.map(item => <IndexTile {...itemProps} key={itemKey(item)} item={item} view={c.view === 'card' ? 'card' : 'grid'} notes={c.serverData.notes}
                  selected={item.kind === 'note' && c.selectedNoteIds.has(item.note.id)} />)}
              </div> : null}
          </section>)}
      </WorkspacePanelBody>
      {c.selectionMode ? <div className={styles.bulkBar} role="toolbar" aria-label="批量管理笔记">
        <Checkbox isSelected={c.allPageNotesSelected} isIndeterminate={c.selectedNoteIds.size > 0 && !c.allPageNotesSelected}
          onChange={selected => c.setSelectedNoteIds(selected ? new Set(c.selectableNoteIds) : new Set())}>选择本页</Checkbox>
        <strong role="status" aria-live="polite">已选 {c.selectedNoteIds.size} 篇</strong>
        <Button size="workspace" isDisabled={!c.selectedNoteIds.size || c.batchPending} onPress={() => { c.setBatchError(''); c.setBatchTagOpen(true); }}>编辑标签</Button>
        <Button size="workspace" variant="danger" isDisabled={!c.selectedNoteIds.size || c.batchPending} onPress={() => { c.setBatchError(''); c.setBatchDeleteOpen(true); }}>移入回收站</Button>
        <Button size="workspace" variant="ghost" onPress={() => { c.setSelectionMode(false); c.setSelectedNoteIds(new Set()); }}>退出</Button>
      </div> : null}
      <NotesIndexPagination page={c.currentPage} pageCount={c.pageCount} total={c.allItems.length}
        noteTotal={c.allItems.filter(item => item.kind === 'note').length} folderTotal={c.allItems.filter(item => item.kind === 'folder').length} pageSize={c.pageSize}
        loading={c.data.remoteLoading} hasMore={c.typeFilter !== 'folder' && Boolean(c.data.remotePage?.hasNext)} onLoadMore={() => void c.data.loadMore()}
        onPageChange={c.setPage} onPageSizeChange={c.setPageSize} />
    </div>{c.peekOpen ? <NotesIndexPreview c={c} /> : null}</div>
    <NotesIndexDialogs c={c} />
  </WorkspacePanel></ScopedAppearanceProvider>;
}
