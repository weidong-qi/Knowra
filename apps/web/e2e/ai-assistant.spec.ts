import { test } from './fixtures/syntheticTest';
import { expect } from '@playwright/test';
import { mockShellServices } from './fixtures/shellServices';

test.beforeEach(async ({ page }) => { await mockShellServices(page); });

test('对话主页面可不选笔记直接提问，并在刷新和移动端恢复消息', async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  let messages: unknown[] = [];
  const conversation = { conversationId: 'conversation-1', spaceId: 'space-1',
    createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
    historicalDataset: false, readOnly: false };
  const turn = { turnId: 'turn-1', conversationId: conversation.conversationId, requestedPolicyId: null,
    status: 'succeeded', phase: 'finished', errorCode: null, toolCalls: [], modelAttempts: [] };
  await page.route('**/api/ai/actions**', route => route.fulfill({ json: { data: [] } }));
  await page.route('**/api/ai/inbox**', route => route.fulfill({ json: { data: [] } }));
  await page.route('**/api/ai/assistant/status', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ data: { provider: 'deepseek', modelId: 'deepseek-flash',
      configured: true, executionLocation: 'server', generationAvailable: true, unavailableReason: null, budget: null } }) }));
  await page.route('**/api/ai/access-policies**', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
  await page.route('**/api/ai/conversations**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    let data: unknown;
    if (url.pathname.endsWith('/messages') && request.method() === 'POST') {
      submitted = request.postDataJSON();
      messages = [
        { messageId: 'message-1', turnId: 'turn-1', sequence: 1, role: 'user', content: '解释梯度下降',
          sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt },
        { messageId: 'message-2', turnId: 'turn-1', sequence: 2, role: 'assistant', content: '梯度下降是一种优化方法。',
          sourceRefs: [], citations: [], sourceFree: true, createdAt: conversation.createdAt }
      ];
      data = turn;
    } else if (url.pathname.endsWith('/messages')) data = messages;
    else if (url.pathname.endsWith('/attachments')) data = { attachments: [] };
    else if (url.pathname.includes('/turns/')) data = turn;
    else if (request.method() === 'POST') {
      conversation.conversationId = request.postDataJSON().conversationId;
      turn.conversationId = conversation.conversationId;
      data = conversation;
    }
    else data = messages.length ? [conversation] : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
  await page.route('**/api/knowledge/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (pathname.endsWith('/spaces')) data = [{ id: 'space-1', name: '主空间' }];
    else if (pathname.endsWith('/notes')) data = [{ id: 'note-1', title: '笔记 A',
      spaceId: 'space-1', folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '',
      contentLoaded: false, favorite: false, deleted: false }];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
  await page.goto('/#/assistant?new=1');
  await expect(page.getByRole('heading', { name: 'AI 助手', exact: true })).toBeVisible();
  await expect(page.getByText('服务器执行')).toBeVisible();
  await expect(page.getByRole('heading', { name: '和你的笔记聊聊' })).toBeVisible();
  await test.info().attach('欢迎态', { body: await page.screenshot(), contentType: 'image/png' });
  const composer = page.getByLabel('提问区');
  const inputBounds = await page.getByRole('textbox', { name: '消息' }).boundingBox();
  const composerBounds = await composer.boundingBox();
  expect(inputBounds?.width).toBeGreaterThan(550);
  expect(composerBounds?.height).toBeLessThan(210);
  await page.getByRole('textbox', { name: '消息' }).focus();
  expect(await page.getByRole('textbox', { name: '消息' }).evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
  await page.getByRole('textbox', { name: '消息' }).fill('解释梯度下降');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('梯度下降是一种优化方法。')).toBeVisible();
  await test.info().attach('回答态', { body: await page.screenshot(), contentType: 'image/png' });
  expect(submitted).toMatchObject({ content: '解释梯度下降', requestedPolicyId: null, execute: true });
  await page.reload();
  await expect(page.getByText('梯度下降是一种优化方法。')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 843 });
  await expect(page.getByText('菜单', { exact: true })).toBeVisible();
  expect((await page.getByLabel('提问区').boundingBox())?.height).toBeLessThan(220);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByText('菜单', { exact: true }).click();
  const history = page.getByRole('dialog', { name: '最近对话' });
  await expect(history.getByText('最近对话')).toBeVisible();
  await expect(history.getByRole('button', { name: '解释梯度下降' })).toBeVisible();
  await history.getByRole('button', { name: '关闭菜单' }).click();
  await expect(page.getByRole('navigation', { name: '移动端模块导航' }).getByRole('button', { name: '资料' })).toBeVisible();
  expect(submitted).not.toHaveProperty('writeIntent');
  await expect(page.getByRole('button', { name: '资料范围：普通聊天' })).toBeVisible();
  expect((await page.getByLabel('提问区').boundingBox())?.height).toBeLessThan(220);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});

test('助手模块加载失败只影响助手页面，仍可返回笔记', async ({ page }) => {
  let blockedModules = 0;
  await page.route(/(?:\/src\/features\/assistant\/AssistantView\.tsx|\/assets\/AssistantView-[^/]+\.js)(?:\?.*)?$/, route => { blockedModules++; return route.abort(); });
  await page.route('**/api/knowledge/**', async route => {
    const data = new URL(route.request().url()).pathname.endsWith('/spaces')
      ? [{ id: 'space-1', name: '主空间' }] : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
  await page.goto('/#/assistant');
  await expect(page.getByRole('heading', { name: 'AI 助手暂时不可用' })).toBeVisible();
  expect(blockedModules).toBeGreaterThan(0);
  await page.getByRole('button', { name: '返回笔记' }).click();
  await expect(page).toHaveURL(/#\/materials$/);
  await expect(page.getByRole('navigation', { name: '工作域导航' })).toBeVisible();
});

for (const close of [false, true]) {
  test(`引用原文校验迟到不会${close ? '在关闭后重开预览' : '覆盖后选来源'}`, async ({ page }) => {
    // 延迟第一份真实 SHA-256，按完成计数等候，不靠时间碰撞复现乱序。
    await page.addInitScript(() => {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      const state = { release: null as (() => void) | null, started: 0, completed: 0 };
      Object.assign(window, { sourceDigest: state });
      crypto.subtle.digest = async (...args: Parameters<SubtleCrypto['digest']>) => {
        if (++state.started === 1) await new Promise<void>(resolve => { state.release = resolve; });
        const result = await digest(...args);
        state.completed++;
        return result;
      };
    });
    const conversation = { conversationId: 'source-conversation', spaceId: 'space-1',
      createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z', historicalDataset: false, readOnly: false };
    const version = { id: 'version-1', noteId: 'note-1', content: '前文 alpha 后文',
      contentHash: 'e1ad18f75b0295b8a3845a76fc8e148b8eef2107f58336fe9bca6a23ebb608d6' };
    const first = { noteId: 'note-1', noteVersionId: version.id, contentHash: version.contentHash,
      start: 3, end: 8, quoteHash: '8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8' };
    const second = { ...first, start: 9, end: 11, quoteHash: '30bc60d288a5cf9c0e04bfd90351fa771abf3520b8f812a8123da21e19f39a0d' };
    await page.route('**/api/ai/inbox**', route => route.fulfill({ json: { data: [] } }));
    await page.route('**/api/ai/access-policies**', route => route.fulfill({ json: { data: [] } }));
    await page.route('**/api/ai/conversations**', async route => {
      const path = new URL(route.request().url()).pathname;
      const data = path.endsWith('/messages') ? [{ messageId: 'answer', turnId: 'turn', sequence: 1,
        role: 'assistant', content: '合成引用回答', citations: [first, second], sourceRefs: [], sourceFree: false, createdAt: conversation.createdAt }]
        : path.includes('/turns/') ? { turnId: 'turn', conversationId: conversation.conversationId, status: 'succeeded', phase: 'finished',
          requestedPolicyId: null, errorCode: null, toolCalls: [], modelAttempts: [] }
          : path.endsWith('/attachments') ? { attachments: [] } : [conversation];
      await route.fulfill({ json: { data } });
    });
    await page.route('**/api/knowledge/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const data = path.endsWith('/spaces') ? [{ id: 'space-1', name: '合成空间' }]
        : path.endsWith('/versions/version-1') ? version
          : path.endsWith('/notes') ? [{ id: 'note-1', title: '笔记 A', spaceId: 'space-1', folderId: null, tagIds: [],
            internalLinks: [], rawMarkdown: '', contentLoaded: false, favorite: false, deleted: false }] : [];
      await route.fulfill({ json: { data } });
    });
    await page.goto('/#/assistant?conversationId=source-conversation');
    await page.getByRole('button', { name: /来源 1 · 笔记 A/ }).click();
    await page.waitForFunction(() => Boolean((window as unknown as { sourceDigest: { release: unknown } }).sourceDigest.release));
    await page.getByRole('button', { name: /来源 2 · 笔记 A/ }).click();
    const preview = page.getByRole('region', { name: '引用原文定位' });
    await expect(preview.locator('mark')).toHaveText('后文');
    if (close) await page.getByRole('button', { name: '关闭原文' }).click();
    await page.evaluate(() => (window as unknown as { sourceDigest: { release(): void } }).sourceDigest.release());
    await page.waitForFunction(() => (window as unknown as { sourceDigest: { completed: number } }).sourceDigest.completed === 4);
    if (close) await expect(preview).toHaveCount(0);
    else await expect(preview.locator('mark')).toHaveText('后文');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}
