import { withWorkspaceStatus } from './helpers/workspace-status.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { startLocalRuntime } from '../../src/runtime-server.mjs';
import { withPageFailureDiagnostics } from '../fixtures/page-failure-diagnostics.mjs';

async function assertVisibleMatch(snippet, query) {
  const visible = await snippet.evaluate((element, needle) => {
    const node = element.firstChild,
      text = element.textContent ?? '',
      offset = text.indexOf(needle);
    if (!node || node.nodeType !== Node.TEXT_NODE || offset < 0) return false;
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + needle.length);
    const bounds = element.getBoundingClientRect(),
      rects = [...range.getClientRects()];
    return (
      rects.length > 0 &&
      rects.every(
        rect =>
          rect.left >= bounds.left - 1 &&
          rect.right <= bounds.right + 1 &&
          rect.top >= bounds.top - 1 &&
          rect.bottom <= bounds.bottom + 1
      )
    );
  }, query);
  assert.equal(visible, true, '正文关键字必须完整落在片段的可见边界内，不能被省略样式截掉。');
}

test('真实生产页面 CmdK：SQLite 未预载长中文正文的可见命中、详情载入与 Enter 打开', { timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-command-search-e2e-'));
  const distRoot = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
  const evidenceRoot = fileURLToPath(new URL('../../../../dist/command-search-evidence/production/', import.meta.url));
  let runtime, browser;
  t.after(async () => {
    try {
      await browser?.close();
    } finally {
      try {
        await runtime?.close();
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });
  runtime = await startLocalRuntime({ dataDirectory: directory, distRoot });
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);

  await withPageFailureDiagnostics(page, async () => {
    const browserProblems = [];
    page.on('console', message => {
      if (['warning', 'error'].includes(message.type())) browserProblems.push(`${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', error => browserProblems.push(error.message));
    // APIRequestContext 与页面共享临时会话，但不会执行页面脚本或启动旧工作区请求。
    const sessionResponse = await page.request.get(runtime.launchUrl);
    assert.equal(sessionResponse.ok(), true, `合成会话 HTTP ${sessionResponse.status()}`);
    const post = async (pathname, data) => {
      const response = await page.request.post(`${runtime.origin}${pathname}`, { data });
      assert.equal(response.ok(), true, `合成夹具 HTTP ${response.status()}：${pathname}`);
      return (await response.json()).data;
    };
    const space = await post('/api/knowledge/spaces/default', {});
    const folder = await post('/api/knowledge/folders', { spaceId: space.id, name: '合成命令目录' });
    const query = '中文深处的合成命中';
    const longMarkdown = match =>
      `开头合成哨兵${'前文内容。'.repeat(160)}\n\n${match}\n\n${'后文内容。'.repeat(160)}末尾合成哨兵`;
    const preloaded = await post('/api/knowledge/notes', {
      id: 'command-preloaded-control',
      spaceId: space.id,
      folderId: folder.id,
      title: '命令搜索预载对照',
      rawMarkdown: longMarkdown('预载对照关键字')
    });
    const deleted = await post('/api/knowledge/notes', {
      spaceId: space.id,
      title: '删除的合成资料',
      rawMarkdown: query
    });
    const deleteResponse = await page.request.delete(`${runtime.origin}/api/knowledge/notes/${deleted.id}`);
    assert.equal(deleteResponse.ok(), true);
    // 桌面不开放创建空间操作，仅在此临时夹具事务中注入另一个同 owner 空间。
    const otherSpace = { ...space, id: 'command-other-space', name: '其他合成空间', defaultFlag: false };
    runtime.store.runTransaction(() => {
      runtime.store.state.spaces.push(otherSpace);
      runtime.store.flush();
    });
    const other = await post('/api/knowledge/notes', {
      spaceId: otherSpace.id,
      title: '其他空间资料',
      rawMarkdown: query
    });

    const fixturePageUrl = page.url();
    assert.equal(fixturePageUrl, 'about:blank');
    const summaryResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return (
        url.origin === runtime.origin &&
        url.pathname === '/api/knowledge/notes' &&
        url.searchParams.get('spaceId') === space.id &&
        url.searchParams.get('summaryOnly') === 'true' &&
        response.request().method() === 'GET'
      );
    });
    await page.goto(runtime.origin);
    await expect(page).toHaveURL(`${runtime.origin}/`);
    const pageSummaryResponse = await summaryResponse;
    assert.equal(pageSummaryResponse.status(), 200);
    assert.equal(pageSummaryResponse.request().frame(), page.mainFrame());
    const summaryPageUrl = page.url();
    const summaries = (await pageSummaryResponse.json()).data;
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page.getByRole('list', { name: '最近编辑' }).getByRole('button').filter({ hasText: preloaded.title })
    ).toBeVisible();
    const summary = summaries.find(item => item.id === preloaded.id);
    assert.equal(summary.summary.length, 240);
    assert.equal(summary.summary.includes(query), false);
    assert.equal('rawMarkdown' in summary || 'plainText' in summary, false);
    const scripts = await page
      .locator('script[src]')
      .evaluateAll(elements => elements.map(element => element.getAttribute('src')));
    assert(scripts.some(src => /^\/assets\/.*\.js$/.test(src)));
    assert.equal(
      scripts.some(src => src.includes('@vite')),
      false
    );

    // 摘要加载后才新增目标 ID，保证 CmdK 必须获取真实详情而不能只依靠预载列表。
    const note = await post('/api/knowledge/notes', {
      id: 'command-synthetic-body',
      spaceId: space.id,
      folderId: folder.id,
      title: '命令搜索合成长正文',
      rawMarkdown: longMarkdown(query)
    });
    assert.equal(
      summaries.some(item => item.id === note.id),
      false
    );
    await expect(page.getByRole('button', { name: note.title, exact: true })).toHaveCount(0);
    const freshSummaries = await page.request.get(
      `${runtime.origin}/api/knowledge/notes?${new URLSearchParams({ spaceId: space.id, summaryOnly: 'true' })}`
    );
    assert.equal(freshSummaries.status(), 200);
    const unseenSummary = (await freshSummaries.json()).data.find(item => item.id === note.id);
    assert.equal(unseenSummary.summary.length, 240);
    assert.equal(unseenSummary.summary.includes(query), false);
    assert.equal('rawMarkdown' in unseenSummary || 'plainText' in unseenSummary, false);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const dialog = page.getByRole('dialog', { name: '全局搜索' });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole('combobox');
    await expect(input).toBeFocused();
    const commandResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return (
        url.pathname === '/api/knowledge/search/notes' &&
        url.searchParams.get('result') === 'command' &&
        url.searchParams.get('query') === query
      );
    });
    await input.fill(query);
    const response = await commandResponse;
    assert.equal(response.status(), 200);
    const payload = await response.json();
    assert.equal(payload.data.length, 1);
    const hit = payload.data[0];
    assert.deepEqual(Object.keys(hit).sort(), ['folderId', 'id', 'snippet', 'title']);
    assert.equal(hit.id, note.id);
    assert(hit.snippet.includes(query));
    assert(hit.snippet.length <= 220);
    assert.equal(
      JSON.stringify(payload).includes('开头合成哨兵') || JSON.stringify(payload).includes('末尾合成哨兵'),
      false
    );
    assert.equal(
      payload.data.some(item => item.id === deleted.id || item.id === other.id),
      false
    );
    await expect(dialog.getByRole('option')).toHaveCount(1);
    await expect(dialog.getByRole('option')).toContainText(note.title);
    await expect(dialog.getByRole('option')).toContainText(query);
    const snippet = dialog.getByText(hit.snippet, { exact: true });
    fs.mkdirSync(evidenceRoot, { recursive: true });
    const productionBuild = JSON.parse(fs.readFileSync(path.join(distRoot, 'build-info.json'), 'utf8'));
    fs.writeFileSync(path.join(evidenceRoot, 'build-info.json'), `${JSON.stringify(productionBuild, null, 2)}\n`);
    await dialog.screenshot({ path: path.join(evidenceRoot, 'command-results.png') });
    await assertVisibleMatch(snippet, query);
    fs.writeFileSync(path.join(evidenceRoot, 'command-http.json'), `${JSON.stringify(payload, null, 2)}\n`);
    await page.setViewportSize({ width: 390, height: 843 });
    await dialog.screenshot({ path: path.join(evidenceRoot, 'command-results-mobile.png') });
    await assertVisibleMatch(snippet, query);
    await page.setViewportSize({ width: 1280, height: 720 });

    let detailRequestCount = 0;
    const detailPath = `/api/knowledge/notes/${encodeURIComponent(note.id)}`;
    page.on('request', request => {
      if (request.method() === 'GET' && new URL(request.url()).pathname === detailPath) detailRequestCount++;
    });
    const detailResponse = page.waitForResponse(
      response => new URL(response.url()).pathname === detailPath && response.request().method() === 'GET'
    );
    await input.press('Enter');
    const detail = await detailResponse;
    assert.equal(detail.status(), 200);
    const loaded = (await detail.json()).data;
    assert.equal(loaded.id, note.id);
    assert.equal(loaded.spaceId, space.id);
    assert.equal(loaded.deleted, false);
    assert.equal(loaded.rawMarkdown, note.rawMarkdown);
    await expect(dialog).toBeHidden();
    const editorUrl = `${runtime.origin}/#/materials/notes/${encodeURIComponent(note.id)}`;
    await expect(page).toHaveURL(editorUrl);
    await expect(page.getByRole('heading', { name: note.title, exact: true })).toBeVisible();
    await expect(page.locator('.ProseMirror')).toContainText(query);
    await withWorkspaceStatus(page, status => expect(status).toContainText(note.title));
    assert.equal(detailRequestCount, 1);
    assert.deepEqual(browserProblems, []);
    fs.writeFileSync(
      path.join(evidenceRoot, 'result.json'),
      `${JSON.stringify(
        {
          driver: 'real-sqlite',
          browser: 'chromium',
          api: 'real-local-runtime-http',
          productionBuild,
          fixturePageUrl,
          summarySource: 'browser-initial-document',
          summaryStatus: pageSummaryResponse.status(),
          summaryRequest: new URL(pageSummaryResponse.url()).pathname + new URL(pageSummaryResponse.url()).search,
          summaryPagePath: new URL(summaryPageUrl).pathname + new URL(summaryPageUrl).hash,
          spaceId: space.id,
          noteId: note.id,
          query,
          responseStatus: response.status(),
          route: new URL(editorUrl).hash,
          targetPreloaded: false,
          detailStatus: detail.status(),
          detailRequestCount,
          visibleViewports: [
            { width: 1280, height: 720 },
            { width: 390, height: 843 }
          ],
          excludedNoteIds: [deleted.id, other.id],
          browserProblems,
          completedAt: new Date().toISOString()
        },
        null,
        2
      )}\n`
    );
  });
});
