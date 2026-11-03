import { expect, test } from '@playwright/test';

test('阶段1 知识点回收站保留来源历史并可恢复', async ({ page }) => {
  await page.route('**/api/storage/**', route => route.fulfill({ json: { data: [] } }));
  let item = {
    id: 'knowledge-stage1', title: '生命周期验收知识', canonicalStatement: '经过人工核对的陈述', userExplanation: '',
    knowledgeType: 'concept', importance: null, reviewStatus: 'confirmed', sourceMode: 'annotation',
    createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z', deletedAt: null as string | null
  };
  const evidence = {
    id: 'evidence-stage1', knowledgeItemId: item.id, sourceType: 'manual', noteId: null, noteVersionId: null, annotationId: null,
    sourceId: null, quoteText: '保留的来源摘录', headingPath: [], relationType: 'supports', status: 'valid', applicabilityStatus: 'active',
    createdAt: item.createdAt, updatedAt: item.updatedAt
  };
  await page.route('**/api/knowledge/**', async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname.endsWith('/spaces')) data = [{ id: 'space-1', name: '主空间' }];
    else if (url.pathname.endsWith('/folders/tree') || url.pathname.endsWith('/tags') || url.pathname.endsWith('/tag-groups') || url.pathname.endsWith('/notes')) data = [];
    else if (url.pathname.endsWith('/items')) data = [item];
    else if (url.pathname.endsWith(`/items/${item.id}/evidence`)) data = [evidence];
    else if (url.pathname.endsWith(`/items/${item.id}/trash`)) {
      item = { ...item, deletedAt: '2026-09-23T01:00:00.000Z', updatedAt: '2026-09-23T01:00:00.000Z' };
      data = item;
    } else if (url.pathname.endsWith(`/items/${item.id}/restore-deleted`)) {
      item = { ...item, deletedAt: null, updatedAt: '2026-09-23T02:00:00.000Z' };
      data = item;
    } else if (url.pathname.endsWith(`/items/${item.id}`)) data = item;
    await route.fulfill({ json: { data } });
  });
  await page.goto('/#/knowledge?item=knowledge-stage1');
  await expect(page.getByRole('heading', { name: '生命周期验收知识' })).toBeVisible();
  await expect(page.getByRole('region', { name: '知识来源' })).toContainText('保留的来源摘录');
  await page.getByRole('button', { name: '移入回收站' }).click();
  await page.getByRole('button', { name: '确认移入回收站' }).click();
  await expect(page.getByRole('button', { name: '从回收站恢复' })).toBeVisible();
  await expect(page.getByRole('region', { name: '知识来源' })).toContainText('保留的来源摘录');
  await page.getByRole('button', { name: '从回收站恢复' }).click();
  await expect(page.getByRole('button', { name: '移入回收站' })).toBeVisible();
});
