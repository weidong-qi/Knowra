import { expect, test, type Page } from '@playwright/test';
import type { KnowledgeItem } from '@study-accelerator/web-core';

const item: KnowledgeItem = { id: 'synthetic-k1', title: '合成知识条目', canonicalStatement: '仅用于交互回归。', userExplanation: '', knowledgeType: 'concept', importance: null, reviewStatus: 'candidate', sourceMode: 'manual', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', deletedAt: null };

async function mockWorkspace(page: Page) {
  let current = { ...item };
  const writes: { action: string; body: unknown }[] = [];
  const attempts = new Map<string, number>();
  let version = 1;
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (request.method() !== 'GET') {
      const action = url.pathname.split('/').at(-1)!;
      writes.push({ action, body: request.postDataJSON() });
      const count = (attempts.get(action) ?? 0) + 1;
      attempts.set(action, count);
      if (count === 1) return route.fulfill({ status: 503, json: { error: { code: 'SYNTHETIC_RETRY', message: '合成连接失败，请重试' } } });
      if (action === 'archive') current = { ...current, reviewStatus: 'archived' };
      else if (action === 'restore') current = { ...current, reviewStatus: 'candidate' };
      else if (action === 'trash') current = { ...current, deletedAt: current.updatedAt };
      else if (action === 'restore-deleted') current = { ...current, deletedAt: null };
      else return route.fulfill({ status: 405, json: { error: { code: 'SYNTHETIC_DENIED', message: '未授权的合成操作' } } });
      current = { ...current, updatedAt: `2026-10-01T00:00:0${version++}Z` };
      return route.fulfill({ json: { data: current } });
    }
    let data: unknown = [];
    if (url.pathname === '/api/knowledge/spaces') data = [{ id: 'synthetic-space', name: '合成空间', defaultFlag: true }];
    else if (url.pathname.endsWith('/items')) data = [current];
    else if (url.pathname.endsWith(`/items/${item.id}`)) data = current;
    else if (url.pathname.endsWith('/provenance')) data = { artifactId: item.id, state: 'absent', record: null, sources: [] };
    await route.fulfill({ json: { data } });
  });
  return writes;
}

async function openMenu(page: Page) {
  await page.getByRole('region', { name: '知识列表内容', exact: true }).getByRole('button', { name: /合成知识条目/ }).click({ button: 'right' });
  return page.getByRole('menu', { name: '知识操作', exact: true });
}
async function filter(page: Page, name: RegExp) {
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByRole('menuitemradio', { name }).click();
  await page.keyboard.press('Escape');
}

test('知识右键写入失败保留重试入口，归档菜单查看、关闭和重开不崩溃', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const writes = await mockWorkspace(page);
  await page.goto('/#/knowledge');
  await (await openMenu(page)).getByRole('menuitem', { name: '归档', exact: true }).click();
  const archive = page.getByRole('dialog', { name: '归档这条知识？', exact: true });
  await archive.getByRole('button', { name: '确认归档' }).click();
  await expect(archive.getByRole('alert')).toContainText('合成连接失败');
  await archive.getByRole('button', { name: '确认归档' }).click();
  await expect(archive).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '知识已归档' })).toBeVisible();
  await filter(page, /已归档/);
  await openMenu(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: '知识操作' })).toHaveCount(0);
  const outsideMenu = await openMenu(page);
  await expect(outsideMenu).toBeVisible();
  // 模态 Popover 将背景设为 inert；实际外部点击落在遮罩，而不是穿透点击标题。
  const heading = page.getByRole('heading', { name: '知识库', exact: true, includeHidden: true });
  await expect(heading).toBeVisible();
  const headingBox = await heading.boundingBox();
  const menuBox = await outsideMenu.boundingBox();
  expect(headingBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  if (!headingBox || !menuBox) throw new Error('无法确认菜单外点击位置');
  const outsidePoint = { x: headingBox.x + headingBox.width / 2, y: headingBox.y + headingBox.height / 2 };
  expect(outsidePoint.x < menuBox.x || outsidePoint.x > menuBox.x + menuBox.width
    || outsidePoint.y < menuBox.y || outsidePoint.y > menuBox.y + menuBox.height).toBe(true);
  await page.mouse.click(outsidePoint.x, outsidePoint.y);
  await expect(page.getByRole('menu', { name: '知识操作' })).toHaveCount(0);
  await (await openMenu(page)).getByRole('menuitem', { name: '查看详情' }).click();
  await expect(page.getByRole('heading', { name: item.title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭详情' }).click();
  await (await openMenu(page)).getByRole('menuitem', { name: '恢复为候选' }).click();
  await expect(page.getByRole('alert')).toContainText('合成连接失败');
  await (await openMenu(page)).getByRole('menuitem', { name: '恢复为候选' }).click();
  await expect(page.getByText('已恢复为候选，请重新核对后确认。', { exact: true })).toBeVisible();
  await filter(page, /全部未归档/);
  await (await openMenu(page)).getByRole('menuitem', { name: '移入回收站' }).click();
  const trash = page.getByRole('dialog', { name: '移入知识回收站？', exact: true });
  await trash.getByRole('button', { name: '确认移入回收站' }).click();
  await expect(trash.getByRole('alert')).toContainText('合成连接失败');
  await trash.getByRole('button', { name: '确认移入回收站' }).click();
  await expect(trash).toHaveCount(0);
  await expect(page.getByText('知识已移入回收站。', { exact: true })).toBeVisible();
  await filter(page, /回收站/);
  await (await openMenu(page)).getByRole('menuitem', { name: '从回收站恢复' }).click();
  await expect(page.getByRole('alert')).toContainText('合成连接失败');
  await (await openMenu(page)).getByRole('menuitem', { name: '从回收站恢复' }).click();
  await expect(page.getByText('知识已从回收站恢复；审核与来源已重新校验。', { exact: true })).toBeVisible();
  expect(writes.map(write => write.action)).toEqual(['archive', 'archive', 'restore', 'restore', 'trash', 'trash', 'restore-deleted', 'restore-deleted']);
  expect(writes.map(write => write.body)).toEqual([
    { expectedUpdatedAt: item.updatedAt }, { expectedUpdatedAt: item.updatedAt },
    { expectedUpdatedAt: '2026-10-01T00:00:01Z' }, { expectedUpdatedAt: '2026-10-01T00:00:01Z' },
    { expectedUpdatedAt: '2026-10-01T00:00:02Z' }, { expectedUpdatedAt: '2026-10-01T00:00:02Z' },
    { expectedUpdatedAt: '2026-10-01T00:00:03Z' }, { expectedUpdatedAt: '2026-10-01T00:00:03Z' }
  ]);
  expect(errors).toEqual([]);
});
