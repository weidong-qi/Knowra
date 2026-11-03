import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NoteQueryPage } from '@study-accelerator/web-core';
import { useAppStore } from '../../store/AppStoreProvider';
import { filterNotes, folderMatchesQuery } from './notesIndexModel';
import { sortNotes, compareFolderItems, type SortMode, type TypeFilter, type IndexItem } from './notesIndexPresentation';
const NOTE_PAGE_SIZE = 30;

export function useNotesIndexData({ sort, typeFilter, queryString, urlTagIds, tagMatch, remoteRevision }: {
  sort: SortMode; typeFilter: TypeFilter; queryString: string; urlTagIds: string[]; tagMatch: 'all' | 'any'; remoteRevision: number;
}) {
  const serverData = useAppStore(state => state.serverData);
  const navigation = useAppStore(state => state.navigation);
  const notesIndex = useAppStore(state => state.notesIndex);
  const queryNotes = useAppStore(state => state.queryNotes);
  const dataMode = useAppStore(state => state.dataMode);
  const knowledgeGeneration = useAppStore(state => state.knowledgeGeneration);
  const useServerQuery = dataMode === 'api' && !['root', 'unfiled'].includes(notesIndex.scope);
  const [remotePage, setRemotePage] = useState<NoteQueryPage | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState('');
  const requestGenerationRef = useRef(0);
  const loadingRef = useRef(false);
  const remoteQuery = useMemo(() => ({
    query: notesIndex.query,
    folderId: navigation.selectedFolderId ?? undefined,
    tagIds: urlTagIds.length ? urlTagIds : notesIndex.selectedTagId ? [notesIndex.selectedTagId] : undefined,
    tagMatch,
    favoriteOnly: notesIndex.scope === 'favorites',
    deletedOnly: notesIndex.scope === 'trash',
    includeDeleted: notesIndex.scope === 'trash',
    sortBy: sort === 'name-asc' || sort === 'name-desc' ? 'title' as const : 'updatedAt' as const,
    order: sort === 'updated-asc' || sort === 'name-asc' ? 'asc' as const : 'desc' as const,
    limit: notesIndex.scope === 'recent' ? 6 : NOTE_PAGE_SIZE
  }), [navigation.selectedFolderId, notesIndex.query, notesIndex.scope, notesIndex.selectedTagId, sort, tagMatch, urlTagIds]);

  useEffect(() => {
    let active = true;
    const generation = ++requestGenerationRef.current;
    if (!useServerQuery) {
      loadingRef.current = false;
      setRemotePage(null);
      setRemoteLoading(false);
      setRemoteError('');
      return () => { active = false; };
    }
    setRemotePage(null);
    loadingRef.current = true;
    setRemoteLoading(true);
    setRemoteError('');
    void queryNotes({ ...remoteQuery, offset: 0 }).then((result) => {
      if (active && requestGenerationRef.current === generation) setRemotePage(result);
    }).catch((error) => {
      if (active && requestGenerationRef.current === generation) {
        setRemotePage(null);
        setRemoteError(error instanceof Error ? error.message : '服务端筛选失败');
      }
    }).finally(() => {
      if (active && requestGenerationRef.current === generation) {
        loadingRef.current = false;
        setRemoteLoading(false);
      }
    });
    return () => { active = false; };
  }, [knowledgeGeneration, queryNotes, queryString, remoteQuery, remoteRevision, useServerQuery]);

  const loadMore = useCallback(async () => {
    if (!useServerQuery || !remotePage?.hasNext || loadingRef.current) return;
    const generation = requestGenerationRef.current;
    loadingRef.current = true;
    setRemoteLoading(true);
    setRemoteError('');
    try {
      const result = await queryNotes({ ...remoteQuery, offset: remotePage.items.length });
      if (requestGenerationRef.current !== generation) return;
      setRemotePage((current) => current ? {
        items: [...current.items, ...result.items],
        hasNext: result.hasNext
      } : result);
    } catch (error) {
      if (requestGenerationRef.current === generation) {
        setRemoteError(error instanceof Error ? error.message : '服务端筛选失败');
      }
    } finally {
      if (requestGenerationRef.current === generation) {
        loadingRef.current = false;
        setRemoteLoading(false);
      }
    }
  }, [queryNotes, remotePage, remoteQuery, useServerQuery]);

  const allItems = useMemo(() => {
    const noteSource = useServerQuery && remotePage ? remotePage.items : serverData.notes;
    const filterState = useServerQuery && remotePage
      ? { ...notesIndex, query: '', matchingNoteIds: null }
      : notesIndex;
    let visibleNotes = filterNotes(noteSource, serverData.tags, {
      notesIndex: filterState,
      selectedFolderId: navigation.selectedFolderId
    });
    if (!(useServerQuery && remotePage) && urlTagIds.length) {
      visibleNotes = visibleNotes.filter((note) => tagMatch === 'all'
        ? urlTagIds.every((id) => note.tagIds.includes(id))
        : urlTagIds.some((id) => note.tagIds.includes(id)));
    }
    const selectedFolder = navigation.selectedFolderId
      ? serverData.foldersById[navigation.selectedFolderId]
      : null;
    const visibleFolders = (notesIndex.scope === 'all' || notesIndex.scope === 'root') && !notesIndex.selectedTagId && urlTagIds.length === 0
      ? (selectedFolder?.children ?? serverData.folderTree)
        .filter((folder) => folderMatchesQuery(folder, serverData.notes, notesIndex.query))
      : [];
    const folderItems: IndexItem[] = visibleFolders.map((folder) => ({ kind: 'folder', folder }));
    const noteItems: IndexItem[] = sortNotes(visibleNotes, sort).map((note) => ({ kind: 'note', note }));
    return [...folderItems.sort(compareFolderItems), ...noteItems];
  }, [navigation.selectedFolderId, notesIndex, remotePage, serverData, sort, tagMatch, urlTagIds, useServerQuery]);

  const counts = { all: allItems.length, folder: allItems.filter(item => item.kind === 'folder').length, note: allItems.filter(item => item.kind === 'note').length };
  const items = allItems.filter(item => typeFilter === 'all' || item.kind === typeFilter);
  return { items, counts, remotePage, remoteLoading, remoteError, loadMore, setRemotePage };
}
