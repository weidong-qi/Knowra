import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, createApiClient, createWorkspaceApi } from '../src/index.js';

describe('framework-neutral API clients', () => {
  it('学习目标确认将明确审阅的父知识与目标版本发送到HTTP body', async () => {
    const requestJson = vi.fn().mockResolvedValue({ data: { id: 'objective/1' } });
    const api = createWorkspaceApi({ requestJson });
    const input = {
      reviewBaseline: { objectiveUpdatedAt: '2026-10-03T01:00:00.000Z', knowledgeUpdatedAt: '2026-10-03T00:00:00.000Z' }
    };
    await api.mutateTrainingAsset!('learningObjective', 'objective/1', 'confirm', input);
    expect(requestJson).toHaveBeenCalledWith('/api/knowledge/learning-objectives/objective%2F1/confirm', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  });
  it('uses the training lifecycle endpoints and preserves purge baselines', async () => {
    const record = { id: 'question/1', updatedAt: '2026-09-24T00:00:00.000Z' };
    const preview = {
      asset: { type: 'question', id: record.id },
      decision: 'can-purge-no-history',
      expectedUpdatedAt: record.updatedAt,
      references: [],
      exclusiveRecords: {},
      coverage: {}
    };
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({ data: [record] })
      .mockResolvedValueOnce({ data: record })
      .mockResolvedValueOnce({ data: record })
      .mockResolvedValueOnce({ data: preview })
      .mockResolvedValueOnce({ data: { status: 'subject-purged', asset: preview.asset } });
    const api = createWorkspaceApi({ requestJson });
    await api.listTrainingAssets!('question', { includeArchived: true, includeDeleted: true });
    await api.createTrainingAsset!('question', { stem: '题干' });
    await api.mutateTrainingAsset!('question', record.id, 'trash');
    await api.inspectTrainingAssetPurge!('question', record.id);
    await api.purgeTrainingAsset!('question', record.id, preview.expectedUpdatedAt);
    expect(requestJson).toHaveBeenNthCalledWith(1, '/api/knowledge/questions?includeArchived=true&includeDeleted=true');
    expect(requestJson).toHaveBeenNthCalledWith(2, '/api/knowledge/questions', {
      method: 'POST',
      body: JSON.stringify({ stem: '题干' })
    });
    expect(requestJson).toHaveBeenNthCalledWith(3, '/api/knowledge/questions/question%2F1/trash', { method: 'POST' });
    expect(requestJson).toHaveBeenNthCalledWith(4, '/api/knowledge/questions/question%2F1/purge-preview');
    expect(requestJson).toHaveBeenNthCalledWith(5, '/api/knowledge/questions/question%2F1/purge', {
      method: 'POST',
      body: JSON.stringify({ expectedUpdatedAt: preview.expectedUpdatedAt })
    });
  });

  it('preserves the exact authoritative purge confirmation for both asset endpoints', async () => {
    const input = {
      expectedUpdatedAt: '2026-10-03T00:00:00Z',
      expectedDatasetEpoch: 'epoch-original',
      confirmationToken: 'original-token'
    };
    const requestJson = vi
      .fn()
      .mockResolvedValue({ data: { status: 'subject-purged', asset: { type: 'question', id: 'q1' } } });
    const api = createWorkspaceApi({ requestJson });
    await api.purgeTrainingAsset!('question', 'q1', input);
    expect(requestJson).toHaveBeenCalledWith('/api/knowledge/questions/q1/purge', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    await api.permanentlyDeleteKnowledgeItem!('k1', input);
    expect(requestJson).toHaveBeenCalledWith('/api/knowledge/items/k1/permanent', {
      method: 'DELETE',
      body: JSON.stringify(input)
    });
  });
  it('keeps knowledge review mutations and source detail on the real API contracts', async () => {
    const item = { id: 'knowledge/1', updatedAt: '2026-09-21T00:00:00.000Z' };
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({ data: [item] })
      .mockResolvedValueOnce({ data: item })
      .mockResolvedValueOnce({ data: { item, evidence: [] } })
      .mockResolvedValueOnce({ data: item })
      .mockResolvedValueOnce({ data: item })
      .mockResolvedValueOnce({ data: item })
      .mockResolvedValueOnce({ data: item })
      .mockResolvedValueOnce({ data: [{ id: 'evidence', quoteText: '真实来源' }] })
      .mockResolvedValueOnce({ data: { id: 'evidence-2', quoteText: '补充来源' } })
      .mockResolvedValueOnce({ data: { item, evidence: { id: 'evidence', status: 'invalid' } } });
    const api = createWorkspaceApi({ requestJson });
    await expect(api.listKnowledgeItems!({ query: '核心 陈述', includeArchived: false })).resolves.toEqual([item]);
    await expect(api.getKnowledgeItem!(item.id)).resolves.toEqual(item);
    const input = {
      title: '候选',
      canonicalStatement: '知识内容',
      sourceMode: 'annotation' as const,
      evidence: [{ sourceType: 'annotation' as const, annotationId: 'annotation-1' }]
    };
    await expect(api.createKnowledgeCandidate!(input)).resolves.toEqual({ item, evidence: [] });
    const baseline = { expectedUpdatedAt: item.updatedAt };
    await api.updateKnowledgeItem!(item.id, { title: '修改', ...baseline });
    await api.confirmKnowledgeItem!(item.id, baseline);
    await api.archiveKnowledgeItem!(item.id, baseline);
    await api.restoreKnowledgeItem!(item.id, baseline);
    await expect(api.listKnowledgeEvidence!(item.id)).resolves.toEqual([{ id: 'evidence', quoteText: '真实来源' }]);
    const evidenceInput = { sourceType: 'annotation' as const, annotationId: 'annotation-2' };
    await expect(api.createKnowledgeEvidence!(item.id, evidenceInput)).resolves.toEqual({
      id: 'evidence-2',
      quoteText: '补充来源'
    });
    await expect(api.retireKnowledgeEvidence!(item.id, 'evidence/1', baseline)).resolves.toEqual({
      item,
      evidence: { id: 'evidence', status: 'invalid' }
    });
    expect(requestJson).toHaveBeenNthCalledWith(
      1,
      '/api/knowledge/items?query=%E6%A0%B8%E5%BF%83%20%E9%99%88%E8%BF%B0&includeArchived=false'
    );
    expect(requestJson).toHaveBeenNthCalledWith(2, '/api/knowledge/items/knowledge%2F1');
    expect(requestJson).toHaveBeenNthCalledWith(3, '/api/knowledge/items', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    expect(requestJson).toHaveBeenNthCalledWith(4, '/api/knowledge/items/knowledge%2F1', {
      method: 'PATCH',
      body: JSON.stringify({ title: '修改', ...baseline })
    });
    for (const [index, action] of ['confirm', 'archive', 'restore'].entries()) {
      expect(requestJson).toHaveBeenNthCalledWith(index + 5, `/api/knowledge/items/knowledge%2F1/${action}`, {
        method: 'POST',
        body: JSON.stringify(baseline)
      });
    }
    expect(requestJson).toHaveBeenNthCalledWith(8, '/api/knowledge/items/knowledge%2F1/evidence');
    expect(requestJson).toHaveBeenNthCalledWith(9, '/api/knowledge/items/knowledge%2F1/evidence', {
      method: 'POST',
      body: JSON.stringify(evidenceInput)
    });
    expect(requestJson).toHaveBeenNthCalledWith(10, '/api/knowledge/items/knowledge%2F1/evidence/evidence%2F1/retire', {
      method: 'POST',
      body: JSON.stringify(baseline)
    });
  });

  it('preserves the response envelope and friendly API errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: '笔记不存在' } })
    });
    const client = createApiClient({ fetchImpl });
    const request = client.requestJson('/missing');
    await expect(request).rejects.toThrow('笔记不存在');
    await expect(request).rejects.toMatchObject<ApiRequestError>({ status: 404, code: null });
  });

  it('preserves the backend conflict code and status for recovery flows', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: { code: 'NOTE_UPDATE_CONFLICT', message: 'Note has changed since it was loaded' }
      })
    });
    const client = createApiClient({ fetchImpl });

    await expect(client.requestJson('/notes/note-1')).rejects.toMatchObject<ApiRequestError>({
      status: 409,
      code: 'NOTE_UPDATE_CONFLICT'
    });
  });

  it('loads the three workspace resources without UI dependencies', async () => {
    const requestJson = vi.fn(async (url: string) => {
      if (url.includes('folders/tree')) return { data: [{ id: 'folder-1', name: 'Folder' }] };
      if (url.includes('/notes')) return { data: [{ id: 'note-1', title: 'Note' }] };
      return { data: [{ id: 'tag-1', name: 'Tag' }] };
    });
    const resources = await createWorkspaceApi({ requestJson }).loadWorkspaceResources('space-1');
    expect(resources.folderTree[0]?.id).toBe('folder-1');
    expect(resources.notes[0]?.id).toBe('note-1');
    expect(resources.tags[0]?.id).toBe('tag-1');
  });

  it('creates notes and folders with the legacy knowledge API contract', async () => {
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 'note-1', title: 'Created note' } })
      .mockResolvedValueOnce({ data: { id: 'folder-1', name: 'Created folder' } });
    const api = createWorkspaceApi({ requestJson });
    const noteInput = { rawMarkdown: '# Created note', spaceId: 'space/1' };
    const folderInput = { name: 'Created folder', spaceId: 'space/1' };

    await expect(api.createNote(noteInput)).resolves.toMatchObject({ id: 'note-1' });
    await expect(api.createFolder(folderInput)).resolves.toMatchObject({ id: 'folder-1' });

    expect(requestJson).toHaveBeenNthCalledWith(1, '/api/knowledge/notes', {
      method: 'POST',
      body: JSON.stringify(noteInput)
    });
    expect(requestJson).toHaveBeenNthCalledWith(2, '/api/knowledge/folders', {
      method: 'POST',
      body: JSON.stringify(folderInput)
    });
  });

  it('uses the single and batch Markdown import contracts', async () => {
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 'import-1', title: 'One' } })
      .mockResolvedValueOnce({ data: [{ id: 'import-2' }, { id: 'import-3' }] });
    const api = createWorkspaceApi({ requestJson });
    const one = [{ title: 'One', rawMarkdown: '# One' }];
    const many = [
      { title: 'Two', rawMarkdown: '# Two' },
      { title: 'Three', rawMarkdown: '# Three' }
    ];

    await expect(api.importMarkdownNotes(one)).resolves.toHaveLength(1);
    await expect(api.importMarkdownNotes(many)).resolves.toHaveLength(2);
    expect(requestJson).toHaveBeenNthCalledWith(1, '/api/knowledge/notes/import-markdown', {
      method: 'POST',
      body: JSON.stringify(one[0])
    });
    expect(requestJson).toHaveBeenNthCalledWith(2, '/api/knowledge/notes/import-markdown-batch', {
      method: 'POST',
      body: JSON.stringify({ items: many })
    });
  });

  it('loads a note detail before editing its markdown body', async () => {
    const requestJson = vi.fn().mockResolvedValue({
      data: { id: 'note/1', title: 'Detail', rawMarkdown: '# Detail' }
    });

    await expect(createWorkspaceApi({ requestJson }).getNote('note/1')).resolves.toMatchObject({
      id: 'note/1',
      rawMarkdown: '# Detail'
    });
    expect(requestJson).toHaveBeenCalledWith('/api/knowledge/notes/note%2F1');
  });

  it('updates and deletes tree entries with encoded legacy routes', async () => {
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 'note/1' } })
      .mockResolvedValueOnce({ data: { id: 'note/1' } })
      .mockResolvedValueOnce({ data: { id: 'note/1' } })
      .mockResolvedValueOnce({ data: { id: 'folder/1' } })
      .mockResolvedValueOnce({ data: [{ id: 'folder/1' }] });
    const api = createWorkspaceApi({ requestJson });

    await api.updateNote('note/1', { title: '新名称' });
    await api.setNoteFavorite('note/1', false);
    await api.deleteNote('note/1');
    await api.updateFolder('folder/1', { name: '新目录', parentId: null });
    await api.deleteFolder('folder/1');

    expect(requestJson).toHaveBeenNthCalledWith(1, '/api/knowledge/notes/note%2F1', {
      method: 'PATCH',
      body: JSON.stringify({ title: '新名称' })
    });
    expect(requestJson).toHaveBeenNthCalledWith(2, '/api/knowledge/notes/note%2F1/favorite', {
      method: 'POST',
      body: JSON.stringify({ favorite: false })
    });
    expect(requestJson).toHaveBeenNthCalledWith(3, '/api/knowledge/notes/note%2F1', { method: 'DELETE' });
    expect(requestJson).toHaveBeenNthCalledWith(4, '/api/knowledge/folders/folder%2F1', {
      method: 'PATCH',
      body: JSON.stringify({ name: '新目录', parentId: null })
    });
    expect(requestJson).toHaveBeenNthCalledWith(5, '/api/knowledge/folders/folder%2F1', { method: 'DELETE' });
  });

  it('forwards expectedUpdatedAt when updating note content', async () => {
    const requestJson = vi.fn().mockResolvedValue({ data: { id: 'note-1' } });
    const api = createWorkspaceApi({ requestJson });

    await api.updateNote('note-1', {
      rawMarkdown: '# 新正文',
      expectedUpdatedAt: '2026-08-31T01:00:00.000Z'
    });

    expect(requestJson).toHaveBeenCalledWith('/api/knowledge/notes/note-1', {
      method: 'PATCH',
      body: JSON.stringify({
        rawMarkdown: '# 新正文',
        expectedUpdatedAt: '2026-08-31T01:00:00.000Z'
      })
    });
  });

  it('empties a space recycle bin using an encoded query parameter', async () => {
    const requestJson = vi.fn().mockResolvedValue({ data: { deleted: 2 } });
    const result = await createWorkspaceApi({ requestJson }).emptyRecycleBin('space/1');

    expect(result).toEqual({ deleted: 2 });
    expect(requestJson).toHaveBeenCalledWith('/api/knowledge/notes/recycle-bin?spaceId=space%2F1', {
      method: 'DELETE'
    });
  });

  it('requests version summaries with encoded cursor pagination', async () => {
    const page = { items: [], total: 0, currentVersionId: null, nextCursor: null };
    const requestJson = vi.fn().mockResolvedValue({ data: page });
    const api = createWorkspaceApi({ requestJson });
    await expect(api.listNoteVersionPage!('note/1', { limit: 20, cursor: 'cursor/value' })).resolves.toEqual(page);
    expect(requestJson).toHaveBeenCalledWith('/api/knowledge/notes/note%2F1/versions?limit=20&cursor=cursor%2Fvalue');
  });

  it('connects recycle-bin recovery, note tags and version history contracts', async () => {
    const version = {
      id: 'version/1',
      noteId: 'note/1',
      content: '# 快照',
      contentHash: 'a'.repeat(64),
      createdAt: '2026-09-01T10:00:00.000Z',
      createdBy: 'user'
    };
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 'note/1' } })
      .mockResolvedValueOnce({ data: { id: 'note/1' } })
      .mockResolvedValueOnce({ data: { id: 'note/1', tagIds: ['tag/1'] } })
      .mockResolvedValueOnce({ data: [version] })
      .mockResolvedValueOnce({ data: version });
    const api = createWorkspaceApi({ requestJson });

    await api.restoreNote('note/1');
    await api.permanentlyDeleteNote('note/1');
    await api.setNoteTags('note/1', ['tag/1']);
    await expect(api.listNoteVersions('note/1')).resolves.toHaveLength(1);
    await expect(api.getNoteVersion('note/1', 'version/1')).resolves.toMatchObject({ id: 'version/1' });

    expect(requestJson).toHaveBeenNthCalledWith(1, '/api/knowledge/notes/note%2F1/restore', { method: 'POST' });
    expect(requestJson).toHaveBeenNthCalledWith(2, '/api/knowledge/notes/note%2F1/permanent', { method: 'DELETE' });
    expect(requestJson).toHaveBeenNthCalledWith(3, '/api/knowledge/notes/note%2F1/tags', {
      method: 'PUT',
      body: JSON.stringify({ tagIds: ['tag/1'] })
    });
    expect(requestJson).toHaveBeenNthCalledWith(4, '/api/knowledge/notes/note%2F1/versions');
    expect(requestJson).toHaveBeenNthCalledWith(5, '/api/knowledge/notes/note%2F1/versions/version%2F1');
  });

  it('preserves attachment cleanup results and connects preflight, verification, restoration and retry', async () => {
    const attachment = {
      id: 'attachment-1',
      noteId: 'note',
      fileName: 'file.txt',
      size: 8,
      mimeType: 'text/plain',
      status: 'ready'
    };
    const preflight = {
      asset: { type: 'attachment', id: attachment.id },
      references: [],
      decision: 'can-purge-no-history'
    };
    const cleanup = {
      items: [{ attachmentId: attachment.id, fileName: 'file.txt', cleanup: 'pending-retry' }],
      pending: 1
    };
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({ data: preflight })
      .mockResolvedValueOnce({ data: attachment })
      .mockResolvedValueOnce({ data: attachment })
      .mockResolvedValueOnce({ data: { ...attachment, cleanup: 'retained-local' } })
      .mockResolvedValueOnce({ data: cleanup })
      .mockResolvedValueOnce({ data: { completed: 1, pending: 0 } });
    const api = createWorkspaceApi({ requestJson });
    await expect(api.inspectAttachmentDeletion(attachment.id)).resolves.toEqual(preflight);
    await api.verifyNoteAttachment(attachment.id);
    await api.restoreNoteAttachment(attachment.id, 'b3JpZ2luYWw=');
    await expect(api.deleteNoteAttachment(attachment.id)).resolves.toMatchObject({ cleanup: 'retained-local' });
    await expect(api.listAttachmentCleanup()).resolves.toEqual(cleanup);
    await expect(api.retryAttachmentCleanup()).resolves.toEqual({ completed: 1, pending: 0 });
    expect(requestJson).toHaveBeenNthCalledWith(3, '/api/storage/attachments/attachment-1/restore', {
      method: 'POST',
      body: JSON.stringify({ contentBase64: 'b3JpZ2luYWw=' })
    });
    expect(requestJson).toHaveBeenNthCalledWith(6, '/api/storage/attachments/cleanup/retry', { method: 'POST' });
  });

  it('connects note organization and attachment management contracts', async () => {
    const attachment = {
      id: 'attachment/1',
      noteId: 'note/1',
      fileName: 'diagram.png',
      mimeType: 'image/png',
      size: 128,
      status: 'ready'
    };
    const uploadInput = {
      noteId: 'note/1',
      fileName: 'diagram.png',
      mimeType: 'image/png',
      contentBase64: 'aW1hZ2U='
    };
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 'note/1', folderId: 'folder/2', status: 'active' } })
      .mockResolvedValueOnce({ data: [attachment] })
      .mockResolvedValueOnce({ data: attachment })
      .mockResolvedValueOnce({ data: { ...attachment, fileName: 'renamed.png' } })
      .mockResolvedValueOnce({ data: attachment });
    const api = createWorkspaceApi({ requestJson });

    await api.updateNote('note/1', { folderId: 'folder/2', status: 'active' });
    await expect(api.listNoteAttachments('note/1')).resolves.toEqual([attachment]);
    await expect(api.uploadNoteAttachment(uploadInput)).resolves.toMatchObject({ id: 'attachment/1' });
    await api.renameNoteAttachment('attachment/1', 'renamed.png');
    await api.deleteNoteAttachment('attachment/1');

    expect(requestJson).toHaveBeenNthCalledWith(1, '/api/knowledge/notes/note%2F1', {
      method: 'PATCH',
      body: JSON.stringify({ folderId: 'folder/2', status: 'active' })
    });
    expect(requestJson).toHaveBeenNthCalledWith(2, '/api/storage/attachments?noteId=note%2F1');
    expect(requestJson).toHaveBeenNthCalledWith(3, '/api/storage/attachments', {
      method: 'POST',
      body: JSON.stringify(uploadInput)
    });
    expect(requestJson).toHaveBeenNthCalledWith(4, '/api/storage/attachments/attachment%2F1', {
      method: 'PATCH',
      body: JSON.stringify({ fileName: 'renamed.png' })
    });
    expect(requestJson).toHaveBeenNthCalledWith(5, '/api/storage/attachments/attachment%2F1', { method: 'DELETE' });
  });

  it('connects batch note actions and paged server-side filtering', async () => {
    const notes = Array.from({ length: 31 }, (_, index) => ({ id: `note-${index + 1}`, title: `Note ${index + 1}` }));
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({ data: notes.slice(0, 2) })
      .mockResolvedValueOnce({ data: notes.slice(0, 2) })
      .mockResolvedValueOnce({ data: notes });
    const api = createWorkspaceApi({ requestJson });

    await api.deleteNotes(['note-1', 'note-2']);
    await api.assignTagToNotes(['note-1', 'note-2'], 'tag/1');
    await expect(
      api.queryNotes({
        query: '注意力',
        spaceId: 'space/1',
        folderId: 'folder/1',
        favoriteOnly: true,
        sortBy: 'updatedAt',
        order: 'desc',
        offset: 30,
        limit: 30
      })
    ).resolves.toEqual({ items: notes.slice(0, 30), hasNext: true });

    expect(requestJson).toHaveBeenNthCalledWith(1, '/api/knowledge/notes/batch/delete', {
      method: 'POST',
      body: JSON.stringify({ noteIds: ['note-1', 'note-2'] })
    });
    expect(requestJson).toHaveBeenNthCalledWith(2, '/api/knowledge/notes/batch/tags', {
      method: 'POST',
      body: JSON.stringify({ noteIds: ['note-1', 'note-2'], tagId: 'tag/1' })
    });
    expect(requestJson).toHaveBeenNthCalledWith(
      3,
      '/api/knowledge/search/notes?query=%E6%B3%A8%E6%84%8F%E5%8A%9B&spaceId=space%2F1&folderId=folder%2F1&favoriteOnly=true&sortBy=updatedAt&order=desc&offset=30&limit=31'
    );
  });

  it('connects linked-note and content-annotation contracts', async () => {
    const annotation = { id: 'annotation/1', noteId: 'note/1', quoteText: '重要内容' };
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: 'note-2' }] })
      .mockResolvedValueOnce({ data: [annotation] })
      .mockResolvedValueOnce({ data: annotation })
      .mockResolvedValueOnce({ data: annotation })
      .mockResolvedValueOnce({ data: annotation })
      .mockResolvedValueOnce({
        data: {
          annotation,
          currentContentHash: 'hash',
          resolution: { status: 'resolved', reason: null },
          exclusions: []
        }
      })
      .mockResolvedValueOnce({
        data: { annotationId: annotation.id, candidates: [], confirmed: [], evidenceStatus: [] }
      })
      .mockResolvedValueOnce({
        data: {
          spaceId: 'space/1',
          mode: 'all',
          previewHash: 'preview',
          summary: { noteCount: 1, segmentCount: 1, annotationCount: 0 },
          segments: [],
          omittedItems: [],
          ai: { available: false, message: '提炼服务暂不可用' }
        }
      })
      .mockResolvedValueOnce({ data: { id: 'scope-1' } });
    const api = createWorkspaceApi({ requestJson });

    await api.getLinkedNotes('note/1');
    await api.listAnnotations('note/1', 'space/1');
    await api.deleteAnnotation('annotation/1');
    await api.restoreAnnotation('annotation/1');
    await api.updateAnnotation?.('annotation/1', { expectedRevision: 1, kind: 'question' });
    await api.previewAnnotation?.('annotation/1');
    await api.getAnnotationKnowledgeLinks?.('annotation/1');
    const scopeInput = { spaceId: 'space/1', mode: 'all' as const, noteIds: ['note/1'] };
    await api.previewAnalysisScope?.(scopeInput);
    await api.createAnalysisScope?.({ ...scopeInput, previewHash: 'preview', idempotencyKey: 'scope-request' });

    expect(requestJson).toHaveBeenNthCalledWith(1, '/api/knowledge/notes/note%2F1/links');
    expect(requestJson).toHaveBeenNthCalledWith(2, '/api/knowledge/annotations?noteId=note%2F1&spaceId=space%2F1');
    expect(requestJson).toHaveBeenNthCalledWith(3, '/api/knowledge/annotations/annotation%2F1', { method: 'DELETE' });
    expect(requestJson).toHaveBeenNthCalledWith(4, '/api/knowledge/annotations/annotation%2F1/restore', {
      method: 'POST'
    });
    expect(requestJson).toHaveBeenNthCalledWith(5, '/api/knowledge/annotations/annotation%2F1', {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 1, kind: 'question' })
    });
    expect(requestJson).toHaveBeenNthCalledWith(6, '/api/knowledge/annotations/annotation%2F1/preview');
    expect(requestJson).toHaveBeenNthCalledWith(7, '/api/knowledge/annotations/annotation%2F1/knowledge-links');
    expect(requestJson).toHaveBeenNthCalledWith(8, '/api/knowledge/analysis-scopes/preview', {
      method: 'POST',
      body: JSON.stringify(scopeInput)
    });
    expect(requestJson).toHaveBeenNthCalledWith(9, '/api/knowledge/analysis-scopes', {
      method: 'POST',
      body: JSON.stringify({ ...scopeInput, previewHash: 'preview', idempotencyKey: 'scope-request' })
    });
  });
});
