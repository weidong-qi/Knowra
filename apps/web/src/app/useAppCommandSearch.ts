import { useMemo, useRef } from 'react';
import { useAppStore, useAppStoreApi } from '../store/AppStoreProvider';
import type { SearchCommandProps, SearchHit } from '../shell/SearchCommand';
import { canNavigate } from './navigationGuard';

/** 应用搜索适配：组装命中项，并在完整详情与当前快照核验后提交导航。 */
export function useAppCommandSearch({ pathname, onSelect }: {
  pathname: string;
  onSelect(announcement: string, path: string): void;
}): Pick<SearchCommandProps, 'hits' | 'commandSearch'> {
  const storeApi = useAppStoreApi();
  const currentSpaceId = useAppStore(state => state.serverData.currentSpaceId);
  const searchCommandNotes = useAppStore(state => state.searchCommandNotes);
  const commandSpaces = useAppStore(state => state.serverData.spaces);
  const commandGeneration = useAppStore(state => state.knowledgeGeneration);
  const dataMode = useAppStore(state => state.dataMode);
  const workspaceLoadState = useAppStore(state => state.workspaceLoadState);
  const commandScopeKey = useMemo(() => ({}), [currentSpaceId, commandSpaces, commandGeneration, dataMode, workspaceLoadState]);
  const commandPathRef = useRef(pathname);
  commandPathRef.current = pathname;
  const hits = useSearchHits({ onSelect });
  const commandSearch: SearchCommandProps['commandSearch'] = searchCommandNotes ? {
    spaceId: currentSpaceId,
    search: searchCommandNotes,
    scopeKey: commandScopeKey,
    onSelect: async (hit, context) => {
      const before = storeApi.getState();
      const originPath = pathname;
      const isCurrent = () => context.isCurrent() && commandPathRef.current === originPath
        && storeApi.getState().navigation === before.navigation;
      if (!currentSpaceId || before.serverData.currentSpaceId !== currentSpaceId || !isCurrent()) return false;
      if (!canNavigate()) throw new Error('请先保存或放弃当前更改，再打开笔记。');
      const loaded = await before.loadCommandNote({ noteId: hit.id, spaceId: currentSpaceId, isCurrent });
      if (!loaded || !isCurrent()) return false;
      const state = storeApi.getState();
      if (state.serverData !== loaded.snapshot || state.serverData.currentSpaceId !== currentSpaceId
        || state.dataMode !== before.dataMode || state.workspaceLoadState !== before.workspaceLoadState
        || state.knowledgeGeneration !== before.knowledgeGeneration) return false;
      const note = loaded.note;
      if (note.id !== hit.id || note.spaceId !== currentSpaceId || note.deleted || !state.serverData.notes.includes(note)) {
        throw new Error('笔记已变化，请重新搜索。');
      }
      if (!canNavigate()) throw new Error('请先保存或放弃当前更改，再打开笔记。');
      state.setActiveWorkDomain('materials');
      state.selectNotesFolder(note.folderId);
      state.selectNote(note.id);
      onSelect(`已打开笔记“${note.title || '无标题'}”`, `/materials/notes/${encodeURIComponent(note.id)}`);
      return true;
    }
  } : undefined;
  return { hits, commandSearch };
}

function useSearchHits({
  onSelect
}: {
  /** 由每个命中项决定目标路径与宣告文案；调用方负责 navigate + setLiveAnnouncement。 */
  onSelect(announcement: string, path: string): void;
}): SearchHit[] {
  const notes = useAppStore((s) => s.serverData.notes);
  const tags = useAppStore((s) => s.serverData.tags);
  const spaceId = useAppStore((s) => s.serverData.currentSpaceId);
  const selectNote = useAppStore((s) => s.selectNote);
  const setActiveWorkDomain = useAppStore((s) => s.setActiveWorkDomain);
  const selectNotesFolder = useAppStore((s) => s.selectNotesFolder);
  const selectNotesTag = useAppStore((s) => s.selectNotesTag);

  return useMemo(() => {
    const hits: SearchHit[] = [];
    hits.push({
      id: 'action:home',
      primary: '返回主页',
      secondary: '回到早安页',
      hint: '跳转',
      group: '动作',
      onSelect: () => {
        // 主页（/）由左上角 Logo 与全局快捷键 ⌘/ 触达；
        // 这里保留 SearchCommand 里的"动作"入口，文案与跳转路径必须和 logo 一致。
        onSelect('已返回主页', '/');
      }
    });
    for (const note of notes) {
      if (note.deleted || note.spaceId !== spaceId) continue;
      hits.push({
        id: `note:${note.id}`,
        primary: note.title || '（无标题）',
        secondary: note.folderId ? `目录 ${note.folderId}` : '未分类',
        hint: '资料',
        group: '资料',
        onSelect: () => {
          setActiveWorkDomain('materials');
          selectNotesFolder(note.folderId);
          selectNote(note.id);
          onSelect(
            `已打开笔记“${note.title || '无标题'}”`,
            `/materials/notes/${encodeURIComponent(note.id)}`
          );
        }
      });
    }
    for (const tag of tags) {
      if (!tag.name || tag.spaceId !== spaceId) continue;
      hits.push({
        id: `tag:${tag.id}`,
        primary: `#${tag.name}`,
        secondary: '按标签筛选',
        hint: '标签',
        group: '标签',
        onSelect: () => {
          setActiveWorkDomain('materials');
          selectNotesTag(tag.id);
          onSelect(`已按标签“${tag.name}”筛选笔记`, '/materials');
        }
      });
    }
    return hits;
  }, [notes, tags, spaceId, selectNote, setActiveWorkDomain, selectNotesFolder, selectNotesTag, onSelect]);
}
