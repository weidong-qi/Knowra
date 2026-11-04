import { test } from './fixtures/syntheticTest';
import { expect, type Page } from '@playwright/test';
import { createNote, mockEditorWorkspace } from './fixtures/editorWorkspace';

const historicalMarkdown = '合成历史正文，恢复和另存必须使用这个快照。';
const version = { id: 'saved-actions-version', noteId: 'note-1', content: historicalMarkdown,
  contentHash: 'b'.repeat(64), createdAt: '2026-09-01T01:00:00.000Z', createdBy: 'user' };

async function workspace(page: Page) {
  await mockEditorWorkspace(page, [], [], '已保存的合成正文');
  let markdown = '已保存的合成正文';
  let revision = 0;
  let release!: () => void;
  const firstSave = new Promise<void>(resolve => { release = resolve; });
  const events: Array<{ kind: string; markdown: string }> = [];
  let saveRequests = 0;
  let previews = 0;
  let copies = 0;
  const unexpectedWrites: string[] = [];
  const assistantNavigations: string[] = [];
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame() && new URL(frame.url()).hash.startsWith('#/assistant')) assistantNavigations.push(frame.url());
  });
  // 专用动作路由以外的写请求一律阻断，不能由基础 fixture 的读接口兜底吞掉。
  await page.route('**/api/**', async route => {
    if (!['GET', 'HEAD'].includes(route.request().method()) && !(route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/knowledge/notes')) {
      unexpectedWrites.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      return route.abort('blockedbyclient');
    }
    await route.fallback();
  });
  // 应用会持久化恢复草稿；精确模拟既有端点，不开放其它 AI 写请求。
  await page.route(url => url.pathname === '/api/ai/actions/drafts', route => route.request().method() === 'POST'
    ? route.fulfill({ json: { data: { accepted: true } } }) : route.fallback());
  await page.route(url => url.pathname === '/api/knowledge/notes/note-1', async route => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { rawMarkdown: string };
      events.push({ kind: 'save-request', markdown: body.rawMarkdown });
      if (++saveRequests === 1) await firstSave;
      markdown = body.rawMarkdown; revision++;
      events.push({ kind: 'save-complete', markdown });
    }
    await route.fulfill({ json: { data: { ...createNote(markdown, true), updatedAt: `2026-10-11T01:00:${String(revision).padStart(2, '0')}.000Z` } } });
  });
  await page.route(url => url.pathname === '/api/knowledge/notes/note-1/versions', route => route.fulfill({ json: { data: { items: [version], total: 1, nextCursor: null } } }));
  await page.route(url => url.pathname === `/api/knowledge/notes/note-1/versions/${version.id}`, route => route.fulfill({ json: { data: version } }));
  await page.route(url => url.pathname === '/api/knowledge/notes', async route => {
    if (route.request().method() === 'POST') {
      copies++;
      events.push({ kind: 'copy', markdown: String(route.request().postDataJSON().rawMarkdown) });
    }
    await route.fallback();
  });
  await page.route(url => url.pathname === '/api/knowledge/analysis-scopes/preview', async route => {
    previews++;
    expect(route.request().postDataJSON()).toEqual({ spaceId: 'space-1', mode: 'all', noteIds: ['note-1'] });
    events.push({ kind: 'preview', markdown });
    await route.fulfill({ json: { data: { spaceId: 'space-1', mode: 'all', previewHash: 'synthetic-preview',
      summary: { noteCount: 1, segmentCount: 1, annotationCount: 0 },
      segments: [{ noteId: 'note-1', noteVersionId: `saved-${revision}`, start: 0, end: markdown.length, markdown, annotationIds: [] }], omittedItems: [], ai: { available: false } } } });
  });
  return { events, release, unexpectedWrites, assistantNavigations, saveRequests: () => saveRequests, previews: () => previews, copies: () => copies };
}

async function openEditor(page: Page, source = true) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/#/materials/notes/note-1');
  await expect(page.locator('[data-editor-ready]')).toHaveAttribute('data-editor-ready', 'true');
  if (source) {
    await page.getByRole('button', { name: '视图', exact: true }).click();
    await page.getByRole('menuitem', { name: '显示源码编辑器', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown 源码编辑器' })).toBeVisible();
  }
  const inspector = page.getByRole('complementary', { name: '文档检查器', exact: true });
  if (!await inspector.isVisible()) await page.getByRole('button', { name: '切换文档检查器', exact: true }).click();
  return inspector;
}

for (const action of ['restore', 'saveAs'] as const) {
  test(`保存后动作：历史${action === 'restore' ? '恢复' : '另存'}先保存当前源码，后使用历史快照且只执行一次`, async ({ page }, info) => {
    const state = await workspace(page);
    const inspector = await openEditor(page);
    const source = page.getByRole('textbox', { name: 'Markdown 源码编辑器' });
    await source.fill('历史操作之前必须保存的合成源码');
    await expect.poll(state.saveRequests).toBe(1);
    await inspector.getByRole('tab', { name: '记录', exact: true }).click();
    const history = inspector.getByRole('region', { name: '历史记录', exact: true });
    await history.getByRole('button', { name: /历史正文/ }).click();
    await expect(history.getByRole('article', { name: '版本正文预览' })).toContainText(historicalMarkdown);
    if (action === 'restore') {
      await history.getByRole('button', { name: '恢复此版本', exact: true }).click();
      await page.getByRole('dialog', { name: '恢复历史正文', exact: true }).getByRole('button', { name: '确认恢复', exact: true }).click();
    } else await history.getByRole('button', { name: '另存为新笔记', exact: true }).click();
    expect(state.events).toEqual([{ kind: 'save-request', markdown: '历史操作之前必须保存的合成源码' }]);
    expect(state.copies()).toBe(0);
    state.release();
    if (action === 'restore') {
      await expect(page.getByRole('dialog', { name: '恢复历史正文', exact: true })).toBeHidden();
      await expect(source).toHaveValue(historicalMarkdown);
      await expect.poll(() => state.events).toEqual([
        { kind: 'save-request', markdown: '历史操作之前必须保存的合成源码' },
        { kind: 'save-complete', markdown: '历史操作之前必须保存的合成源码' },
        // 已有自动保存挂起时，显式保存按 autosave 合同再次排队；两笔都须先于历史动作确认。
        { kind: 'save-request', markdown: '历史操作之前必须保存的合成源码' },
        { kind: 'save-complete', markdown: '历史操作之前必须保存的合成源码' },
        { kind: 'save-request', markdown: historicalMarkdown },
        { kind: 'save-complete', markdown: historicalMarkdown }
      ]);
    } else {
      await expect(page).toHaveURL(/#\/materials\/notes\/note-copy$/);
      expect(state.copies()).toBe(1);
      expect(state.events).toEqual([
        { kind: 'save-request', markdown: '历史操作之前必须保存的合成源码' },
        { kind: 'save-complete', markdown: '历史操作之前必须保存的合成源码' },
        // 已有自动保存挂起时，显式保存按 autosave 合同再次排队；两笔都须先于历史动作确认。
        { kind: 'save-request', markdown: '历史操作之前必须保存的合成源码' },
        { kind: 'save-complete', markdown: '历史操作之前必须保存的合成源码' },
        { kind: 'copy', markdown: historicalMarkdown }
      ]);
    }
    expect(state.unexpectedWrites).toEqual([]);
    await info.attach('saved-action-order', { body: JSON.stringify(state.events), contentType: 'application/json' });
  });
}

test('保存后动作：分析预览等待富文本保存，服务端读取的内容等于最新已保存正文', async ({ page }, info) => {
  const state = await workspace(page);
  const inspector = await openEditor(page, false);
  const editor = page.locator('.ProseMirror');
  await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' 分析前新增内容');
  await inspector.getByRole('tab', { name: 'AI', exact: true }).click();
  await inspector.getByRole('button', { name: '分析整篇', exact: true }).click();
  await expect.poll(state.saveRequests).toBe(1);
  expect(state.previews()).toBe(0);
  state.release();
  await expect(page.getByRole('dialog', { name: '确认分析范围' })).toContainText('分析前新增内容');
  expect(state.previews()).toBe(1);
  expect(state.events.map(event => event.kind)).toEqual(['save-request', 'save-complete', 'preview']);
  expect(state.events[2].markdown).toBe(state.events[0].markdown);
  expect(state.unexpectedWrites).toEqual([]);
  await info.attach('saved-analysis-order', { body: JSON.stringify(state.events), contentType: 'application/json' });
});

for (const change of ['typing', 'switch'] as const) {
  test(`保存后动作：助手等待保存期间${change === 'typing' ? '继续输入' : '切换笔记'}，晚回执不能跳转`, async ({ page }, info) => {
    const state = await workspace(page);
    const inspector = await openEditor(page);
    const source = page.getByRole('textbox', { name: 'Markdown 源码编辑器' });
    await source.fill('助手请求前的草稿 A');
    await expect.poll(state.saveRequests).toBe(1);
    await inspector.getByRole('tab', { name: 'AI', exact: true }).click();
    await inspector.getByRole('button', { name: '让 AI 提炼知识点', exact: true }).click();
    if (change === 'typing') await source.fill('助手请求后继续输入 B');
    else {
      await page.evaluate(() => { window.location.hash = '/materials/notes/note-2'; });
      await expect(page.getByRole('textbox', { name: '笔记标题', exact: true })).toHaveValue('关联验收笔记');
    }
    const response = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/api/knowledge/notes/note-1');
    state.release();
    await (await response).finished();
    // 等待真实响应对应的 promise 回调和 React 绘制，避免在迟到跳转执行前做否定断言。
    await page.evaluate(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });
    if (change === 'typing') {
      await expect(inspector.getByRole('alert')).toContainText('保存期间笔记或草稿已变化，请确认内容后重试。');
      await expect(source).toHaveValue('助手请求后继续输入 B');
      await expect(page).toHaveURL(/#\/materials\/notes\/note-1$/);
    } else {
      await expect(page).toHaveURL(/#\/materials\/notes\/note-2$/);
      await expect(source).toHaveValue('第二篇正文');
    }
    expect(state.copies()).toBe(0); expect(state.previews()).toBe(0);
    expect(state.assistantNavigations).toEqual([]); expect(state.unexpectedWrites).toEqual([]);
    await info.attach('stale-assistant-save', { body: JSON.stringify(state.events), contentType: 'application/json' });
  });
}
