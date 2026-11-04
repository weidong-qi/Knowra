import {
  createBackendSnapshot,
  createEmptyWorkspaceSnapshot,
  guardWorkspaceWrite,
  type KeyValueStorage,
  type WorkspaceApi
} from '@study-accelerator/web-core';
import { createAppStore } from './createAppStore';

describe('single V4 application store', () => {
  for (const copyMode of ['duplicate', 'history'] as const) {
    it(`preserves private AI visibility when creating a ${copyMode} copy`, async () => {
      const api = createApi();
      vi.mocked(api.loadWorkspaceResources).mockResolvedValue({ folderTree: [], tags: [], notes: [{
        id: 'live-note', title: '私密原稿', folderId: null, tagIds: [], internalLinks: [],
        rawMarkdown: '合成私密正文', contentLoaded: true, favorite: false, deleted: false, aiVisibility: 'private'
      }] });
      vi.mocked(api.getNoteVersion).mockResolvedValue({ id: 'old-version', noteId: 'live-note', content: '合成私密历史正文',
        contentHash: 'a'.repeat(64), createdAt: '2026-09-01T00:00:00Z', createdBy: 'user' });
      const store = createAppStore({ api, cacheKey: `private-copy-${copyMode}`, mockSnapshot: createEmptyWorkspaceSnapshot() });
      await store.getState().loadWorkspace();
      if (copyMode === 'duplicate') await store.getState().duplicateNote('live-note');
      else await store.getState().saveNoteVersionAs('live-note', 'old-version');
      expect(api.createNote).toHaveBeenCalledWith(expect.objectContaining({ aiVisibility: 'private',
        rawMarkdown: copyMode === 'duplicate' ? '合成私密正文' : '合成私密历史正文' }));
      expect(api.updateNote).not.toHaveBeenCalled();
    });
  }
  it('changes AI visibility through ordinary update CAS, preserving workspace write guards', async () => {
    const api = createApi();
    const store = createAppStore({ api, cacheKey: 'note-ai-privacy', mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();
    await store.getState().setNoteAiVisibility('live-note', { aiVisibility: 'private', expectedUpdatedAt: 'version-1' });
    expect(api.updateNote).toHaveBeenCalledWith('live-note', { aiVisibility: 'private', expectedUpdatedAt: 'version-1' });
    store.setState({ dataMode: 'cache' });
    await expect(store.getState().setNoteAiVisibility('live-note', { aiVisibility: 'normal', expectedUpdatedAt: 'version-2' })).rejects.toThrow();
    expect(api.updateNote).toHaveBeenCalledTimes(1);
  });
  it('refreshes the knowledge generation only after safely applying local sync data', async () => {
    const store = createAppStore({ api: createApi(), cacheKey: 'knowledge-generation', persistenceMode: 'desktop-local', mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();
    store.getState().setEditorHasLocalChanges(true);
    await expect(store.getState().refreshLocalWorkspace()).resolves.toBe(false);
    expect(store.getState().knowledgeGeneration).toBe(0);
    store.getState().setEditorHasLocalChanges(false);
    await expect(store.getState().refreshLocalWorkspace()).resolves.toBe(true);
    expect(store.getState().knowledgeGeneration).toBe(1);
  });
  it('saves a historical body as a separate note without overwriting the current body', async () => {
    const api = createApi();
    vi.mocked(api.getNoteVersion).mockResolvedValue({ id: 'old-version', noteId: 'live-note', content: '历史正文', contentHash: 'a'.repeat(64), createdAt: '2026-09-01T00:00:00Z', createdBy: 'user' });
    const store = createAppStore({ api, cacheKey: 'version-copy', mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();
    await expect(store.getState().saveNoteVersionAs('live-note', 'old-version')).resolves.toBe('created-note');
    expect(api.createNote).toHaveBeenCalledWith(expect.objectContaining({ title: 'Live · 历史副本', rawMarkdown: '历史正文', spaceId: 'space-live', folderId: null, status: 'draft' }));
    expect(api.updateNote).not.toHaveBeenCalled();
    store.setState({ dataMode: 'cache' });
    await expect(store.getState().saveNoteVersionAs('live-note', 'old-version')).rejects.toThrow();
    expect(api.createNote).toHaveBeenCalledTimes(1);
  });

  it('rejects a historical copy belonging to another note', async () => {
    const api = createApi();
    vi.mocked(api.getNoteVersion).mockResolvedValue({ id: 'old-version', noteId: 'other-note', content: '其他正文', contentHash: 'a'.repeat(64), createdAt: '2026-09-01T00:00:00Z', createdBy: 'user' });
    const store = createAppStore({ api, cacheKey: 'version-copy-mismatch', mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();
    await expect(store.getState().saveNoteVersionAs('live-note', 'old-version')).rejects.toThrow('历史版本不属于当前笔记');
    expect(api.createNote).not.toHaveBeenCalled();
  });
  it('rejects unsupported desktop writes without sending requests or marking saved content as failed', async () => {
    const api = createApi();
    const store = createAppStore({ api, cacheKey: 'desktop-capabilities', persistenceMode: 'desktop-local', mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();
    await expect(store.getState().permanentlyDeleteNote('live-note')).rejects.toThrow('桌面端暂不支持彻底删除');
    await expect(store.getState().emptyRecycleBin()).rejects.toThrow('桌面端暂不支持彻底删除');
    vi.mocked(api.createAnalysisScope!).mockResolvedValue({ id: 'scope-1' });
    await expect(store.getState().createAnalysisScope({ spaceId: 'space-live', mode: 'all', previewHash: 'hash', idempotencyKey: 'key' })).resolves.toEqual({ id: 'scope-1' });
    expect(api.permanentlyDeleteNote).not.toHaveBeenCalled();
    expect(api.emptyRecycleBin).not.toHaveBeenCalled();
    expect(store.getState().saveState).toBe('saved');
  });
  it('exposes serializable save failure state', () => {
    const store = createAppStore({
      api: createApi(),
      cacheKey: 'workspace',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    store.getState().beginSave();
    expect(store.getState().saveState).toBe('saving');
    store.getState().failSave(new Error('写入被拒绝'));
    expect(store.getState().saveState).toBe('error');
    expect(store.getState().saveError).toBe('写入被拒绝');
    expect(store.getState().saveError).not.toBeInstanceOf(Error);
  });

  it('shows compatible cache first, then replaces it with normalized live data', async () => {
    const storage = createStorage();
    storage.setItem('workspace', JSON.stringify(createBackendSnapshot({
      spaces: [{ id: 'space-cache' }],
      currentSpaceId: 'space-cache',
      folderTree: [],
      tags: [],
      allNotes: [{
        id: 'cached-note', title: 'Cached', folderId: null, tagIds: [], internalLinks: [],
        rawMarkdown: '', contentLoaded: false, favorite: false, deleted: false
      }]
    })));
    const deferred = createDeferred<ReturnType<WorkspaceApi['listKnowledgeSpaces']> extends Promise<infer T> ? T : never>();
    const api = createApi();
    vi.mocked(api.listKnowledgeSpaces).mockReturnValue(deferred.promise);
    const store = createAppStore({ api, storage, cacheKey: 'workspace', mockSnapshot: createEmptyWorkspaceSnapshot() });

    const loading = store.getState().loadWorkspace();
    expect(store.getState().dataMode).toBe('cache');
    expect(store.getState().serverData.notes[0]?.id).toBe('cached-note');

    deferred.resolve([{ id: 'space-live' }]);
    await loading;
    expect(store.getState().dataMode).toBe('api');
    expect(store.getState().serverData.notes[0]?.id).toBe('live-note');
    expect(JSON.parse(storage.getItem('workspace') ?? '{}').currentSpaceId).toBe('space-live');
  });

  it('keeps live tag groups in cache after navigation and restores them offline', async () => {
    const storage = createStorage();
    const api = createApi();
    vi.mocked(api.loadWorkspaceResources).mockResolvedValue({
      folderTree: [],
      notes: [{
        id: 'live-note', title: 'Live', folderId: null, tagIds: [], internalLinks: [],
        rawMarkdown: '', contentLoaded: false, favorite: false, deleted: false
      }],
      tags: [],
      tagGroups: [{
        id: 'group-live', spaceId: 'space-live', code: 'ordinary', name: '普通标签',
        selectionMode: 'multiple', isSystem: true, sortOrder: 0
      }]
    });
    const onlineStore = createAppStore({ api, storage, cacheKey: 'workspace-tag-groups', mockSnapshot: createEmptyWorkspaceSnapshot() });
    await onlineStore.getState().loadWorkspace();

    onlineStore.getState().selectNote('live-note');
    expect(JSON.parse(storage.getItem('workspace-tag-groups') ?? '{}').tagGroups).toEqual([
      expect.objectContaining({ id: 'group-live', code: 'ordinary' })
    ]);

    const offlineApi = createApi();
    vi.mocked(offlineApi.listKnowledgeSpaces).mockRejectedValue(new Error('offline'));
    const offlineStore = createAppStore({
      api: offlineApi,
      storage,
      cacheKey: 'workspace-tag-groups',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });
    await offlineStore.getState().loadWorkspace();

    expect(offlineStore.getState().dataMode).toBe('cache');
    expect(offlineStore.getState().serverData.tagGroups).toEqual([
      expect.objectContaining({ id: 'group-live', code: 'ordinary' })
    ]);
    expect(offlineStore.getState().canWriteWorkspace()).toBe(false);
  });

  it('keeps cache read-only when live loading fails', async () => {
    const storage = createStorage();
    storage.setItem('workspace', JSON.stringify(createBackendSnapshot({
      folderTree: [], allNotes: [], spaces: [], tags: []
    })));
    const api = createApi();
    vi.mocked(api.listKnowledgeSpaces).mockRejectedValue(new Error('offline'));
    const store = createAppStore({ api, storage, cacheKey: 'workspace', mockSnapshot: createEmptyWorkspaceSnapshot() });

    await store.getState().loadWorkspace();
    expect(store.getState().dataMode).toBe('cache');
    expect(store.getState().workspaceError).toBe('offline');
    expect(store.getState().canWriteWorkspace()).toBe(false);
    const messages: string[] = [];
    expect(guardWorkspaceWrite({ dataMode: store.getState().dataMode, flashStatus: (value) => messages.push(value) })).toBe(false);
    expect(messages[0]).toContain('只读缓存');
  });

  it('keeps serializable state free of editor engines and DOM nodes', () => {
    const state = createAppStore({
      api: createApi(),
      cacheKey: 'workspace',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    }).getState();
    expect('editorEngine' in state).toBe(false);
    expect('element' in state).toBe(false);
    expect(() => JSON.stringify({
      serverData: state.serverData,
      navigation: state.navigation,
      dataMode: state.dataMode,
      workspaceLoadState: state.workspaceLoadState,
      workspaceError: state.workspaceError,
      statusMessage: state.statusMessage
    })).not.toThrow();
  });

  it('reuses the workspace API for sidebar create and recycle-bin actions', async () => {
    const api = createApi();
    vi.mocked(api.createNote).mockResolvedValue({
      id: 'created-note', title: '新笔记', folderId: null, tagIds: [], internalLinks: [],
      rawMarkdown: '', contentLoaded: true, favorite: false, deleted: false
    });
    vi.mocked(api.createFolder).mockResolvedValue({
      id: 'created-folder', name: '新文件夹', parentId: null, children: []
    });
    vi.mocked(api.emptyRecycleBin).mockResolvedValue({ deletedCount: 2 });
    const store = createAppStore({
      api,
      cacheKey: 'workspace',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });
    await store.getState().loadWorkspace();

    await expect(store.getState().createNote(null, '新笔记')).resolves.toBe('created-note');
    expect(api.createNote).toHaveBeenCalledWith(expect.objectContaining({
      title: '新笔记',
      folderId: null,
      spaceId: 'space-live',
      sourceType: 'manual'
    }));

    await expect(store.getState().createFolder(null, '新文件夹')).resolves.toBe('created-folder');
    expect(api.createFolder).toHaveBeenCalledWith({
      name: '新文件夹',
      parentId: null,
      spaceId: 'space-live'
    });

    await expect(store.getState().emptyRecycleBin()).resolves.toBe(2);
    expect(api.emptyRecycleBin).toHaveBeenCalledWith('space-live');
  });

  it('reuses legacy mutations for folder and note context-menu actions', async () => {
    const api = createApi();
    const store = createAppStore({
      api,
      cacheKey: 'workspace-context-actions',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });
    await store.getState().loadWorkspace();

    await store.getState().renameFolder('folder-1', '资料归档');
    expect(api.updateFolder).toHaveBeenCalledWith('folder-1', {
      name: '资料归档',
      parentId: null
    });

    await store.getState().renameNote('live-note', '重命名笔记');
    expect(api.updateNote).toHaveBeenCalledWith('live-note', { title: '重命名笔记' });

    await store.getState().setNoteFavorite('live-note', true);
    expect(api.setNoteFavorite).toHaveBeenCalledWith('live-note', true);

    store.getState().selectNote('live-note');
    await store.getState().deleteNote('live-note');
    expect(api.deleteNote).toHaveBeenCalledWith('live-note');
    expect(store.getState().notesIndex.scope).toBe('trash');

    await store.getState().deleteFolder('folder-1', { mode: 'keep', destinationId: null });
    expect(api.deleteFolder).toHaveBeenCalledWith('folder-1', { mode: 'keep', destinationId: null });
  });

  it('connects single-note recycle actions, tag editing and version reads', async () => {
    const api = createApi();
    const version = {
      id: 'version-1', noteId: 'live-note', content: '# 第一版', contentHash: 'a'.repeat(64),
      createdAt: '2026-09-01T09:00:00.000Z', createdBy: 'user'
    };
    vi.mocked(api.listNoteVersions).mockResolvedValue([version]);
    vi.mocked(api.getNoteVersion).mockResolvedValue(version);
    const store = createAppStore({
      api,
      cacheKey: 'workspace-p0-note-actions',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });
    await store.getState().loadWorkspace();

    await store.getState().restoreNote('live-note');
    expect(api.restoreNote).toHaveBeenCalledWith('live-note');
    expect(store.getState().notesIndex.scope).toBe('trash');

    await store.getState().permanentlyDeleteNote('live-note');
    expect(api.permanentlyDeleteNote).toHaveBeenCalledWith('live-note');

    await store.getState().setNoteTags('live-note', ['tag-1', 'tag-2']);
    expect(api.setNoteTags).toHaveBeenCalledWith('live-note', ['tag-1', 'tag-2']);

    await expect(store.getState().listNoteVersions('live-note')).resolves.toEqual([version]);
    await expect(store.getState().getNoteVersion('live-note', 'version-1')).resolves.toEqual(version);
  });

  it('connects note organization and attachment mutations', async () => {
    const api = createApi();
    const attachment = {
      id: 'attachment-1', noteId: 'live-note', fileName: 'diagram.png',
      mimeType: 'image/png', size: 128, status: 'ready'
    };
    vi.mocked(api.listNoteAttachments).mockResolvedValue([attachment]);
    vi.mocked(api.uploadNoteAttachment).mockResolvedValue(attachment);
    vi.mocked(api.renameNoteAttachment).mockResolvedValue({ ...attachment, fileName: 'renamed.png' });
    vi.mocked(api.deleteNoteAttachment).mockResolvedValue({ ...attachment, cleanup: 'complete' });
    const store = createAppStore({
      api,
      cacheKey: 'workspace-p1-note-actions',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });
    await store.getState().loadWorkspace();

    await store.getState().organizeNote('live-note', { folderId: 'folder-1', status: 'active' });
    expect(api.updateNote).toHaveBeenCalledWith('live-note', { folderId: 'folder-1', status: 'active' });
    await expect(store.getState().listNoteAttachments('live-note')).resolves.toEqual([attachment]);

    const input = { noteId: 'live-note', fileName: 'diagram.png', mimeType: 'image/png', contentBase64: 'aW1hZ2U=' };
    await expect(store.getState().uploadNoteAttachment(input)).resolves.toEqual(attachment);
    expect(api.uploadNoteAttachment).toHaveBeenCalledWith(input);
    await expect(store.getState().renameNoteAttachment('attachment-1', 'renamed.png')).resolves.toMatchObject({ fileName: 'renamed.png' });
    await store.getState().deleteNoteAttachment('attachment-1');
    expect(api.deleteNoteAttachment).toHaveBeenCalledWith('attachment-1');
  });

  it('connects P2 batch, server-query, linked-note and annotation operations', async () => {
    const api = createApi();
    const annotation = {
      id: 'annotation-1', spaceId: 'space-live', noteId: 'live-note', noteVersionId: null,
      kind: 'important' as const, sourceMode: 'manual' as const, quoteText: '重要内容', headingPath: ['结论'],
      fromPosition: 1, toPosition: 5, prefixText: '', suffixText: '', anchorFingerprint: 'fingerprint',
      noteContentHash: 'hash', idempotencyKey: 'request-1', status: 'active'
    };
    vi.mocked(api.queryNotes).mockResolvedValue({ items: [], hasNext: true });
    vi.mocked(api.getLinkedNotes).mockResolvedValue([{ id: 'linked-note', title: 'Linked', folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '', contentLoaded: false, favorite: false, deleted: false }]);
    vi.mocked(api.listAnnotations).mockResolvedValue([annotation]);
    vi.mocked(api.createAnnotation).mockResolvedValue(annotation);
    vi.mocked(api.deleteAnnotation).mockResolvedValue({ ...annotation, status: 'archived' });
    vi.mocked(api.restoreAnnotation).mockResolvedValue(annotation);
    vi.mocked(api.updateAnnotationAnchor).mockResolvedValue({ ...annotation, fromPosition: 8, toPosition: 12 });
    const store = createAppStore({ api, cacheKey: 'workspace-p2-note-actions', mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();

    await store.getState().deleteNotes(['live-note']);
    expect(api.deleteNotes).toHaveBeenCalledWith(['live-note']);
    await store.getState().assignTagToNotes(['live-note'], 'tag-1');
    expect(api.assignTagToNotes).toHaveBeenCalledWith(['live-note'], 'tag-1');
    await expect(store.getState().queryNotes({ limit: 30 })).resolves.toEqual({ items: [], hasNext: true });
    expect(api.queryNotes).toHaveBeenCalledWith({ limit: 30, spaceId: 'space-live' });
    await expect(store.getState().getLinkedNotes('live-note')).resolves.toHaveLength(1);
    await expect(store.getState().listAnnotations('live-note')).resolves.toEqual([annotation]);
    expect(api.listAnnotations).toHaveBeenCalledWith('live-note', 'space-live');
    await expect(store.getState().createAnnotation(annotation)).resolves.toEqual(annotation);
    await store.getState().deleteAnnotation(annotation.id);
    await store.getState().restoreAnnotation(annotation.id);
    await store.getState().updateAnnotationAnchor(annotation.id, {
      quoteText: annotation.quoteText, headingPath: annotation.headingPath, fromPosition: 8, toPosition: 12,
      prefixText: '', suffixText: '', anchorFingerprint: 'next', noteContentHash: 'next-hash'
    });
    expect(api.updateAnnotationAnchor).toHaveBeenCalledWith(annotation.id, expect.objectContaining({ fromPosition: 8 }));
  });

  it('closes editor tabs with a deterministic adjacent fallback', async () => {
    const api = createApi();
    vi.mocked(api.loadWorkspaceResources).mockResolvedValue({
      folderTree: [],
      notes: [
        { id: 'note-a', title: 'A', folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '', contentLoaded: true, favorite: false, deleted: false },
        { id: 'note-b', title: 'B', folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '', contentLoaded: true, favorite: false, deleted: false },
        { id: 'note-c', title: 'C', folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '', contentLoaded: true, favorite: false, deleted: false }
      ],
      tags: [],
      tagGroups: []
    });
    const store = createAppStore({ api, cacheKey: 'workspace-tabs', mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();
    store.getState().selectNote('note-a');
    store.getState().selectNote('note-b');
    store.getState().selectNote('note-c');

    expect(store.getState().closeNoteTab('note-b')).toBe('note-c');
    expect(store.getState().navigation.openNoteTabs).toEqual(['note-a', 'note-c']);
    expect(store.getState().closeNoteTab('note-c')).toBe('note-a');
    expect(store.getState().navigation.selectedNoteId).toBe('note-a');
    expect(store.getState().closeNoteTab('note-a')).toBeNull();
  });

  it('loads note detail once and saves markdown through the existing note endpoint', async () => {
    const api = createApi();
    vi.mocked(api.getNote).mockResolvedValue({
      id: 'live-note', title: 'Live', folderId: null, tagIds: [], internalLinks: [],
      rawMarkdown: '# 正文', contentLoaded: true, favorite: false, deleted: false,
      updatedAt: '2026-08-31T01:00:00.000Z'
    });
    vi.mocked(api.updateNote).mockResolvedValue({
      id: 'live-note', title: 'Live', folderId: null, tagIds: [], internalLinks: [],
      rawMarkdown: '# 已编辑', contentLoaded: true, favorite: false, deleted: false,
      updatedAt: '2026-08-31T01:01:00.000Z'
    });
    const store = createAppStore({ api, cacheKey: 'workspace-editor', mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();

    await store.getState().loadNoteContent('live-note');
    await store.getState().loadNoteContent('live-note');
    expect(api.getNote).toHaveBeenCalledTimes(1);
    expect(store.getState().serverData.notes[0]?.rawMarkdown).toBe('# 正文');

    await store.getState().saveNoteContent('live-note', '# 已编辑');
    expect(api.updateNote).toHaveBeenCalledWith('live-note', {
      rawMarkdown: '# 已编辑',
      expectedUpdatedAt: '2026-08-31T01:00:00.000Z'
    });
    expect(store.getState().serverData.notes[0]?.rawMarkdown).toBe('# 已编辑');
  });

  it('skips a content PATCH when markdown is unchanged', async () => {
    const api = createApi();
    vi.mocked(api.loadWorkspaceResources).mockResolvedValue({
      folderTree: [],
      notes: [{
        id: 'live-note', title: 'Live', folderId: null, tagIds: [], internalLinks: [],
        rawMarkdown: '相同正文', contentLoaded: true, favorite: false, deleted: false,
        updatedAt: '2026-08-31T01:00:00.000Z'
      }],
      tags: []
    });
    const store = createAppStore({ api, cacheKey: 'workspace-noop-save', mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();

    await expect(store.getState().saveNoteContent('live-note', '相同正文')).resolves.toMatchObject({
      id: 'live-note',
      updatedAt: '2026-08-31T01:00:00.000Z'
    });
    expect(api.updateNote).not.toHaveBeenCalled();
  });

  it.each([false, true])('正文冲突仅在重新读取的正文未变时重试，changed=%s', async (changed) => {
    const api = createApi();
    const note = { id: 'live-note', title: 'Live', folderId: null, tagIds: [], internalLinks: [],
      rawMarkdown: '原文', contentLoaded: true, favorite: false, deleted: false,
      updatedAt: '2026-08-31T01:00:00.000Z' };
    vi.mocked(api.loadWorkspaceResources).mockResolvedValue({ folderTree: [], notes: [note], tags: [] });
    const conflict = Object.assign(new Error('版本冲突'), { code: 'NOTE_UPDATE_CONFLICT' });
    vi.mocked(api.updateNote).mockRejectedValueOnce(conflict).mockResolvedValue({ ...note, rawMarkdown: '草稿' });
    vi.mocked(api.getNote).mockResolvedValue({ ...note, rawMarkdown: changed ? '别人改了正文' : '原文', updatedAt: '2026-08-31T01:01:00.000Z' });
    const store = createAppStore({ api, cacheKey: 'retry-' + changed, mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();
    const save = store.getState().saveNoteContent('live-note', '草稿', note.updatedAt);
    if (changed) {
      await expect(save).rejects.toBe(conflict);
      expect(api.updateNote).toHaveBeenCalledTimes(1);
    } else {
      await expect(save).resolves.toMatchObject({ rawMarkdown: '草稿' });
      expect(api.updateNote).toHaveBeenLastCalledWith('live-note', { rawMarkdown: '草稿', expectedUpdatedAt: '2026-08-31T01:01:00.000Z' });
    }
  });

  it.each(['base', 'draft', 'other'])('用编辑器明确基线核对冲突，最新正文=%s', async (latestText) => {
    const api = createApi();
    const note = { id: 'live-note', title: 'Live', folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '刷新后的store正文', contentLoaded: true, favorite: false, deleted: false, updatedAt: 'v2' };
    vi.mocked(api.loadWorkspaceResources).mockResolvedValue({ folderTree: [], notes: [note], tags: [] });
    const conflict = Object.assign(new Error('冲突'), { code: 'NOTE_UPDATE_CONFLICT' });
    vi.mocked(api.updateNote).mockRejectedValueOnce(conflict).mockResolvedValue({ ...note, rawMarkdown: 'draft', updatedAt: 'v4' });
    vi.mocked(api.getNote).mockResolvedValue({ ...note, rawMarkdown: latestText, updatedAt: 'v3' });
    const store = createAppStore({ api, cacheKey: 'explicit-' + latestText, mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();
    const saved = store.getState().saveNoteContent('live-note', 'draft', 'v1', 'base');
    if (latestText === 'other') await expect(saved).rejects.toBe(conflict);
    else await expect(saved).resolves.toMatchObject({ rawMarkdown: 'draft' });
    expect(api.updateNote).toHaveBeenCalledTimes(latestText === 'base' ? 2 : 1);
  });

  it('serializes saves for the same note so an older response cannot overwrite newer text', async () => {
    const api = createApi();
    vi.mocked(api.loadWorkspaceResources).mockResolvedValue({
      folderTree: [],
      notes: [{
        id: 'live-note', title: 'Live', folderId: null, tagIds: [], internalLinks: [],
        rawMarkdown: '初始正文', contentLoaded: true, favorite: false, deleted: false,
        updatedAt: '2026-08-31T01:00:00.000Z'
      }],
      tags: []
    });
    const first = createDeferred<Awaited<ReturnType<WorkspaceApi['updateNote']>>>();
    const second = createDeferred<Awaited<ReturnType<WorkspaceApi['updateNote']>>>();
    vi.mocked(api.updateNote)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const store = createAppStore({ api, cacheKey: 'workspace-save-order', mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();

    const olderSave = store.getState().saveNoteContent('live-note', '较早正文');
    const newerSave = store.getState().saveNoteContent('live-note', '最新正文');
    await vi.waitFor(() => expect(api.updateNote).toHaveBeenCalledTimes(1));

    first.resolve({
      id: 'live-note', title: 'Live', folderId: null, tagIds: [], internalLinks: [],
      rawMarkdown: '较早正文', contentLoaded: true, favorite: false, deleted: false,
      updatedAt: '2026-08-31T01:01:00.000Z'
    });
    await olderSave;
    await vi.waitFor(() => expect(api.updateNote).toHaveBeenCalledTimes(2));
    second.resolve({
      id: 'live-note', title: 'Live', folderId: null, tagIds: [], internalLinks: [],
      rawMarkdown: '最新正文', contentLoaded: true, favorite: false, deleted: false,
      updatedAt: '2026-08-31T01:02:00.000Z'
    });
    await newerSave;

    expect(api.updateNote).toHaveBeenNthCalledWith(1, 'live-note', {
      rawMarkdown: '较早正文',
      expectedUpdatedAt: '2026-08-31T01:00:00.000Z'
    });
    expect(api.updateNote).toHaveBeenNthCalledWith(2, 'live-note', {
      rawMarkdown: '最新正文',
      expectedUpdatedAt: '2026-08-31T01:01:00.000Z'
    });
    expect(store.getState().serverData.notes[0]?.rawMarkdown).toBe('最新正文');
  });

  it('duplicates a saved note through the existing create-note endpoint', async () => {
    const api = createApi();
    vi.mocked(api.loadWorkspaceResources)
      .mockResolvedValueOnce({
        folderTree: [{ id: 'folder-1', name: '资料', parentId: null, children: [] }],
        notes: [{
          id: 'live-note', title: 'Live', folderId: 'folder-1', tagIds: [], internalLinks: [],
          rawMarkdown: '# 正文', contentLoaded: true, favorite: false, deleted: false,
          sourceType: 'manual', status: 'draft'
        }],
        tags: []
      })
      .mockResolvedValueOnce({
        folderTree: [{ id: 'folder-1', name: '资料', parentId: null, children: [] }],
        notes: [{
          id: 'copy-note', title: 'Live Copy', folderId: 'folder-1', tagIds: [], internalLinks: [],
          rawMarkdown: '# 正文', contentLoaded: true, favorite: false, deleted: false
        }],
        tags: []
      });
    vi.mocked(api.createNote).mockResolvedValue({
      id: 'copy-note', title: 'Live Copy', folderId: 'folder-1', tagIds: [], internalLinks: [],
      rawMarkdown: '# 正文', contentLoaded: true, favorite: false, deleted: false
    });
    const store = createAppStore({ api, cacheKey: 'workspace-save-as', mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();

    await expect(store.getState().duplicateNote('live-note')).resolves.toBe('copy-note');
    expect(api.createNote).toHaveBeenCalledWith({
      title: 'Live Copy',
      rawMarkdown: '# 正文',
      folderId: 'folder-1',
      spaceId: 'space-live',
      sourceType: 'manual',
      aiVisibility: 'normal',
      status: 'draft'
    });
    expect(store.getState().navigation.selectedNoteId).toBe('copy-note');
  });

  it('imports Markdown through the existing batch endpoint and opens the first note', async () => {
    const api = createApi();
    vi.mocked(api.loadWorkspaceResources)
      .mockResolvedValueOnce({
        folderTree: [{ id: 'folder-1', name: '资料', parentId: null, children: [] }],
        notes: [{
          id: 'live-note', title: 'Live', folderId: null, tagIds: [], internalLinks: [],
          rawMarkdown: '', contentLoaded: false, favorite: false, deleted: false
        }],
        tags: []
      })
      .mockResolvedValueOnce({
        folderTree: [{ id: 'folder-1', name: '资料', parentId: null, children: [] }],
        notes: [{
          id: 'import-a', title: 'Live 2', folderId: null, tagIds: [], internalLinks: [],
          rawMarkdown: '', contentLoaded: false, favorite: false, deleted: false
        }],
        tags: []
      });
    vi.mocked(api.importMarkdownNotes).mockResolvedValue([
      { id: 'import-a', title: 'Live 2', folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '# Live', contentLoaded: true, favorite: false, deleted: false },
      { id: 'import-b', title: 'Second', folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '# Second', contentLoaded: true, favorite: false, deleted: false }
    ]);
    const store = createAppStore({ api, cacheKey: 'workspace-import', mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();

    await expect(store.getState().importMarkdownNotes(null, [
      { fileName: 'first.md', rawMarkdown: '# Live' },
      { fileName: 'second.md', rawMarkdown: '# Second' }
    ])).resolves.toEqual({ firstNoteId: 'import-a', count: 2 });
    expect(api.importMarkdownNotes).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'Live 2', rawMarkdown: '# Live', folderId: null, spaceId: 'space-live' }),
      expect.objectContaining({ title: 'Second', rawMarkdown: '# Second', folderId: null, spaceId: 'space-live' })
    ]);
    expect(store.getState().navigation.selectedNoteId).toBe('import-a');
  });

  it('persists close-other and drag reorder tab actions', async () => {
    const storage = createStorage();
    const api = createApi();
    vi.mocked(api.loadWorkspaceResources).mockResolvedValue({
      folderTree: [], tags: [], notes: ['a', 'b', 'c'].map((id) => ({
        id, title: id, folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '',
        contentLoaded: true, favorite: false, deleted: false
      }))
    });
    const store = createAppStore({ api, storage, cacheKey: 'workspace-tab-actions', mockSnapshot: createEmptyWorkspaceSnapshot() });
    await store.getState().loadWorkspace();
    store.getState().selectNote('b');
    store.getState().selectNote('c');
    store.getState().reorderNoteTabs('c', 'a');
    expect(store.getState().navigation.openNoteTabs).toEqual(['c', 'a', 'b']);
    store.getState().closeOtherNoteTabs('a');
    expect(store.getState().navigation.openNoteTabs).toEqual(['a']);
    expect(JSON.parse(storage.getItem('workspace-tab-actions') ?? '{}').openNoteTabs).toEqual(['a']);
  });
});

function createApi(): WorkspaceApi {
  return {
    createAnalysisScope: vi.fn().mockResolvedValue({ id: 'scope-1' }),
    listKnowledgeSpaces: vi.fn().mockResolvedValue([{ id: 'space-live' }]),
    createDefaultKnowledgeSpace: vi.fn().mockResolvedValue({ id: 'space-live' }),
    loadWorkspaceResources: vi.fn().mockResolvedValue({
      folderTree: [{ id: 'folder-1', name: '资料', parentId: null, children: [] }],
      notes: [{
        id: 'live-note', title: 'Live', folderId: null, tagIds: [], internalLinks: [],
        rawMarkdown: '', contentLoaded: false, favorite: false, deleted: false
      }],
      tags: []
    }),
    searchNoteIds: vi.fn().mockResolvedValue([]),
    createNote: vi.fn().mockResolvedValue({ id: 'created-note' }),
    importMarkdownNotes: vi.fn().mockResolvedValue([{ id: 'imported-note' }]),
    getNote: vi.fn().mockResolvedValue({ id: 'live-note' }),
    createFolder: vi.fn().mockResolvedValue({ id: 'created-folder' }),
    updateNote: vi.fn().mockResolvedValue({ id: 'live-note' }),
    deleteNote: vi.fn().mockResolvedValue({ id: 'live-note' }),
    restoreNote: vi.fn().mockResolvedValue({ id: 'live-note' }),
    permanentlyDeleteNote: vi.fn().mockResolvedValue({ id: 'live-note' }),
    setNoteFavorite: vi.fn().mockResolvedValue({ id: 'live-note' }),
    setNoteTags: vi.fn().mockResolvedValue({ id: 'live-note' }),
    createTag: vi.fn(), updateTag: vi.fn(), deleteTag: vi.fn(), mergeTags: vi.fn(), reorderTags: vi.fn(),
    createTagGroup: vi.fn(), updateTagGroup: vi.fn(), deleteTagGroup: vi.fn(),
    deleteNotes: vi.fn().mockResolvedValue([]),
    assignTagToNotes: vi.fn().mockResolvedValue([]),
    updateTagsForNotes: vi.fn().mockResolvedValue([]),
    queryNotes: vi.fn().mockResolvedValue({ items: [], hasNext: false }),
    getLinkedNotes: vi.fn().mockResolvedValue([]),
    listAnnotations: vi.fn().mockResolvedValue([]),
    createAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    restoreAnnotation: vi.fn(),
    updateAnnotationAnchor: vi.fn(),
    listNoteVersions: vi.fn().mockResolvedValue([]),
    getNoteVersion: vi.fn().mockResolvedValue({ id: 'version-1' }),
    listNoteAttachments: vi.fn().mockResolvedValue([]),
    uploadNoteAttachment: vi.fn().mockResolvedValue({ id: 'attachment-1' }),
    renameNoteAttachment: vi.fn().mockResolvedValue({ id: 'attachment-1' }),
    inspectAttachmentDeletion: vi.fn().mockResolvedValue({ asset: { type: 'attachment', id: 'attachment-1' }, decision: 'can-purge-no-history', references: [], reasonCodes: [], coverage: { persistedCurrentAndHistory: true } }),
    verifyNoteAttachment: vi.fn(),
    restoreNoteAttachment: vi.fn(),
    listAttachmentCleanup: vi.fn().mockResolvedValue({ items: [], pending: 0 }),
    retryAttachmentCleanup: vi.fn().mockResolvedValue({ completed: 0, pending: 0 }),
    deleteNoteAttachment: vi.fn().mockResolvedValue({ id: 'attachment-1' }),
    updateFolder: vi.fn().mockResolvedValue({ id: 'folder-1' }),
    deleteFolder: vi.fn().mockResolvedValue([]),
    emptyRecycleBin: vi.fn().mockResolvedValue({ deletedCount: 0 })
  };
}

function createStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
