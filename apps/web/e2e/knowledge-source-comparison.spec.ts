import { expect, test, type Page } from '@playwright/test';
import type { KnowledgeEvidence, KnowledgeItem, NoteVersion } from '@study-accelerator/web-core';

const item: KnowledgeItem = {
  id: 'k-synthetic', title: '合成资料：样本增强', canonicalStatement: '通过变换样本扩充训练数据。',
  userExplanation: '仅用于训练阶段。', knowledgeType: 'concept', reviewStatus: 'candidate', sourceMode: 'annotation',
  importance: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', deletedAt: null
};
const evidence: KnowledgeEvidence = {
  id: 'e-synthetic', knowledgeItemId: item.id, sourceType: 'annotation', sourceId: 'a-synthetic', annotationId: 'a-synthetic',
  noteId: 'n-synthetic', noteVersionId: 'v-synthetic-old', quoteText: '样本的旋转与翻转能够扩充训练集。',
  headingPath: ['样本操作'], relationType: 'supports', status: 'stale', applicabilityStatus: 'needsReview',
  sourceAnnotationRemoved: true, createdAt: item.createdAt, updatedAt: item.updatedAt
};
const version: NoteVersion = {
  id: 'v-synthetic-old', noteId: 'n-synthetic', content: '# 历史训练资料\n\n样本的旋转与翻转能够扩充训练集。\n\n历史附注：只针对训练样本。',
  contentHash: 'a'.repeat(64), createdAt: item.createdAt, createdBy: 'user'
};

async function mockSources(page: Page, options: {
  item?: KnowledgeItem; evidence?: KnowledgeEvidence; version?: NoteVersion; failFirstVersion?: boolean;
} = {}) {
  const record = options.evidence ?? evidence;
  const knowledge = options.item ?? item;
  const historical = options.version ?? version;
  const reads: string[] = [];
  const writes: string[] = [];
  const remoteRequests: string[] = [];
  let versionRequests = 0;
  // 所有 API 都由合成 fixture 响应；外站请求阻断，不连接任何实际资料库。
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      remoteRequests.push(request.url());
      return route.abort();
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 405, json: { error: { code: 'SYNTHETIC_READ_ONLY', message: '页面验收只允许读取' } } });
    }
    let data: unknown = [];
    if (url.pathname === '/api/knowledge/spaces') data = [{ id: 'space-synthetic', name: '临时合成空间', defaultFlag: true }];
    else if (url.pathname === '/api/knowledge/notes') data = [{ id: 'n-synthetic', spaceId: 'space-synthetic', title: '当前训练资料', folderId: null, tagIds: [], rawMarkdown: '', contentLoaded: false, favorite: false, deleted: false }];
    else if (url.pathname === '/api/knowledge/notes/n-synthetic') data = { id: 'n-synthetic', spaceId: 'space-synthetic', title: '当前训练资料', folderId: null, tagIds: [], rawMarkdown: '# 当前训练资料\n当前修改后的正文。', contentLoaded: true, favorite: false, deleted: false, updatedAt: item.updatedAt };
    else if (url.pathname.endsWith('/items')) data = [knowledge];
    else if (url.pathname.endsWith(`/items/${item.id}`)) data = knowledge;
    else if (url.pathname.endsWith(`/items/${item.id}/evidence`)) data = [record];
    else if (url.pathname.endsWith(`/items/${item.id}/provenance`)) data = { artifactId: item.id, state: 'absent', record: null, sources: [] };
    else if (url.pathname.includes('/versions/')) {
      reads.push(url.pathname);
      versionRequests++;
      if (options.failFirstVersion && versionRequests === 1) return route.fulfill({ status: 404, json: { error: { code: 'NOTE_VERSION_NOT_FOUND', message: 'NoteVersion not found' } } });
      data = historical;
    }
    await route.fulfill({ json: { data } });
  });
  return { reads, writes, remoteRequests };
}

async function openComparison(page: Page) {
  await page.goto(`/#/knowledge?item=${item.id}`);
  await page.getByRole('button', { name: '对照来源', exact: true }).click();
  return page.getByRole('dialog', { name: '来源对照', exact: true });
}

test('候选与历史来源并列核对，独立显示健康和适用性，Esc归还焦点', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const requests = await mockSources(page);
  await page.goto(`/#/knowledge?item=${item.id}`);
  await expect(page.getByRole('button', { name: '确认知识' })).toBeDisabled();
  const trigger = page.getByRole('button', { name: '对照来源', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '来源对照', exact: true });
  await expect(dialog.getByRole('region', { name: '待核对知识' })).toContainText(item.canonicalStatement);
  await expect(dialog.getByRole('region', { name: '保存的来源' })).toContainText(evidence.quoteText);
  await expect(dialog.getByText('需复核', { exact: true })).toBeVisible();
  await expect(dialog.getByText('适用性待核对', { exact: true })).toBeVisible();
  await expect(dialog.getByText('原标注已移除', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('历史版本正文')).toHaveText(version.content);
  await page.screenshot({ path: testInfo.outputPath('knowledge-source-comparison-1440.png'), animations: 'disabled' });
  expect(requests.reads).toEqual(['/api/knowledge/notes/n-synthetic/versions/v-synthetic-old']);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(requests.writes).toEqual([]);
});

test('历史版本缺失保留摘录，重试只读取绑定版本', async ({ page }, testInfo) => {
  const requests = await mockSources(page, { failFirstVersion: true });
  const dialog = await openComparison(page);
  await expect(dialog.getByRole('alert')).toContainText('历史版本暂不可用');
  await expect(dialog.getByRole('region', { name: '保存的来源' })).toContainText(evidence.quoteText);
  await page.screenshot({ path: testInfo.outputPath('knowledge-source-unavailable.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: '重试历史版本' }).click();
  await expect(dialog.getByLabel('历史版本正文')).toHaveText(version.content);
  expect(requests.reads).toEqual(Array(2).fill('/api/knowledge/notes/n-synthetic/versions/v-synthetic-old'));
  expect(requests.writes).toEqual([]);
});

test('撤回适用性后仍可读取来源历史，归档知识保留只读对照', async ({ page }, testInfo) => {
  const requests = await mockSources(page, { item: { ...item, reviewStatus: 'archived' }, evidence: { ...evidence, status: 'valid', applicabilityStatus: 'withdrawn' } });
  const dialog = await openComparison(page);
  await expect(dialog.getByText('来源可用', { exact: true })).toBeVisible();
  await expect(dialog.getByText('已撤回适用性', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('历史版本正文')).toHaveText(version.content);
  await expect(dialog.getByRole('button', { name: '确认知识' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('knowledge-source-withdrawn.png'), animations: 'disabled' });
  expect(requests.writes).toEqual([]);
});

test('回收站中的知识仍可对照历史，打开当前笔记关闭对照并导航', async ({ page }) => {
  const requests = await mockSources(page, { item: { ...item, deletedAt: item.updatedAt } });
  const dialog = await openComparison(page);
  await expect(dialog.getByLabel('历史版本正文')).toHaveText(version.content);
  await dialog.getByRole('button', { name: '打开当前笔记' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#\/materials\/notes\/n-synthetic$/);
  expect(requests.writes).toEqual([]);
});

test('手动来源没有版本时展示保存摘录，不请求任意历史或当前正文', async ({ page }) => {
  const requests = await mockSources(page, { evidence: { ...evidence, sourceType: 'manual', noteId: null, noteVersionId: null, annotationId: null, applicabilityStatus: 'active', status: 'valid', sourceAnnotationRemoved: false } });
  const dialog = await openComparison(page);
  await expect(dialog.getByText(/手动来源未绑定笔记历史版本/)).toBeVisible();
  await expect(dialog.getByRole('region', { name: '保存的来源' })).toContainText(evidence.quoteText);
  await expect(dialog.getByRole('button', { name: '打开当前笔记' })).toHaveCount(0);
  expect(requests.reads).toEqual([]);
  expect(requests.writes).toEqual([]);
});

test('390px长内容可滚动且不横向溢出，历史Markdown不会执行外部图片或脚本', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const content = `${version.content}\n\n${'长历史正文。'.repeat(300)}\n<img src="https://external.invalid/tracker"><script>window.bad=true</script>`;
  const requests = await mockSources(page, { item: { ...item, title: `${item.title}：${'长知识标题'.repeat(12)}` }, version: { ...version, content } });
  const dialog = await openComparison(page);
  await expect(dialog.getByLabel('历史版本正文')).toHaveText(content);
  await expect(dialog.getByRole('img')).toHaveCount(0);
  const overflow = await dialog.evaluate(element => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  const footer = dialog.getByRole('button', { name: '关闭', exact: true });
  await expect(footer).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('knowledge-source-comparison-390.png'), animations: 'disabled' });
  await dialog.getByLabel('历史版本正文').evaluate(element => element.parentElement?.parentElement?.scrollTo(0, 10000));
  await expect(dialog.getByLabel('历史版本正文')).toContainText('<img src=');
  expect(requests.remoteRequests).toEqual([]);
  expect(requests.writes).toEqual([]);
  await footer.click();
  await expect(dialog).toHaveCount(0);
});
