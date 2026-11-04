import type { Page } from '@playwright/test';
import { mockShellServices } from './shellServices';

export async function mockEditorWorkspace(
  page: Page,
  savedMarkdown: string[],
  savedRequests: Array<{ noteId: string; markdown: string }> = [],
  initialMarkdown?: string
): Promise<void> {
  await mockShellServices(page);
  await page.route('**/api/ai/actions/drafts', route => route.fulfill({ json: { data: { accepted: true } } }));
  await page.route('**/api/storage/attachments/cleanup', route => route.fulfill({ json: { data: { items: [], pending: 0 } } }));
  let sourceMarkdown = initialMarkdown
    ?? ['已有正文', ...Array.from({ length: 64 }, (_, index) => `验收段落 ${index + 1}`)].join('\n\n');
  let relatedMarkdown = '第二篇正文';
  let copiedNote: ReturnType<typeof createNote> | null = null;
  let importedNotes: ReturnType<typeof createNote>[] = [];
  await page.route('**/api/knowledge/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let data: unknown = [];
    if (url.pathname.endsWith('/search/notes') && url.searchParams.get('result') === 'command') data = [{ id: 'note-2', title: '关联验收笔记', folderId: 'folder-1', snippet: '合成内容' }];
    else if (url.pathname.endsWith('/link-relations')) data = { noteId: url.pathname.split('/').at(-2), spaceId: 'space-1', contentHash: 'a'.repeat(64), outgoing: [], backlinks: [] };
    else if (url.pathname.endsWith('/notes/note-1/links')) data = [createNote(relatedMarkdown, true, 'note-2', '关联验收笔记')];
    else if (url.pathname.endsWith('/spaces')) data = [{ id: 'space-1', name: '主空间' }];
    else if (url.pathname.endsWith('/folders/tree')) data = [{ id: 'folder-1', name: '工作', parentId: null, children: [] }];
    else if (url.pathname.endsWith('/notes/note-1')) {
      if (request.method() === 'PATCH') {
        sourceMarkdown = String((request.postDataJSON() as { rawMarkdown?: string }).rawMarkdown ?? '');
        savedMarkdown.push(sourceMarkdown);
        savedRequests.push({ noteId: 'note-1', markdown: sourceMarkdown });
      }
      data = createNote(sourceMarkdown, true);
    } else if (url.pathname.endsWith('/notes/note-2')) {
      if (request.method() === 'PATCH') {
        relatedMarkdown = String((request.postDataJSON() as { rawMarkdown?: string }).rawMarkdown ?? '');
        savedRequests.push({ noteId: 'note-2', markdown: relatedMarkdown });
      }
      data = createNote(relatedMarkdown, true, 'note-2', '关联验收笔记');
    } else if (url.pathname.endsWith('/notes/note-copy')) {
      data = copiedNote;
    } else if (url.pathname.includes('/notes/note-import-')) {
      data = importedNotes.find((note) => url.pathname.endsWith(note.id)) ?? null;
    } else if (url.pathname.endsWith('/notes/import-markdown-batch')) {
      const items = (request.postDataJSON() as { items: Array<{ title: string; rawMarkdown: string; folderId: string | null }> }).items;
      importedNotes = items.map((item, index) => createNote(
        item.rawMarkdown,
        true,
        `note-import-${index + 1}`,
        item.title,
        item.folderId
      ));
      data = importedNotes;
    } else if (url.pathname.endsWith('/notes')) {
      if (request.method() === 'POST') {
        const input = request.postDataJSON() as { title: string; rawMarkdown: string; folderId: string | null };
        copiedNote = createNote(input.rawMarkdown, true, 'note-copy', input.title, input.folderId);
        data = copiedNote;
      } else {
        data = [
          createNote('', false),
          createNote('', false, 'note-2', '关联验收笔记'),
          ...(copiedNote ? [{ ...copiedNote, rawMarkdown: '', contentLoaded: false }] : []),
          ...importedNotes.map((note) => ({ ...note, rawMarkdown: '', contentLoaded: false }))
        ];
      }
    }
    else if (url.pathname.endsWith('/tags')) data = [
      { id: 'tag-study', name: '学习' },
      { id: 'tag-ai', name: 'AI' }
    ];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
}

export function createNote(
  rawMarkdown: string,
  contentLoaded: boolean,
  id = 'note-1',
  title = '编辑器验收笔记',
  folderId: string | null = 'folder-1'
) {
  return {
    id,
    spaceId: 'space-1',
    title,
    folderId,
    tagIds: id === 'note-1' ? ['tag-study', 'tag-ai'] : [],
    internalLinks: id === 'note-1' ? ['note-2'] : [],
    rawMarkdown,
    contentLoaded,
    favorite: false,
    deleted: false,
    status: 'draft',
    sourceType: 'manual',
    createdAt: '2026-08-12T13:14:00.000Z',
    updatedAt: '2026-08-31T02:32:00.000Z'
  };
}
