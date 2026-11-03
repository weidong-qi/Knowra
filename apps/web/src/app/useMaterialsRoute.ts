import { useEffect } from 'react';
import { useAppStore, useAppStoreApi } from '../store/AppStoreProvider';
import { useLocation } from './router';
import { INDEX_SCOPE_LABELS } from '../features/notes/notesIndexNavigation';
import type { NotesIndexScope } from '../store/types';

/** URL 是浏览位置真源，不受缓存中的文件选择或编辑器后台 selection 影响。 */
export function useMaterialsRoute() {
  const { pathname } = useLocation();
  const store = useAppStoreApi();
  const dataMode = useAppStore(state => state.dataMode);
  const folders = useAppStore(state => state.serverData.foldersById);
  const selectedFolderId = useAppStore(state => state.navigation.selectedFolderId);
  const selectedScope = useAppStore(state => state.notesIndex.scope);
  useEffect(() => {
    if (pathname.split('?')[0] !== '/materials' || dataMode === 'loading') return;
    const params = new URLSearchParams(pathname.split('?')[1]);
    const requestedFolder = params.get('folder');
    const folderId = requestedFolder && folders[requestedFolder] ? requestedFolder : null;
    const requestedScope = params.get('scope') as NotesIndexScope | null;
    const scope = !folderId && requestedScope && Object.hasOwn(INDEX_SCOPE_LABELS, requestedScope) ? requestedScope : 'all';
    if (selectedFolderId === folderId && selectedScope === scope) return;
    const state = store.getState();
    if (folderId) state.selectNotesFolder(folderId);
    else state.selectNotesScope(scope);
  }, [pathname, dataMode, folders, selectedFolderId, selectedScope, store]);
}
