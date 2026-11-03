import type { Page } from '@playwright/test';
import type { Annotation, Attachment, CommandNoteSearchHit, Folder, Note, NoteVersion } from '@study-accelerator/web-core';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import { mockV5AssistantSettingsEvidence } from './v5AssistantSettingsEvidence';

export const titleQuery = '合成检索';
export const commandTitle = '合成检索：跨设备阅读与长标题显示的第一份参考资料';
export const secondTitle = '合成检索：键盘上下选择并跳转的第二份参考资料';
export const bodyTitle = '正文命中的元信息验收笔记';
export const bodyQuery = '正文专属词';
export const loadingQuery = '等待合成查询';
export const errorQuery = '合成失败查询';
export const emptyQuery = '不存在的合成关键词';
export const longListQuery = '合成长列表边界';
export const folderName = '长路径下的合成学习参考资料';
export const parentFolderName = '跨设备只读验收归档';
export const attachmentName = '合成参考附件长文件名仅检查元信息与换行.pdf';
export const bodySnippet = '正文专属词只存在于合成正文。这里用中文说明与 SyntheticUnbrokenReferenceToken0123456789 检查窄屏换行，结果不能被分组和提示挤成逐字竖排。';
const date = '2026-10-10T08:00:00.000Z';
const markdown = '# 合成资料与元信息\n\n正文专属词只存在于合成正文。\n\n这份合成笔记用于只读检查信息、附件、标注数量和版本历史。\n\n## 阅读提示\n\n只切换视图和读取内容，不保存、恢复、上传或下载。';
const note = (id: string, title: string, loaded = false): Note => ({
  id, spaceId: 'space-1', title, folderId: 'folder-1', tagIds: ['tag-study'], internalLinks: [],
  rawMarkdown: loaded ? markdown : '', contentLoaded: loaded, favorite: false, deleted: false,
  status: 'draft', sourceType: 'manual', createdAt: date, updatedAt: date,
  contentHash: loaded ? calculateContentHash(markdown) : null
});
const notes = [note('note-1', commandTitle), note('note-2', secondTitle), note('note-3', bodyTitle)];
const folders: Folder[] = [{ id: 'folder-parent', spaceId: 'space-1', name: parentFolderName, parentId: null,
  children: [{ id: 'folder-1', spaceId: 'space-1', name: folderName, parentId: 'folder-parent', children: [] }] }];
const attachments: Attachment[] = [{ id: 'synthetic-metadata-file', noteId: 'note-3', fileName: attachmentName,
  mimeType: 'application/pdf', size: 15360, status: 'ready', createdAt: date, updatedAt: date }];
const annotations: Annotation[] = ['正文专属词只存在于合成正文。', '只切换视图和读取内容，不保存、恢复、上传或下载。'].map((quoteText, index) => ({
  id: `synthetic-meta-annotation-${index + 1}`, spaceId: 'space-1', noteId: 'note-3', noteVersionId: null,
  kind: 'important', importance: index === 0 ? 'normal' : 'important', sourceMode: 'manual', scopeType: 'selection',
  quoteText, headingPath: [index === 0 ? '合成资料与元信息' : '阅读提示'], fromPosition: index * 80, toPosition: index * 80 + quoteText.length,
  prefixText: '', suffixText: '', anchorFingerprint: `synthetic-meta-${index}`, noteContentHash: calculateContentHash(markdown),
  idempotencyKey: `synthetic-meta-${index}`, status: 'active', lifecycleStatus: 'active', anchorStatus: 'resolved', revision: 1
}));
const versions: NoteVersion[] = [
  { id: 'synthetic-version-1', noteId: 'note-3', content: '# 合成历史正文\n\n这是一份仅供只读预览的正文快照。',
    contentHash: 'a'.repeat(64), createdAt: '2026-10-10T07:58:00.000Z', createdBy: 'synthetic-evidence' },
  { id: 'synthetic-version-2', noteId: 'note-3', content: '# 更早的合成快照\n\n仅查看，不恢复。',
    contentHash: 'b'.repeat(64), createdAt: '2026-10-10T07:55:00.000Z', createdBy: 'synthetic-evidence' }
];
const bodyHit: CommandNoteSearchHit = { id: 'note-3', title: bodyTitle, folderId: 'folder-1', snippet: bodySnippet };

/** 继承全 context HTTP/WebSocket 隔离，并在最外层拒绝全部非 GET 请求，包括父夹具的合成写入口。 */
export async function mockV5CommandMetaEvidence(page: Page) {
  const network = await mockV5AssistantSettingsEvidence(page);
  const mutations: string[] = [];
  const searchRequests: Array<{ query: string; result: string | null; spaceId: string | null; outcome: string }> = [];
  const heldSearches: Array<{ release(): void; finished: Promise<void> }> = [];
  await page.context().route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), path = url.pathname;
    if (url.origin !== 'http://127.0.0.1:5173') return route.fallback();
    if (method !== 'GET') {
      network.requests.push(`${method} ${path}`); network.blocked.push(`${method} ${path}`); mutations.push(`${method} ${path}`);
      return route.abort('blockedbyclient');
    }
    if (!path.startsWith('/api/')) return route.fallback();
    if (path === '/api/knowledge/search/notes') {
      network.requests.push(`${method} ${path}`);
      const query = url.searchParams.get('query') ?? '';
      const outcome = query === loadingQuery ? 'held-synthetic-read' : query === errorQuery ? 'synthetic-error'
        : [titleQuery, bodyQuery, longListQuery].includes(query) ? 'synthetic-results' : 'synthetic-empty';
      searchRequests.push({ query, result: url.searchParams.get('result'), spaceId: url.searchParams.get('spaceId'), outcome });
      if (query === loadingQuery) {
        let release!: () => void, finish!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        const finished = new Promise<void>(resolve => { finish = resolve; });
        heldSearches.push({ release, finished });
        await pending;
        try { await route.fulfill({ json: { data: [bodyHit] } }); } finally { finish(); }
        return;
      }
      if (query === errorQuery) return route.fulfill({ status: 503,
        json: { error: { code: 'SYNTHETIC_SEARCH_UNAVAILABLE', message: '合成搜索暂不可用，请更换关键词重试。' } } });
      const data = query === titleQuery ? notes.slice(0, 2).map(item => ({ id: item.id, title: item.title,
        folderId: item.folderId, snippet: bodySnippet })) : query === bodyQuery ? [bodyHit]
        : query === longListQuery ? Array.from({ length: 12 }, (_, index) => ({ id: `synthetic-long-hit-${index + 1}`,
          title: `合成长列表第 ${index + 1} 项`, folderId: 'folder-1', snippet: bodySnippet })) : [];
      return route.fulfill({ json: { data } });
    }
    let data: unknown;
    if (path === '/api/knowledge/folders/tree') data = folders;
    else if (path === '/api/knowledge/notes') data = notes;
    else if (/^\/api\/knowledge\/notes\/note-[123]$/.test(path)) {
      const item = notes.find(item => path.endsWith(`/${item.id}`))!;
      data = note(item.id, item.title, true);
    } else if (/^\/api\/knowledge\/notes\/note-[123]\/link-relations$/.test(path)) data = {
      noteId: path.split('/').at(-2), spaceId: 'space-1', contentHash: calculateContentHash(markdown), outgoing: [], backlinks: []
    };
    else if (path === '/api/knowledge/annotations') data = url.searchParams.get('noteId') === 'note-3' ? annotations : [];
    else if (path === '/api/storage/attachments') data = url.searchParams.get('noteId') === 'note-3' ? attachments : [];
    else if (path === '/api/knowledge/notes/note-3/versions') data = {
      items: versions.map(({ content: _content, ...summary }) => summary), total: versions.length, currentVersionId: null, nextCursor: null
    };
    else if (/^\/api\/knowledge\/notes\/note-3\/versions\/synthetic-version-[12]$/.test(path)) data = versions.find(item => path.endsWith(`/${item.id}`));
    else return route.fallback();
    network.requests.push(`${method} ${path}`);
    return route.fulfill({ json: { data } });
  });
  return { ...network, mutations, searchRequests, heldSearches,
    releaseSearches: async () => {
      const pending = heldSearches.splice(0);
      pending.forEach(item => item.release());
      await Promise.all(pending.map(item => item.finished));
    } };
}
