import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './fixtures/syntheticTest';
import { mockEditorWorkspace } from './fixtures/editorWorkspace';
import type { KnowledgeItem } from '@study-accelerator/web-core';

const first: KnowledgeItem = {
  id: 'synthetic-first',
  title: '合成知识甲',
  canonicalStatement: '只用于控件回归甲。',
  userExplanation: '',
  knowledgeType: 'concept',
  importance: null,
  reviewStatus: 'candidate',
  sourceMode: 'manual',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
  deletedAt: null
};
const second: KnowledgeItem = {
  ...first,
  id: 'synthetic-second',
  title: '合成知识乙',
  updatedAt: '2026-10-01T00:00:00Z'
};

for (const mode of ['light', 'dark'] as const) {
  for (const mobile of [false, true]) {
    test.describe(`知识普通控件 ${mode} ${mobile ? '触屏375' : '桌面'}`, () => {
      test.use({ viewport: mobile ? { width: 375, height: 812 } : { width: 1440, height: 900 }, hasTouch: mobile });
      let writes: string[];
      test.beforeEach(async ({ page }) => {
        writes = [];
        page.on('request', request => {
          if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method()))
            writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
        });
        await mockEditorWorkspace(page, []);
        await page.route(
          url => /^\/api\/knowledge\/(?:spaces\/[^/]+\/)?items(?:\/[^/]+)?$/.test(url.pathname),
          route => {
            const url = new URL(route.request().url());
            const data = url.pathname.endsWith('/items')
              ? [first, second]
              : url.pathname.endsWith(first.id)
                ? first
                : second;
            return route.fulfill({ json: { data } });
          }
        );
        await page.addInitScript(
          mode => localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify({ mode })),
          mode
        );
      });
      test.afterEach(() => expect(writes, '普通控件导航不能写入任何API').toEqual([]));

      test('知识列表/卡片保留分组、键盘快捷键、菜单和选择', async ({ page }, info) => {
        for (const view of ['list', 'card']) {
          await page.goto('/#/knowledge');
          await page.evaluate(
            view =>
              localStorage.setItem(
                'knowra:knowledge-index-display:v1',
                JSON.stringify({
                  view,
                  group: 'status',
                  sort: 'updated-desc',
                  properties: { statement: false, status: false, type: false, updated: false }
                })
              ),
            view
          );
          await page.reload();
          const list = page.getByRole('region', { name: '知识列表内容', exact: true });
          const group = list.getByRole('button', { name: /^候选\s*2$/ });
          await tabTo(page, group);
          await expect(group).toHaveCSS('outline-style', 'solid');
          await page.screenshot({ path: info.outputPath(`${view}-group-focus.png`), animations: 'disabled' });
          await page.keyboard.press('Enter');
          await expect(group).toHaveAttribute('aria-expanded', 'false');
          await page.keyboard.press('Space');
          await expect(group).toHaveAttribute('aria-expanded', 'true');
          if (mobile) {
            await group.tap();
            await expect(group).toHaveAttribute('aria-expanded', 'false');
            await group.tap();
            await expect(group).toHaveAttribute('aria-expanded', 'true');
          }
          const a = list.getByRole('button', { name: first.title, exact: true });
          const b = list.getByRole('button', { name: second.title, exact: true });
          await tabTo(page, a);
          await expect(a).toHaveCSS('outline-style', 'solid');
          await page.screenshot({ path: info.outputPath(`${view}-item-focus.png`), animations: 'disabled' });
          await page.keyboard.press('j');
          await expect(b).toBeFocused();
          await page.keyboard.press('k');
          await expect(a).toBeFocused();
          await page.keyboard.press('Shift+F10');
          const menu = page.getByRole('menu', { name: '知识操作', exact: true });
          await expect(menu).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(menu).toBeHidden();
          await expect(a).toBeFocused();
          for (const action of ['Enter', 'Space', mobile ? 'tap' : 'click']) {
            if (action === 'Enter' || action === 'Space') await tabTo(page, a);
            if (action === 'tap') await a.tap();
            else if (action === 'click') await a.click();
            else await page.keyboard.press(action);
            await expect(page).toHaveURL(/#\/knowledge\?item=synthetic-first$/);
            await expect(page.getByRole('heading', { name: first.title, exact: true })).toBeVisible();
            // 既有路由策略将焦点交给主舞台；单独用真实Tab进入列表验证父层Escape。
            await expect(page.locator('#feature-stage')).toBeFocused();
            await tabTo(page, a);
            await page.keyboard.press('Escape');
            await expect(page).toHaveURL(/#\/knowledge$/);
          }
        }
      });

      for (const kind of ['item-list', 'neighbors', 'concept-links'] as const) {
        test(`图谱${kind}普通详情按钮保留激活和Escape传播`, async ({ page }, info) => {
          for (const action of ['Enter', 'Space', mobile ? 'tap' : 'click']) {
            const { target, panel, expected } = await graphTarget(page, kind);
            if (action === 'Enter' || action === 'Space') {
              await tabTo(page, target);
              await expect(target).toHaveCSS('outline-style', 'solid');
              if (action === 'Enter')
                await page.screenshot({ path: info.outputPath(`${kind}-focus.png`), animations: 'disabled' });
            }
            if (action === 'tap') await target.tap();
            else if (action === 'click') await target.click();
            else await page.keyboard.press(action);
            await expect(panel.getByRole('heading', { level: 2, name: expected, exact: true })).toBeVisible();
          }
          const { target } = await graphTarget(page, kind);
          await tabTo(page, target);
          await page.keyboard.press('Escape');
          await expect(page.getByRole('heading', { name: '怎么看这张图', exact: true })).toBeVisible();
        });
      }
    });
  }
}

async function graphTarget(page: Page, kind: 'item-list' | 'neighbors' | 'concept-links') {
  await page.goto('/#/knowledge/graph');
  await page.reload();
  await page.getByRole('button', { name: /^向量，/ }).click();
  const panel = page.getByRole('region', { name: '详情', exact: true });
  if (kind === 'concept-links') {
    await panel.getByRole('button', { name: /^向量是一维张量/ }).click();
    return { panel, target: panel.getByRole('button', { name: '向量', exact: true }), expected: '向量' };
  }
  return kind === 'item-list'
    ? { panel, target: panel.getByRole('button', { name: /^向量是一维张量/ }), expected: '向量是一维张量' }
    : { panel, target: panel.getByRole('list').nth(1).getByRole('button', { name: /张量/ }).first(), expected: '张量' };
}

async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 180; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate(element => element === document.activeElement)) return;
  }
  await expect(target, 'Tab必须可到达实际普通按钮').toBeFocused();
}
