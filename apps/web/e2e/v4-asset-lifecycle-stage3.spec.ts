import { expect, test } from '@playwright/test';

test('阶段3 训练页展示四类资产、回收与受阻清理引用', async ({ page }) => {
  await page.route('**/api/storage/**', route => route.fulfill({ json: { data: [] } }));
  let question = { id: 'stage3-question', stem: '导数的几何意义是什么？', questionType: 'shortAnswer', reviewStatus: 'draft', learningObjectiveIds: [], deletedAt: null as string | null, updatedAt: '2026-09-24T00:00:00.000Z' };
  await page.route('**/api/knowledge/**', async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === '/api/knowledge/spaces') data = [{ id: 'space-1', name: '主空间', defaultFlag: true }];
    else if (url.pathname === '/api/knowledge/questions') data = [question];
    else if (url.pathname.endsWith('/stage3-question/trash')) {
      question = { ...question, deletedAt: '2026-09-24T00:00:01.000Z', updatedAt: '2026-09-24T00:00:01.000Z' };
      data = question;
    } else if (url.pathname.endsWith('/stage3-question/purge-preview')) data = {
      asset: { type: 'question', id: question.id }, decision: 'requires-dependency-action', expectedUpdatedAt: question.updatedAt,
      references: [{ collection: 'analysisScopeSnapshots', id: 'scope-1', action: 'retain-or-resolve-history' }], exclusiveRecords: {}, coverage: {}
    };
    await route.fulfill({ json: { data } });
  });
  await page.goto('/#/training');
  await expect(page.getByRole('heading', { name: '试题库' })).toBeVisible();
  await expect(page.getByRole('heading', { name: question.stem })).toBeVisible();
  await page.getByRole('button', { name: '删除…' }).click();
  await page.getByRole('dialog', { name: '删除题目？' }).getByRole('button', { name: '移入回收站' }).click();
  await expect(page.getByRole('dialog', { name: '删除题目？' })).toBeHidden();
  await page.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复' })).toBeVisible();
  await page.getByRole('button', { name: '永久清理…' }).click();
  const dialog = page.getByRole('dialog', { name: '永久清理题目？' });
  await expect(dialog.getByText(/scope-1/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '确认永久清理' })).toBeDisabled();
});

test('阶段3 清理预检可跳到阻断清理的关联题目', async ({ page }) => {
  await page.route('**/api/storage/**', route => route.fulfill({ json: { data: [] } }));
  await page.route('**/api/knowledge/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (pathname === '/api/knowledge/spaces') data = [{ id: 'space-1', name: '主空间', defaultFlag: true }];
    else if (pathname === '/api/knowledge/learning-objectives') data = [{ id: 'objective-1', objective: '解释导数', reviewStatus: 'candidate', deletedAt: '2026-09-24T00:00:01.000Z', updatedAt: '2026-09-24T00:00:01.000Z' }];
    else if (pathname === '/api/knowledge/questions') data = [{ id: 'question-1', stem: '导数的几何意义是什么？', reviewStatus: 'draft', deletedAt: null, updatedAt: '2026-09-24T00:00:00.000Z' }];
    else if (pathname === '/api/knowledge/learning-objectives/objective-1/purge-preview') data = {
      asset: { type: 'learningObjective', id: 'objective-1' }, decision: 'requires-dependency-action', expectedUpdatedAt: '2026-09-24T00:00:01.000Z',
      references: [{ collection: 'questionObjectives', id: 'link-1', action: 'rebind-question-objective', relatedAsset: { kind: 'question', id: 'question-1' } }], exclusiveRecords: {}, coverage: {}
    };
    await route.fulfill({ json: { data } });
  });
  await page.goto('/#/training');
  await page.getByRole('button', { name: '学习目标', exact: true }).click();
  await page.getByRole('button', { name: '回收站', exact: true }).click();
  await page.getByRole('button', { name: '永久清理…' }).click();
  await page.getByRole('dialog', { name: '永久清理学习目标？' }).getByRole('button', { name: '查看题目' }).click();
  await expect(page.getByRole('heading', { name: '导数的几何意义是什么？' })).toBeVisible();
});
