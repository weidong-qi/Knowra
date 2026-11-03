import { useEffect, useMemo, useRef, useState } from 'react';
import type { Note } from '@study-accelerator/web-core';
import { useAppStore } from '../../store/AppStoreProvider';
import { useLocation, useNavigate } from '../../app/router';
import { workspaceCapabilities } from '../../store/workspaceCapabilities';
import { buildIndexPath, indexRoute } from './notesIndexNavigation';
import { useNotesIndexData } from './useNotesIndexData';
import { useSidebarTreeOperations } from './useSidebarTreeOperations';
import { useEntryDragDrop, useEntryDropTarget } from './EntryDragDrop';
import { DEFAULT_DISPLAY_PROPERTIES, type ViewMode, type TypeFilter, type SortMode, type GroupMode, type IndexItem } from './notesIndexPresentation';
import { filterIndexItems, type FilterLevel, type IndexFilters } from './notesIndexFilters';
import { groupIndexItems, paginateIndexGroups } from './notesIndexGroups';
import { useNotesIndexKeyboard } from './useNotesIndexKeyboard';

/** 数据、路由与异步操作保持原有 store 所有权；这里仅编排索引局部状态。 */
export function useNotesIndexController(onOpenNote?: (id: string) => void) {
  const store = useAppStore(state => state);
  const { serverData, notesIndex, navigation } = store;
  const canWrite = store.canWriteWorkspace();
  const supportsPermanentDelete = workspaceCapabilities(store.persistenceMode).permanentDelete;
  const navigate = useNavigate();
  const location = useLocation();
  const queryString = location.pathname.split('?')[1] ?? '';
  const urlTagIds = useMemo(() => (new URLSearchParams(queryString).get('tags') ?? '').split(',')
    .filter(id => serverData.tags.some(tag => tag.id === id)), [queryString, serverData.tags]);
  const tagMatch: 'all' | 'any' = new URLSearchParams(queryString).get('match') === 'any' ? 'any' : 'all';
  const isRecycleView = notesIndex.scope === 'trash';
  const [view, setView] = useState<ViewMode>('grid');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sort, setSort] = useState<SortMode>('updated-desc');
  const [group, setGroup] = useState<GroupMode>('updated');
  const [properties, setProperties] = useState({ ...DEFAULT_DISPLAY_PROPERTIES });
  const [iconSize, setIconSize] = useState<'s' | 'm' | 'l'>('m');
  const [filters, setFilters] = useState<IndexFilters>({ statuses: [], updatedWithin: null });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [peekOpen, setPeekOpen] = useState(false);
  const [peekKey, setPeekKey] = useState<string | null>(null);
  const [filterMenu, setFilterMenu] = useState<{ level: FilterLevel } | null>(null);
  const filterAnchorRef = useRef<Element | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchTagOpen, setBatchTagOpen] = useState(false);
  const [batchPending, setBatchPending] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [recyclePendingId, setRecyclePendingId] = useState<string | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<Note | null>(null);
  const [backgroundMenu, setBackgroundMenu] = useState<{ x: number; y: number } | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [remoteRevision, setRemoteRevision] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const data = useNotesIndexData({ sort, typeFilter, queryString, urlTagIds, tagMatch, remoteRevision });
  const refresh = () => { data.setRemotePage(null); setRemoteRevision(value => value + 1); };
  const treeOperations = useSidebarTreeOperations(refresh);
  const entryDragDrop = useEntryDragDrop();
  const backgroundDrop = useEntryDropTarget(!isRecycleView && !selectionMode
    ? navigation.selectedFolderId ?? (notesIndex.scope === 'root' ? null : undefined) : undefined);
  const openNote = onOpenNote ?? store.selectNote;
  function openIndexRoute(to: string) {
    const params = new URLSearchParams(to.split('?')[1]);
    const folder = params.get('folder');
    if (folder) store.selectNotesFolder(folder);
    else store.selectNotesScope(params.get('scope') === 'root' ? 'root' : 'all');
    navigate(to);
  }
  const indexPath = buildIndexPath(notesIndex.scope, navigation.selectedFolderId, serverData.foldersById, openIndexRoute);
  const allItems = useMemo(() => filterIndexItems(data.items, filters, Date.now()), [data.items, filters]);
  const groupedItems = groupIndexItems(allItems, { group, foldersById: serverData.foldersById, now: Date.now() });
  const { pageCount, currentPage, items, groups } = paginateIndexGroups(groupedItems, { page, pageSize, collapsed });
  const peekItem = allItems.find(item => `${item.kind}:${item.kind === 'note' ? item.note.id : item.folder.id}` === peekKey) ?? null;
  const selectableNoteIds = items.flatMap(item => item.kind === 'note' && !item.note.deleted ? [item.note.id] : []);
  const allPageNotesSelected = selectableNoteIds.length > 0 && selectableNoteIds.every(id => selectedNoteIds.has(id));

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const editing = target?.closest('input, textarea, [contenteditable="true"], [role="dialog"]');
      if (!editing && event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);
  useEffect(() => { if (page !== currentPage) setPage(currentPage); }, [page, currentPage]);
  useEffect(() => { contentRef.current?.scrollTo?.({ top: 0 }); }, [navigation.selectedFolderId, notesIndex.scope, page, view, typeFilter]);
  useEffect(() => {
    setPage(0); setSelectedNoteIds(new Set()); setPeekKey(null); setCollapsed(new Set());
  }, [navigation.selectedFolderId, serverData.currentSpaceId, notesIndex.query, notesIndex.scope, notesIndex.selectedTagId, sort, queryString, typeFilter, pageSize, filters]);
  useEffect(() => {
    if (!canWrite || isRecycleView) { setSelectionMode(false); setSelectedNoteIds(new Set()); }
  }, [canWrite, isRecycleView]);

  function selectFolder(id: string) { openIndexRoute(indexRoute('all', id)); }
  function selectItem(item: IndexItem) {
    if (peekOpen) setPeekKey(`${item.kind}:${item.kind === 'note' ? item.note.id : item.folder.id}`);
    else if (item.kind === 'folder') selectFolder(item.folder.id);
    else openNote(item.note.id);
  }
  function toggleNoteSelection(id: string, selected: boolean) {
    if (!canWrite || isRecycleView) return;
    setSelectionMode(true);
    setSelectedNoteIds(current => { const next = new Set(current); if (selected) next.add(id); else next.delete(id); return next; });
  }
  const { handleEntryKeys, swallowEntrySpace } = useNotesIndexKeyboard({
    contentRef, peekKey, peekOpen, setPeekOpen, setPeekKey, allItems, canWrite, isRecycleView,
    selectedNoteIds, toggleNoteSelection, selectFolder, openNote
  });
  async function runBatch(action: () => Promise<void>) {
    if (!canWrite || batchPending) return false;
    setBatchPending(true); setBatchError('');
    try { await action(); setSelectedNoteIds(new Set()); setSelectionMode(false); refresh(); return true; }
    catch (error) { setBatchError(error instanceof Error ? error.message : '批量操作失败，请重试'); return false; }
    finally { setBatchPending(false); }
  }
  async function handleRestore(note: Note) {
    if (!canWrite || recyclePendingId) return;
    setRecyclePendingId(note.id); setBatchError('');
    try { await store.restoreNote(note.id); refresh(); }
    catch (error) { setBatchError(error instanceof Error ? error.message : '恢复失败，请重试'); }
    finally { setRecyclePendingId(null); }
  }
  function changeTags(ids: string[], match = tagMatch) {
    const params = new URLSearchParams(queryString);
    if (ids.length) params.set('tags', ids.join(',')); else params.delete('tags');
    params.set('match', match); navigate(`/materials?${params}`);
  }
  function openFilterMenu(anchor: Element | null, level: FilterLevel = 'root') {
    filterAnchorRef.current = anchor; setFilterMenu({ level });
  }
  function clearFilters() { setFilters({ statuses: [], updatedWithin: null }); if (urlTagIds.length) changeTags([]); }
  return { store, serverData, notesIndex, navigation, canWrite, supportsPermanentDelete, navigate,
    queryString, urlTagIds, tagMatch, isRecycleView, view, setView, typeFilter, setTypeFilter, sort, setSort,
    group, setGroup, properties, setProperties, iconSize, setIconSize, filters, setFilters, collapsed, setCollapsed,
    peekOpen, setPeekOpen, peekItem, setPeekKey, filterMenu, setFilterMenu, filterAnchorRef, openFilterMenu, clearFilters, importOpen, setImportOpen,
    selectionMode, setSelectionMode, selectedNoteIds, setSelectedNoteIds, batchDeleteOpen, setBatchDeleteOpen,
    batchTagOpen, setBatchTagOpen, batchPending, batchError, setBatchError, recyclePendingId, setRecyclePendingId,
    permanentDeleteTarget, setPermanentDeleteTarget, backgroundMenu, setBackgroundMenu, pageSize, setPageSize,
    setPage, searchRef, contentRef, data, refresh, treeOperations, entryDragDrop, backgroundDrop, openNote,
    indexPath, allItems, items, groups, pageCount, currentPage, selectableNoteIds, allPageNotesSelected,
    selectFolder, selectItem, toggleNoteSelection, handleEntryKeys, swallowEntrySpace, runBatch, handleRestore, changeTags };
}
export type NotesIndexController = ReturnType<typeof useNotesIndexController>;
