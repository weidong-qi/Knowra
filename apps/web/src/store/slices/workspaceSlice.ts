import {
  createDuplicateTitle,
  buildMarkdownImportItems,
  normalizeFolderTree, flattenFolderTree, normalizeNotes,
  type Note
} from '@study-accelerator/web-core';
import type { WorkspaceDependencies, WorkspaceSlice } from '../types';
import { workspaceCapabilities, LOCAL_PERMANENT_DELETE_REASON, LOCAL_ANALYSIS_SCOPE_REASON } from '../workspaceCapabilities';
import { createWorkspaceLoadController } from '../workspaceLoadController';
import { createCommandNoteLoader } from '../commandNoteOpening';
import {
  EMPTY_WORKSPACE_SERVER_DATA,
  updateWorkspaceNoteInStore,
  type GetStore,
  type SetStore
} from '../workspaceSnapshotState';


export function createWorkspaceSlice(
  set: SetStore,
  get: GetStore,
  dependencies: WorkspaceDependencies
): WorkspaceSlice {
  const loading = createWorkspaceLoadController(set, get, dependencies);
  const runLoad = loading.load;
  const noteSaveQueues = new Map<string, Promise<Note>>();

  return {
    knowledgeExtraction: dependencies.api.knowledgeExtraction,
    persistenceMode: dependencies.persistenceMode ?? 'remote',
    knowledgeGeneration: 0,
    serverData: EMPTY_WORKSPACE_SERVER_DATA,
    dataMode: 'loading',
    workspaceLoadState: 'idle',
    workspaceError: null,
    loadCommandNote: createCommandNoteLoader(set, get, dependencies),
    loadWorkspace: () => runLoad(false),
    retryWorkspace: () => runLoad(true),
    async refreshLocalWorkspace() {
      const before = get();
      if (before.persistenceMode !== 'desktop-local' || before.editorHasLocalChanges || before.saveState === 'saving' || loading.isLoading()) return false;
      const generation = loading.generation();
      const spaces = await dependencies.api.listKnowledgeSpaces();
      const currentSpaceId = spaces.find(space => space.id === before.serverData.currentSpaceId)?.id
        ?? spaces.find(space => space.defaultFlag)?.id ?? spaces[0]?.id;
      if (!currentSpaceId) return false;
      const resources = await dependencies.api.loadWorkspaceResources(currentSpaceId);
      const notes = normalizeNotes(resources.notes);
      for (let index = 0; index < notes.length; index++) {
        if (!notes[index].deleted && before.serverData.notes.some(note => note.id === notes[index].id && note.contentLoaded)) {
          notes[index] = { ...notes[index], ...await dependencies.api.getNote(notes[index].id), contentLoaded: true };
        }
      }
      if (loading.generation() !== generation || loading.isLoading() || get().editorHasLocalChanges || get().saveState === 'saving' || get().serverData !== before.serverData) return false;
      const folderTree = normalizeFolderTree(resources.folderTree);
      set({ knowledgeGeneration: get().knowledgeGeneration + 1, serverData: { spaces, currentSpaceId, folderTree, foldersById: flattenFolderTree(folderTree), notes, tags: resources.tags, tagGroups: resources.tagGroups ?? [] } });
      return true;
    },
    canWriteWorkspace: () => get().dataMode === 'api',
    selectKnowledgeSpace: loading.select,
    async createKnowledgeSpace(name) {
      if (!dependencies.api.createKnowledgeSpace) throw new Error('当前服务尚不支持空间管理。');
      const space = await dependencies.api.createKnowledgeSpace({ name });
      await runLoad(true);
      return space;
    },
    async inspectEmptySpaceDeletion(id) {
      if (!dependencies.api.inspectEmptySpaceDeletion) throw new Error('当前服务尚不支持空间删除预检。');
      return dependencies.api.inspectEmptySpaceDeletion(id);
    },
    async deleteEmptySpace(id, expectedUpdatedAt) {
      if (get().persistenceMode === 'desktop-local') throw new Error('桌面端暂不支持永久删除空间，请在网页版完成。');
      if (!dependencies.api.deleteEmptySpace) throw new Error('当前服务尚不支持空间删除。');
      await dependencies.api.deleteEmptySpace(id, { expectedUpdatedAt });
      await runLoad(true);
    },
    async previewSpaceMigration(sourceId, targetId) {
      if (!dependencies.api.previewSpaceMigration) throw new Error('当前服务尚不支持空间迁移预检。');
      return dependencies.api.previewSpaceMigration(sourceId, targetId);
    },
    async migrateSpaceAssets(sourceId, targetId, expectedPreviewHash) {
      if (get().persistenceMode === 'desktop-local') throw new Error('桌面端暂不支持空间整包迁移，请在网页版完成。');
      if (!dependencies.api.migrateSpaceAssets) throw new Error('当前服务尚不支持空间迁移。');
      await dependencies.api.migrateSpaceAssets(sourceId, { targetSpaceId: targetId, expectedPreviewHash });
      await runLoad(true);
    },
    async createNote(folderId, title) {
      return executeWorkspaceMutation(set, get, '正在新建笔记…', async (spaceId) => {
        const created = await dependencies.api.createNote({
          title,
          rawMarkdown: '',
          folderId,
          spaceId,
          sourceType: 'manual',
          status: 'draft'
        });
        await runLoad(true);
        get().selectNote(created.id);
        return { result: created.id, message: '笔记已创建' };
      });
    },
    async importMarkdownNotes(folderId, sources) {
      return executeWorkspaceMutation(set, get, '正在导入 Markdown…', async (spaceId) => {
        const state = get();
        const folderNames = (folderId
          ? state.serverData.foldersById[folderId]?.children ?? []
          : state.serverData.folderTree).map((folder) => folder.name);
        const noteNames = state.serverData.notes
          .filter((note) => !note.deleted && note.folderId === folderId)
          .map((note) => note.title);
        const items = buildMarkdownImportItems(sources, [...folderNames, ...noteNames]).map((item) => ({
          ...item,
          folderId,
          spaceId,
          status: 'draft'
        }));
        const imported = await dependencies.api.importMarkdownNotes(items);
        const firstNote = imported[0];
        if (!firstNote?.id) throw new Error('导入结果中没有可打开的笔记');
        await runLoad(true);
        get().selectNote(firstNote.id);
        return {
          result: { firstNoteId: firstNote.id, count: imported.length },
          message: imported.length === 1
            ? `已导入 Markdown：${firstNote.title}`
            : `已导入 ${imported.length} 个 Markdown 文件`
        };
      });
    },
    async duplicateNote(noteId) {
      return executeWorkspaceMutation(set, get, '正在另存笔记…', async (spaceId) => {
        let source = get().serverData.notes.find((note) => note.id === noteId && !note.deleted);
        if (!source) throw new Error('笔记不存在或已被删除');
        if (!source.contentLoaded) {
          const loaded = await dependencies.api.getNote(noteId);
          updateWorkspaceNoteInStore(set, get, dependencies, loaded, { ...source, contentLoaded: true });
          source = get().serverData.notes.find((note) => note.id === noteId && !note.deleted) ?? source;
        }
        const folderNames = (source.folderId
          ? get().serverData.foldersById[source.folderId]?.children ?? []
          : get().serverData.folderTree).map((folder) => folder.name);
        const noteNames = get().serverData.notes
          .filter((note) => !note.deleted && note.folderId === source.folderId)
          .map((note) => note.title);
        const nextTitle = createDuplicateTitle([...folderNames, ...noteNames], source.title);
        const created = await dependencies.api.createNote({
          title: nextTitle,
          rawMarkdown: source.rawMarkdown,
          folderId: source.folderId,
          spaceId,
          sourceType: source.sourceType ?? 'manual',
          aiVisibility: source.aiVisibility ?? 'normal',
          status: source.status ?? 'draft'
        });
        await runLoad(true);
        get().selectNote(created.id);
        return { result: created.id, message: `已另存为：${nextTitle}` };
      });
    },
    async createFolder(parentId, name) {
      return executeWorkspaceMutation(set, get, '正在新建文件夹…', async (spaceId) => {
        const created = await dependencies.api.createFolder({ spaceId, parentId, name });
        await runLoad(true);
        get().selectNotesFolder(created.id);
        if (parentId && !get().navigation.openFolders[parentId]) get().toggleFolder(parentId);
        return { result: created.id, message: '文件夹已创建' };
      });
    },
    async renameNote(noteId, title) {
      return executeWorkspaceMutation(set, get, '正在重命名笔记…', async () => {
        await dependencies.api.updateNote(noteId, { title });
        await runLoad(true);
        return { result: undefined, message: '笔记已重命名' };
      });
    },
    async loadNoteContent(noteId) {
      const current = get().serverData.notes.find((note) => note.id === noteId);
      if (!current || current.contentLoaded) return;
      try {
        const loaded = await dependencies.api.getNote(noteId);
        updateWorkspaceNoteInStore(set, get, dependencies, loaded, {
          ...current,
          contentLoaded: true
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '笔记正文加载失败';
        set({ saveError: message, statusMessage: message });
        throw error;
      }
    },
    async saveNoteContent(noteId, rawMarkdown, expectedUpdatedAt, baseMarkdown, annotationMapping) {
      const previousSave = noteSaveQueues.get(noteId) ?? Promise.resolve(undefined);
      const currentSave = previousSave
        .catch(() => undefined)
        .then(async () => {
          const current = get().serverData.notes.find((note) => note.id === noteId);
          if (!current) throw new Error('笔记不存在或已被删除');
          if (baseMarkdown === undefined && current.rawMarkdown === rawMarkdown && (!expectedUpdatedAt || expectedUpdatedAt === current.updatedAt)) return current;
          return executeWorkspaceMutation(set, get, '正在保存正文…', async () => {
            const concurrencyToken = expectedUpdatedAt ?? current.updatedAt;
            let updated;
            try {
              updated = await dependencies.api.updateNote(noteId, {
                rawMarkdown, annotationMapping,
                ...(concurrencyToken ? { expectedUpdatedAt: concurrencyToken } : {})
              });
            } catch (error) {
              // 只对已知基线的正文冲突重新读取；标题、同步等元数据变化不应锁死正文保存。
              if (!error || typeof error !== 'object' || !('code' in error)
                || error.code !== 'NOTE_UPDATE_CONFLICT') throw error;
              const latest = await dependencies.api.getNote(noteId);
              if (latest.deleted || typeof latest.rawMarkdown !== 'string' || !latest.updatedAt) throw error;
              const baseline = baseMarkdown ?? (concurrencyToken === current.updatedAt ? current.rawMarkdown : undefined);
              if (latest.rawMarkdown === rawMarkdown) updated = latest;
              else {
                if (baseline === undefined || latest.rawMarkdown !== baseline) throw error;
              // 仍携带刚读取的版本；读取后再次变化时由服务端拒绝，不无限重试。
              updated = await dependencies.api.updateNote(noteId, {
                rawMarkdown, annotationMapping, expectedUpdatedAt: latest.updatedAt
              });
              }
            }
            updateWorkspaceNoteInStore(set, get, dependencies, updated, {
              ...current,
              rawMarkdown,
              contentLoaded: true
            });
            const saved = get().serverData.notes.find((note) => note.id === noteId) ?? current;
            return { result: saved, message: '正文已保存' };
          });
        });
      noteSaveQueues.set(noteId, currentSave);
      try {
        return await currentSave;
      } finally {
        if (noteSaveQueues.get(noteId) === currentSave) noteSaveQueues.delete(noteId);
      }
    },
    async deleteNote(noteId) {
      return executeWorkspaceMutation(set, get, '正在删除笔记…', async () => {
        const wasSelected = get().navigation.selectedNoteId === noteId;
        await dependencies.api.deleteNote(noteId);
        await runLoad(true);
        if (wasSelected) get().selectNotesScope('trash');
        return { result: undefined, message: '笔记已移入回收站' };
      });
    },
    async restoreNote(noteId) {
      return executeWorkspaceMutation(set, get, '正在恢复笔记…', async () => {
        await dependencies.api.restoreNote(noteId);
        await runLoad(true);
        get().selectNotesScope('trash');
        return { result: undefined, message: '笔记已恢复' };
      });
    },
    async permanentlyDeleteNote(noteId) {
      if (!workspaceCapabilities(get().persistenceMode).permanentDelete) throw new Error(LOCAL_PERMANENT_DELETE_REASON);
      return executeWorkspaceMutation(set, get, '正在彻底删除笔记…', async () => {
        await dependencies.api.permanentlyDeleteNote(noteId);
        await runLoad(true);
        get().selectNotesScope('trash');
        return { result: undefined, message: '笔记已彻底删除' };
      });
    },
    async setNoteFavorite(noteId, favorite) {
      return executeWorkspaceMutation(set, get, favorite ? '正在收藏笔记…' : '正在取消收藏…', async () => {
        await dependencies.api.setNoteFavorite(noteId, favorite);
        await runLoad(true);
        return { result: undefined, message: favorite ? '笔记已收藏' : '已取消收藏' };
      });
    },
    async setNoteTags(noteId, tagIds) {
      return executeWorkspaceMutation(set, get, '正在更新标签…', async () => {
        await dependencies.api.setNoteTags(noteId, tagIds);
        await runLoad(true);
        return { result: undefined, message: '笔记标签已更新' };
      });
    },
    async createTag(input) {
      return executeWorkspaceMutation(set, get, '正在新建标签…', async (spaceId) => {
        const tag = await dependencies.api.createTag({ ...input, spaceId });
        await runLoad(true);
        return { result: tag, message: `已新建标签：${tag.name ?? input.name}` };
      });
    },
    async updateTag(tagId, input) {
      return executeWorkspaceMutation(set, get, '正在更新标签…', async () => {
        const tag = await dependencies.api.updateTag(tagId, input);
        await runLoad(true);
        return { result: tag, message: '标签已更新' };
      });
    },
    async deleteTag(tagId) {
      return executeWorkspaceMutation(set, get, '正在删除标签…', async () => {
        await dependencies.api.deleteTag(tagId);
        await runLoad(true);
        return { result: undefined, message: '标签已删除' };
      });
    },
    async mergeTags(sourceTagId, targetTagId) {
      return executeWorkspaceMutation(set, get, '正在合并标签…', async () => {
        await dependencies.api.mergeTags(sourceTagId, targetTagId);
        await runLoad(true);
        return { result: undefined, message: '标签已合并' };
      });
    },
    async reorderTags(tagIds) {
      return executeWorkspaceMutation(set, get, '正在调整标签顺序…', async () => {
        await dependencies.api.reorderTags(tagIds);
        await runLoad(true);
        return { result: undefined, message: '标签顺序已更新' };
      });
    },
    async createTagGroup(input) {
      return executeWorkspaceMutation(set, get, '正在新建标签分组…', async (spaceId) => {
        const group = await dependencies.api.createTagGroup({ ...input, spaceId });
        await runLoad(true);
        return { result: group, message: `已新建分组：${group.name}` };
      });
    },
    async updateTagGroup(groupId, input) {
      return executeWorkspaceMutation(set, get, '正在更新标签分组…', async () => {
        const group = await dependencies.api.updateTagGroup(groupId, input);
        await runLoad(true);
        return { result: group, message: '标签分组已更新' };
      });
    },
    async deleteTagGroup(groupId) {
      return executeWorkspaceMutation(set, get, '正在删除标签分组…', async () => {
        await dependencies.api.deleteTagGroup(groupId);
        await runLoad(true);
        return { result: undefined, message: '标签分组已删除' };
      });
    },
    async deleteNotes(noteIds) {
      return executeWorkspaceMutation(set, get, '正在批量删除笔记…', async () => {
        await dependencies.api.deleteNotes(noteIds);
        await runLoad(true);
        return { result: undefined, message: `已将 ${noteIds.length} 篇笔记移入回收站` };
      });
    },
    async assignTagToNotes(noteIds, tagId) {
      return executeWorkspaceMutation(set, get, '正在批量添加标签…', async () => {
        await dependencies.api.assignTagToNotes(noteIds, tagId);
        await runLoad(true);
        return { result: undefined, message: `已为 ${noteIds.length} 篇笔记添加标签` };
      });
    },
    async updateTagsForNotes(noteIds, addTagIds, removeTagIds) {
      return executeWorkspaceMutation(set, get, '正在批量更新标签…', async () => {
        await dependencies.api.updateTagsForNotes(noteIds, addTagIds, removeTagIds);
        await runLoad(true);
        return { result: undefined, message: `已更新 ${noteIds.length} 篇笔记的标签` };
      });
    },
    async queryNotes(input) {
      const spaceId = get().serverData.currentSpaceId;
      if (!spaceId) return { items: [], hasNext: false };
      return dependencies.api.queryNotes({ ...input, spaceId });
    },
    async getLinkedNotes(noteId) {
      return dependencies.api.getLinkedNotes(noteId);
    },
    async getNoteLinkRelations(noteId) {
      if (!dependencies.api.getNoteLinkRelations) throw new Error('当前服务尚不支持笔记引用查询。');
      return dependencies.api.getNoteLinkRelations(noteId);
    },
    async listAnnotations(noteId) {
      const spaceId = get().serverData.currentSpaceId;
      if (!spaceId) return [];
      return dependencies.api.listAnnotations(noteId, spaceId);
    },
    async createAnnotation(input) {
      return executeWorkspaceMutation(set, get, '正在创建正文标注…', async () => ({
        result: await dependencies.api.createAnnotation(input),
        message: '已标记为重要内容'
      }));
    },
    async deleteAnnotation(annotationId, expectedRevision) {
      return executeWorkspaceMutation(set, get, '正在删除正文标注…', async () => ({
        result: await dependencies.api.deleteAnnotation(annotationId, expectedRevision),
        message: '正文标注已归档'
      }));
    },
    async restoreAnnotation(annotationId, expectedRevision) {
      return executeWorkspaceMutation(set, get, '正在恢复正文标注…', async () => ({
        result: await dependencies.api.restoreAnnotation(annotationId, expectedRevision),
        message: '正文标注已恢复'
      }));
    },
    async updateAnnotationAnchor(annotationId, input) {
      return executeWorkspaceMutation(set, get, '正在重新定位正文标注…', async () => ({
        result: await dependencies.api.updateAnnotationAnchor(annotationId, input),
        message: '正文标注位置已更新'
      }));
    },
    async updateAnnotation(annotationId, input) {
      return executeWorkspaceMutation(set, get, '正在更新重点信息…', async () => ({
        result: await dependencies.api.updateAnnotation!(annotationId, input),
        message: '重点信息已更新'
      }));
    },
    async confirmAnnotationRange(annotationId, input) {
      return executeWorkspaceMutation(set, get, '正在确认重点范围…', async () => ({
        result: await dependencies.api.confirmAnnotationRange!(annotationId, input), message: '重点范围已确认'
      }));
    },
    async previewAnnotation(annotationId) {
      return dependencies.api.previewAnnotation!(annotationId);
    },
    async getAnnotationKnowledgeLinks(annotationId) {
      return dependencies.api.getAnnotationKnowledgeLinks!(annotationId);
    },
    async previewAnalysisScope(input) {
      return dependencies.api.previewAnalysisScope!(input);
    },
    async createAnalysisScope(input) {
      if (!workspaceCapabilities(get().persistenceMode).saveAnalysisScope) throw new Error(LOCAL_ANALYSIS_SCOPE_REASON);
      return executeWorkspaceMutation(set, get, '正在保存分析范围…', async () => ({
        result: await dependencies.api.createAnalysisScope!(input),
        message: '分析范围快照已保存'
      }));
    },
    async listAnalysisScopes(spaceId) {
      return dependencies.api.listAnalysisScopes!(spaceId);
    },
    async trashAnalysisScope(id, input) {
      return executeWorkspaceMutation(set, get, '正在移入分析范围回收站…', async () => ({ result: await dependencies.api.trashAnalysisScope!(id, input), message: '分析范围已移入回收站' }));
    },
    async restoreAnalysisScope(id, input) {
      return executeWorkspaceMutation(set, get, '正在恢复分析范围…', async () => ({ result: await dependencies.api.restoreAnalysisScope!(id, input), message: '分析范围已恢复' }));
    },
    async createAnnotationExclusion(annotationId, input) {
      return executeWorkspaceMutation(set, get, '正在保存局部排除…', async () => ({
        result: await dependencies.api.createAnnotationExclusion!(annotationId, input),
        message: '局部排除已保存'
      }));
    },
    async deleteAnnotationExclusion(annotationId, exclusionId, expectedRevision) {
      return executeWorkspaceMutation(set, get, '正在恢复分析范围…', async () => ({
        result: await dependencies.api.deleteAnnotationExclusion!(annotationId, exclusionId, expectedRevision),
        message: '已恢复该局部范围'
      }));
    },
    async listNoteVersions(noteId) {
      return dependencies.api.listNoteVersions(noteId);
    },
    async listNoteVersionPage(noteId, options) {
      if (!dependencies.api.listNoteVersionPage) throw new Error('当前服务尚不支持分页历史记录，请升级后重试。');
      return dependencies.api.listNoteVersionPage(noteId, options);
    },
    async previewNoteVersionPrune(noteId) {
      if (!dependencies.api.previewNoteVersionPrune) throw new Error('当前服务尚不支持版本清理预览，请升级后重试。');
      return dependencies.api.previewNoteVersionPrune(noteId);
    },
    async saveNoteVersionAs(noteId, versionId) {
      return executeWorkspaceMutation(set, get, '正在另存历史版本…', async (spaceId) => {
        const source = get().serverData.notes.find(note => note.id === noteId && !note.deleted);
        if (!source) throw new Error('原笔记不存在或已被删除');
        const version = await dependencies.api.getNoteVersion(noteId, versionId);
        if (version.noteId !== noteId || typeof version.content !== 'string') throw new Error('历史版本不属于当前笔记或正文无效');
        const names = get().serverData.notes.filter(note => !note.deleted && note.folderId === source.folderId).map(note => note.title);
        const folderNames = (source.folderId ? get().serverData.foldersById[source.folderId]?.children ?? [] : get().serverData.folderTree).map(folder => folder.name);
        const baseTitle = `${source.title || '未命名笔记'} · 历史副本`;
        const title = [...names, ...folderNames].includes(baseTitle) ? createDuplicateTitle([...names, ...folderNames], baseTitle) : baseTitle;
        const created = await dependencies.api.createNote({ title, rawMarkdown: version.content, folderId: source.folderId, spaceId,
          sourceType: source.sourceType ?? 'manual', status: 'draft', tagIds: source.tagIds, aiVisibility: source.aiVisibility ?? 'normal' });
        await runLoad(true);
        get().selectNote(created.id);
        return { result: created.id, message: `历史版本已另存为：${title}` };
      });
    },
    async getNoteVersion(noteId, versionId) {
      return dependencies.api.getNoteVersion(noteId, versionId);
    },
    async setNoteAiVisibility(noteId, input) {
      return executeWorkspaceMutation(set, get, '正在更新笔记隐私…', async () => {
        await dependencies.api.updateNote(noteId, input);
        await runLoad(true);
        return { result: undefined, message: input.aiVisibility === 'private' ? '笔记已设为私密，AI 不再读取' : '笔记已设为普通，可供 AI 读取' };
      });
    },
    async organizeNote(noteId, input) {
      return executeWorkspaceMutation(set, get, '正在整理笔记…', async () => {
        await dependencies.api.updateNote(noteId, input);
        await runLoad(true);
        return { result: undefined, message: '笔记位置和状态已更新' };
      });
    },
    async listNoteAttachments(noteId) {
      return dependencies.api.listNoteAttachments(noteId);
    },
    async uploadNoteAttachment(input) {
      return executeWorkspaceMutation(set, get, '正在上传附件…', async () => ({
        result: await dependencies.api.uploadNoteAttachment(input),
        message: '附件已上传'
      }));
    },
    async renameNoteAttachment(attachmentId, fileName) {
      return executeWorkspaceMutation(set, get, '正在重命名附件…', async () => ({
        result: await dependencies.api.renameNoteAttachment(attachmentId, fileName),
        message: '附件已重命名'
      }));
    },
    inspectAttachmentDeletion: (id) => dependencies.api.inspectAttachmentDeletion(id),
    listAttachmentCleanup: () => dependencies.api.listAttachmentCleanup(),
    async verifyNoteAttachment(id) {
      return executeWorkspaceMutation(set, get, '正在核验附件…', async () => ({ result: await dependencies.api.verifyNoteAttachment(id), message: '附件核验完成' }));
    },
    async restoreNoteAttachment(id, contentBase64) {
      return executeWorkspaceMutation(set, get, '正在恢复原文件…', async () => ({ result: await dependencies.api.restoreNoteAttachment(id, contentBase64), message: '原附件已恢复' }));
    },
    async retryAttachmentCleanup() {
      return executeWorkspaceMutation(set, get, '正在重试文件清理…', async () => ({ result: await dependencies.api.retryAttachmentCleanup(), message: '文件清理重试完成' }));
    },
    async deleteNoteAttachment(attachmentId) {
      return executeWorkspaceMutation(set, get, '正在删除附件…', async () => {
        const result = await dependencies.api.deleteNoteAttachment(attachmentId);
        const message = result.cleanup === 'complete' ? '附件已删除，文件已清理' : result.cleanup === 'retained-local' ? '附件记录已删除，本机副本按同步与恢复规则保留' : '附件已删除，文件清理待重试';
        return { result, message };
      });
    },
    async moveEntry(kind, id, parentId) {
      return executeWorkspaceMutation(set, get, '正在移动目录…', async () => {
        if (kind === 'folder') await dependencies.api.updateFolder(id, { parentId });
        else await dependencies.api.updateNote(id, { folderId: parentId });
        await runLoad(true);
        return { result: undefined, message: '目录位置已更新' };
      });
    },
    async renameFolder(folderId, name) {
      return executeWorkspaceMutation(set, get, '正在重命名文件夹…', async () => {
        const folder = get().serverData.foldersById[folderId];
        if (!folder) throw new Error('文件夹不存在或已被删除');
        await dependencies.api.updateFolder(folderId, { name, parentId: folder.parentId });
        await runLoad(true);
        return { result: undefined, message: '文件夹已重命名' };
      });
    },
    async deleteFolder(folderId, input) {
      return executeWorkspaceMutation(set, get, '正在删除文件夹…', async () => {
        const parentId = get().serverData.foldersById[folderId]?.parentId ?? null;
        await dependencies.api.deleteFolder(folderId, input);
        await runLoad(true);
        get().selectNotesFolder(parentId);
        return { result: undefined, message: input.mode === 'keep' ? '文件夹已移入回收站，笔记已移至指定位置' : '文件夹和其中的笔记已移入回收站' };
      });
    },
    async restoreFolder(folderId) {
      return executeWorkspaceMutation(set, get, '正在恢复文件夹…', async () => {
        await dependencies.api.restoreFolder!(folderId);
        await runLoad(true);
        return { result: undefined, message: '文件夹已恢复' };
      });
    },
    async listDeletedFolders(spaceId) {
      return dependencies.api.listDeletedFolders!(spaceId);
    },
    async emptyRecycleBin() {
      if (!workspaceCapabilities(get().persistenceMode).permanentDelete) throw new Error(LOCAL_PERMANENT_DELETE_REASON);
      return executeWorkspaceMutation(set, get, '正在清空回收站…', async (spaceId) => {
        const result = await dependencies.api.emptyRecycleBin(spaceId);
        await runLoad(true);
        get().selectNotesScope('trash');
        const deletedCount = Number(result.deletedCount ?? result.deleted ?? 0);
        return { result: deletedCount, message: `已彻底删除 ${deletedCount} 条笔记` };
      });
    }
  };
}

async function executeWorkspaceMutation<T>(
  set: SetStore,
  get: GetStore,
  pendingMessage: string,
  operation: (spaceId: string) => Promise<{ result: T; message: string }>
): Promise<T> {
  const state = get();
  if (state.dataMode !== 'api') {
    throw new Error('当前不是后端在线模式，暂时无法修改笔记库');
  }
  const spaceId = state.serverData.currentSpaceId;
  if (!spaceId) throw new Error('当前没有可用的知识空间');
  set({ saveState: 'saving', saveError: null, statusMessage: pendingMessage });
  try {
    const completed = await operation(spaceId);
    set({ saveState: 'saved', saveError: null, statusMessage: get().persistenceMode === 'desktop-local'
      ? `${completed.message} · 已保存到本机` : completed.message });
    return completed.result;
  } catch (error) {
    const message = error instanceof Error ? error.message : '笔记库操作失败';
    set({ saveState: 'error', saveError: message, statusMessage: message });
    throw error;
  }
}
