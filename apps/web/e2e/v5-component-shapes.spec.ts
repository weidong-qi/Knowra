import { expect } from '@playwright/test';
import { test } from './fixtures/syntheticTest';
import { mockEditorWorkspace } from './fixtures/editorWorkspace';

for (const mode of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`${mode} ${width}px：胶囊操作与小圆角内容共存`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await mockEditorWorkspace(page, []);
      await page.route(url => url.pathname === '/api/knowledge/items', route => route.fulfill({ json: { data: [{
        id: 'shape-knowledge', title: '形状验收知识', canonicalStatement: '卡片承载多行内容，应保持小圆角矩形。',
        userExplanation: '', knowledgeType: 'concept', reviewStatus: 'candidate', sourceMode: 'manual', importance: null,
        createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', deletedAt: null
      }] } }));
      await page.addInitScript(mode => {
        localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify({ mode, theme: 'orange', shape: 'pill' }));
        localStorage.setItem('knowra:knowledge-index-display:v1', JSON.stringify({ view: 'card' }));
      }, mode);

      await page.goto('/#/materials');
      const index = page.getByRole('article', { name: '笔记索引' });
      const toolbar = index.getByRole('toolbar', { name: '笔记索引工具栏' });
      const create = toolbar.getByRole('button', { name: '新建', exact: true });
      await expect(create).toHaveCSS('border-radius', '999px');
      if (width === 1440) {
        const group = toolbar.getByRole('group', { name: '视图切换' });
        await expect(group).toHaveCSS('border-radius', '999px');
        const cardView = group.getByRole('button', { name: '卡片视图' });
        await expect(cardView).toHaveCSS('border-radius', '999px');
        await cardView.click();
      } else {
        await toolbar.getByRole('button', { name: /^显示选项/ }).click();
        const cardView = page.getByRole('group', { name: '布局' }).getByRole('button', { name: '卡片', exact: true });
        await expect(cardView).toHaveCSS('border-radius', '999px');
        await cardView.click();
        await page.keyboard.press('Escape');
      }
      await expect(index.locator('[data-index-primary]').first()).toHaveCSS('border-radius', '12px');
      await page.screenshot({ path: info.outputPath('notes-shapes.png'), animations: 'disabled' });

      // 目录选中背景使用小圆角；窄屏通过现有面板开关打开同一目录。
      const sidebar = page.getByRole('complementary', { name: '笔记上下文导航' });
      if (width === 390) await page.getByRole('button', { name: '切换侧栏' }).click();
      await expect(sidebar.locator('[aria-current="page"]').first()).toHaveCSS('border-radius', '7px');
      if (width === 390) await page.keyboard.press('Escape');

      await create.click();
      const menu = page.getByRole('menu', { name: '新建', exact: true });
      await expect(menu).toBeVisible();
      await expect(menu).toHaveCSS('border-radius', '10px');
      await expect(menu.getByRole('menuitem').first()).toHaveCSS('border-radius', '7px');
      await page.keyboard.press('Escape');
      await expect(create).toBeFocused();

      await page.goto('/#/materials/notes/note-1');
      const tab = page.getByRole('tab', { name: '编辑器验收笔记', exact: true });
      await expect(tab).toHaveCSS('border-radius', '8px');
      await expect(tab.locator('..')).toHaveCSS('border-radius', '8px');
      await expect(page.locator('.ProseMirror').first()).toBeVisible();
      await page.screenshot({ path: info.outputPath('editor-shapes.png'), animations: 'disabled' });

      await page.goto('/#/knowledge');
      const knowledge = page.getByRole('list', { name: '知识卡片视图' }).getByRole('button', { name: /形状验收知识/ });
      await expect(knowledge).toHaveCSS('border-radius', '12px');
      await knowledge.focus();
      await expect(knowledge).toBeFocused();
      await expect(page.getByRole('button', { name: '新建知识候选' })).toHaveCSS('border-radius', '999px');
      await page.screenshot({ path: info.outputPath('knowledge-shapes.png'), animations: 'disabled' });

      await page.goto('/#/showcase');
      await expect(page.getByRole('button', { name: '默认胶囊', exact: true })).toHaveCSS('border-radius', '999px');
      await expect(page.getByRole('button', { name: '小圆角矩形', exact: true })).toHaveCSS('border-radius', '7px');
      await expect(page.getByRole('textbox', { name: '标题', exact: true }).locator('..')).toHaveCSS('border-radius', '7px');
      await expect(page.getByRole('tab', { name: '概览', exact: true })).toHaveCSS('border-radius', '8px');
    });
  }
}
