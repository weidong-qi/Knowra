import { expect, test } from '@playwright/test';

test('阶段2 空间管理展示迁移预检、默认外壳保护与确认范围', async ({ page }) => {
  await page.route('**/api/storage/**', route => route.fulfill({ json: { data: [] } }));
  const spaces = [
    { id: 'space-default', userId: 'demo', name: '默认空间', defaultFlag: true, updatedAt: '2026-09-23T00:00:00.000Z' },
    { id: 'space-empty', userId: 'demo', name: '空空间', defaultFlag: false, updatedAt: '2026-09-23T00:00:00.000Z' }
  ];
  await page.route('**/api/knowledge/**', async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === '/api/knowledge/spaces') data = spaces;
    else if (url.pathname.endsWith('/deletion-preflight')) data = {
      asset: { type: 'knowledgeSpace', id: 'space-default' }, operation: 'delete-empty-container',
      decision: 'system-shell-protected', expectedUpdatedAt: spaces[0].updatedAt, references: [], systemGroupIds: [], coverage: {}
    };
    else if (url.pathname.endsWith('/migration-preview')) data = {
      sourceSpaceId: 'space-default', targetSpaceId: 'space-empty', previewHash: 'preview-1',
      decision: 'can-migrate', blockers: [], counts: { notes: 2, folders: 1, tags: 3, annotations: 1, analysisScopes: 0 }, coverage: {}
    };
    await route.fulfill({ json: { data } });
  });
  await page.goto('/#/materials/spaces');
  await expect(page.getByRole('heading', { name: '空间管理' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '默认空间' })).toBeVisible();
  await page.getByRole('article').filter({ hasText: '默认空间' }).getByRole('button', { name: '删除预览' }).click();
  await expect(page.getByText('默认空间外壳不可删除，可以迁移其中的自有内容。')).toBeVisible();
  await expect(page.getByRole('button', { name: '确认永久删除' })).toBeDisabled();
  await page.getByRole('button', { name: '返回' }).click();
  await expect(page.getByRole('button', { name: '预览迁移' })).toBeDisabled();
  await page.getByRole('button', { name: '目标空间' }).click();
  await page.getByRole('option', { name: '空空间' }).click();
  await page.getByRole('button', { name: '预览迁移' }).click();
  await expect(page.getByText('笔记 2、目录 1、标签 3、标注 1、保存范围 0。')).toBeVisible();
  await expect(page.getByRole('button', { name: '确认整包迁移' })).toBeEnabled();
});

test('阶段2 知识点永久删除先展示专属来源与保留范围', async ({ page }) => {
  await page.route('**/api/storage/**', route => route.fulfill({ json: { data: [] } }));
  let item = {
    id: 'knowledge-stage2', title: '待清理的测试知识', canonicalStatement: '测试定义', userExplanation: '',
    knowledgeType: 'concept', importance: null, reviewStatus: 'candidate', sourceMode: 'manual',
    createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z', deletedAt: null as string | null
  };
  let purged = false;
  await page.route('**/api/knowledge/**', async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname.endsWith('/spaces')) data = [{ id: 'space-1', name: '主空间', defaultFlag: true }];
    else if (url.pathname.endsWith('/folders/tree') || url.pathname.endsWith('/tags') || url.pathname.endsWith('/tag-groups') || url.pathname.endsWith('/notes')) data = [];
    else if (url.pathname.endsWith('/items')) data = purged ? [] : [item];
    else if (url.pathname.endsWith(`/items/${item.id}/evidence`)) data = [{ id: 'evidence-1', knowledgeItemId: item.id, sourceType: 'manual', quoteText: '专属来源', status: 'valid', applicabilityStatus: 'active' }];
    else if (url.pathname.endsWith(`/items/${item.id}/trash`)) {
      item = { ...item, deletedAt: '2026-09-23T01:00:00.000Z', updatedAt: '2026-09-23T01:00:00.000Z' };
      data = item;
    } else if (url.pathname.endsWith(`/items/${item.id}/purge-preview`)) data = {
      asset: { type: 'knowledgeItem', id: item.id }, operation: 'permanent-delete', decision: 'can-purge-no-history',
      expectedUpdatedAt: item.updatedAt, exclusiveRecords: { knowledgeEvidenceIds: ['evidence-1'] }, references: [], coverage: {}
    };
    else if (url.pathname.endsWith(`/items/${item.id}/permanent`)) { purged = true; data = { status: 'subject-purged', asset: { type: 'knowledgeItem', id: item.id }, exclusiveRecordsDeleted: { knowledgeEvidence: 1 }, offlineDevices: 'pending-sync', backups: 'retention-managed' }; }
    else if (url.pathname.endsWith(`/items/${item.id}`)) data = item;
    await route.fulfill({ json: { data } });
  });
  await page.goto('/#/knowledge?item=knowledge-stage2');
  await expect(page.getByRole('heading', { name: '待清理的测试知识' })).toBeVisible();
  await page.getByRole('button', { name: '移入回收站' }).click();
  await page.getByRole('button', { name: '确认移入回收站' }).click();
  await page.getByRole('button', { name: '永久删除…' }).click();
  await expect(page.getByText('将清理 1 条专属来源记录。')).toBeVisible();
  await expect(page.getByText('来源笔记和标注不会删除；离线设备待同步，备份按保留策略处理。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '确认永久删除' }).click();
  await expect(page.getByRole('heading', { name: '待清理的测试知识' })).toHaveCount(0);
  expect(purged).toBe(true);
});
