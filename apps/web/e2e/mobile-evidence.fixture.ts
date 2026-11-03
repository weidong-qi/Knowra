import type { Page } from '@playwright/test';

// 复用 v4-07-editor、ai-assistant、AIInbox 测试的 DTO/路由契约；全部为合成数据。
export const title = '移动端验收：知识整理与长标题显示';
const date = '2026-10-09T00:00:00.000Z';
const markdown = ['# 移动端阅读与编辑', '这是一份合成验收笔记，不包含真实用户资料。',
  '| 项目 | 说明 |\n| --- | --- |\n| 手机 | 触控与滚动 |\n| 平板 | 分栏与检查器 |',
  '```typescript\nconst viewport = { width: 390, device: "synthetic-mobile-baseline" };\n```',
  ...Array.from({ length: 24 }, (_, i) => `## 第 ${i + 1} 节\n\n较长的中文正文，用于观察编辑区独立滚动、工具栏和移动端底部导航是否互相遮挡。`)].join('\n\n');
const note = (id = 'note-1', loaded = false) => ({ id, spaceId: 'space-1', title: id === 'note-1' ? title : `合成学习笔记 ${id.slice(5)}`,
  folderId: 'folder-1', tagIds: ['tag-study'], internalLinks: [], rawMarkdown: loaded ? markdown : '', contentLoaded: loaded,
  favorite: false, deleted: false, status: 'draft', sourceType: 'manual', createdAt: date, updatedAt: date });
const action = { actionId: 'action-1', requestId: 'turn-1', status: 'awaitingApproval', reviewRequired: true,
  errorCode: null, expiresAt: '2099-01-01T00:00:00Z', receipt: null,
  plan: { planHash: 'synthetic-hash', toolName: 'notes_create', items: [{ before: null,
    after: { ...note('note-review', true), title: '合成成果：本周学习总结' } }] } };

export async function mockMobileEvidence(page: Page) {
  const blocked: string[] = [];
  const requests: string[] = [];
  const conversation = { conversationId: 'conversation-1', spaceId: 'space-1', createdAt: date, updatedAt: date, historicalDataset: false, readOnly: false };
  let messages: unknown[] = [];
  const turn = { turnId: 'turn-1', conversationId: conversation.conversationId, requestedPolicyId: null,
    status: 'succeeded', phase: 'finished', errorCode: null, toolCalls: [], modelAttempts: [] };
  await page.context().routeWebSocket('**/*', socket => { blocked.push(`WEBSOCKET ${socket.url()}`); socket.close(); });
  await page.context().route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:5173') {
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort('blockedbyclient'); return;
    }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
    const path = url.pathname; requests.push(`${request.method()} ${path}`);
    const method = request.method();
    const conversationRoot = `/api/ai/conversations/${conversation.conversationId}`;
    const allowedWrite = method === 'POST' && (path === '/api/ai/conversations' || path === `${conversationRoot}/messages` || path === '/api/ai/actions/drafts' || path === '/api/storage/attachments/cleanup');
    if (method !== 'GET' && !allowedWrite) { blocked.push(`${method} ${path}`); await route.abort('blockedbyclient'); return; }
    let data: unknown;
    if (path === '/api/knowledge/spaces') data = [{ id: 'space-1', name: '合成验收空间' }];
    else if (path === '/api/knowledge/folders/tree') data = [{ id: 'folder-1', name: '学习资料', parentId: null, children: [] }];
    else if (path === '/api/knowledge/notes') data = Array.from({ length: 18 }, (_, i) => note(`note-${i + 1}`));
    else if (/^\/api\/knowledge\/notes\/note-\d+$/.test(path)) data = note(path.split('/').at(-1), true);
    else if (/^\/api\/knowledge\/notes\/note-\d+\/link-relations$/.test(path)) data = { noteId: 'note-1', spaceId: 'space-1', contentHash: 'a'.repeat(64), outgoing: [], backlinks: [] };
    else if (path === '/api/knowledge/tags') data = [{ id: 'tag-study', name: '学习' }];
    else if (/^\/api\/knowledge\/(tag-groups|annotations|sources|items|knowledge-points|question-types|questions|search\/notes)$/.test(path)) data = [];
    else if (/^\/api\/knowledge\/notes\/note-\d+\/links$/.test(path)) data = [];
    else if (path === '/api/ai/assistant/alerts') data = [];
    else if (path === '/api/storage/attachments') data = [];
    else if (path === '/api/ai/capabilities') data = { contractVersion: 1, knowledgeExtraction: {
      available: false, executionMode: 'unavailable', executionLocation: 'server', canStart: false,
      canReadJobs: false, reasonCode: 'SYNTHETIC_BASELINE', message: '合成截图不执行提炼任务。' } };
    else if (path === '/api/ai/features') data = { knowledgeProposals: true };
    else if (path === '/api/ai/actions/drafts') data = { accepted: true };
    else if (path === '/api/ai/inbox' || path === '/api/ai/actions') data = [action];
    else if (path === '/api/ai/actions/action-1') data = action;
    else if (path === '/api/storage/attachments/cleanup') data = { items: [], pending: 0 };
    else if (path === '/api/ai/assistant/status') data = { provider: 'deepseek', modelId: 'deepseek-flash', configured: true,
      executionLocation: 'server', generationAvailable: true, unavailableReason: null, budget: null };
    else if (path === '/api/ai/access-policies') data = [];
    else if ([ '/api/ai/conversations', `${conversationRoot}/messages`, `${conversationRoot}/attachments`, `${conversationRoot}/turns/turn-1` ].includes(path)) {
      if (path.endsWith('/messages') && request.method() === 'POST') {
        messages = [{ messageId: 'message-1', turnId: 'turn-1', sequence: 1, role: 'user', content: '请解释梯度下降并给出学习建议。', sourceRefs: [], sourceFree: true, createdAt: date },
          { messageId: 'message-2', turnId: 'turn-1', sequence: 2, role: 'assistant', content: '梯度下降是一种优化方法。\n\n1. 计算当前梯度。\n2. 沿负梯度方向更新参数。\n3. 观察损失是否下降。\n\n这段回答来自合成测试，不调用外部模型。', sourceRefs: [], citations: [], sourceFree: true, createdAt: date }]; data = turn;
      } else if (path.endsWith('/messages')) data = messages;
      else if (path.endsWith('/attachments')) data = { attachments: [] };
      else if (path === `${conversationRoot}/turns/turn-1`) data = turn;
      else if (request.method() === 'POST') { conversation.conversationId = request.postDataJSON().conversationId; turn.conversationId = conversation.conversationId; data = conversation; }
      else data = messages.length ? [conversation] : [];
    } else { blocked.push(`${request.method()} ${path}`); await route.abort('blockedbyclient'); return; }
    await route.fulfill({ json: { data } });
  });
  return { blocked, requests };
}
