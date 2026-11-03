import type { Page } from '@playwright/test';

/** 纯合成资料。所有 AI / 附件请求都在浏览器内模拟，不调用供应商。 */
export async function mockAssistantWorkspace(page: Page) {
  const createdAt = '2026-10-01T00:00:00Z';
  const conversation = { conversationId: 'conversation-1', spaceId: 'space-1', createdAt, updatedAt: createdAt,
    historicalDataset: false, readOnly: false };
  const turn = { turnId: 'turn-1', conversationId: conversation.conversationId, requestedPolicyId: null,
    status: 'succeeded', phase: 'finished', errorCode: null, toolCalls: [], modelAttempts: [] };
  const answer = '## 学习计划\n\n先阅读笔记，再整理重点。\n\n' + Array.from({ length: 30 }, (_, i) => `${i + 1}. 回顾合成例题，记录自己的理解。`).join('\n');
  const messages = [
    { messageId: 'message-1', turnId: turn.turnId, sequence: 1, role: 'user', content: '帮我整理学习计划', sourceRefs: [], sourceFree: true, createdAt },
    { messageId: 'message-2', turnId: turn.turnId, sequence: 2, role: 'assistant', content: answer, sourceRefs: [], citations: [], sourceFree: true, createdAt }
  ];
  const attachment = { attachmentId: 'attachment-1', conversationId: conversation.conversationId, revision: 1,
    fileName: '合成资料.txt', mimeType: 'text/plain', size: 6, sha256: 'a'.repeat(64), storageStatus: 'ready',
    parseStatus: 'not_parsed', errorCode: 'AI_ATTACHMENT_NOT_PARSED', parserVersion: null,
    parsedTextHash: null, imageMetadata: null, removedAt: null, createdAt, updatedAt: createdAt };
  const attachments = [attachment];
  const uploads: Record<string, unknown>[] = [];
  const action = { actionId: 'action-1', requestId: 'synthetic-request', status: 'awaitingApproval', reviewRequired: true,
    errorCode: null, expiresAt: '2030-01-01T00:00:00Z', receipt: null, revision: 1,
    plan: { planHash: 'synthetic-hash', toolName: 'notes_create', items: [{ before: null, after: {
      id: 'new-note', spaceId: 'space-1', title: '合成学习计划', rawMarkdown: '# 一周学习安排\n\n' +
        Array.from({ length: 25 }, (_, i) => `第 ${i + 1} 项：阅读、复习、整理笔记。`).join('\n\n'), folderId: null, tagIds: []
    } }] } };
  const submitted: Record<string, unknown>[] = [];
  await page.route('**/api/ai/assistant/status', route => route.fulfill({ json: { data: {
    provider: 'deepseek', modelId: 'deepseek-flash', configured: true, executionLocation: 'server',
    generationAvailable: true, unavailableReason: null, budget: null
  } } }));
  await page.route('**/api/ai/access-policies**', route => route.fulfill({ json: { data: [] } }));
  await page.route('**/api/ai/conversations**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    let data: unknown = [conversation];
    if (pathname.endsWith('/messages') && request.method() === 'POST') {
      const input = request.postDataJSON(); submitted.push(input);
      messages.push({ ...messages[0], messageId: 'message-3', sequence: 3, content: input.content });
      messages.push({ ...messages[1], messageId: 'message-4', sequence: 4, content: '合成回答：已记录追问。' });
      data = turn;
    } else if (pathname.endsWith('/messages')) data = messages;
    else if (pathname.includes('/turns/')) data = turn;
    else if (pathname.endsWith('/preview')) data = { attachment, segments: [], imageMetadata: null };
    else if (pathname.endsWith('/attachments') && request.method() === 'POST') {
      const input = request.postDataJSON(); uploads.push(input);
      const row = { ...attachment, attachmentId: `upload-${uploads.length}`, fileName: input.fileName, mimeType: input.mimeType };
      attachments.push(row); data = { attachment: row };
    } else if (pathname.endsWith('/attachments')) data = { attachments };
    else if (request.method() === 'POST') data = conversation;
    await route.fulfill({ json: { data } });
  });
  await page.route('**/api/ai/inbox**', route => route.fulfill({ json: { data: [action] } }));
  await page.route('**/api/ai/actions**', route => route.fulfill({ json: { data: [] } }));
  return { messages, submitted, action, uploads };
}
