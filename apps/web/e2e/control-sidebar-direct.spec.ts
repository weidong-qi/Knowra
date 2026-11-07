import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './fixtures/syntheticTest';
import { mockEditorWorkspace } from './fixtures/editorWorkspace';

for (const mode of ['light', 'dark'] as const) {
  for (const mobile of [false, true]) {
    test.describe(`侧栏直接替换 ${mode} ${mobile ? '触屏375' : '桌面'}`, () => {
      test.use({ viewport: mobile ? { width: 375, height: 812 } : { width: 1440, height: 900 }, hasTouch: mobile });
      test('分区与文件夹保留键盘、焦点和重复操作', async ({ page }, info) => {
        await mockEditorWorkspace(page, []);
        await page.route('**/api/ai/model-settings', route =>
          route.fulfill({
            json: {
              data: {
                configured: false,
                modelId: 'deepseek-flash',
                modelSupported: true,
                supportedModelIds: ['deepseek-flash']
              }
            }
          })
        );
        await page.addInitScript(
          mode => localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify({ mode })),
          mode
        );
        await page.goto('/#/materials');
        const sidebar = page.getByRole('complementary', { name: '笔记上下文导航' });
        if (mobile) await page.getByRole('button', { name: '切换侧栏', exact: true }).tap();
        await expect(sidebar).toBeVisible();
        await expect(sidebar.locator('[data-ni-mode]').first()).toHaveAttribute('data-ni-mode', mode);
        for (const name of ['文件夹', '标签']) {
          const toggle = sidebar.getByRole('button', { name, exact: true });
          await tabTo(page, toggle);
          await expect(toggle).toHaveAttribute('data-focus-visible', 'true');
          await expect(toggle).not.toHaveCSS('box-shadow', 'none');
          await page.screenshot({ path: info.outputPath(`${name}-focus.png`), animations: 'disabled' });
          await page.keyboard.press('Enter');
          await expect(toggle).toHaveAttribute('aria-expanded', 'false');
          await expect(toggle).toBeFocused();
          await page.keyboard.press('Space');
          await expect(toggle).toHaveAttribute('aria-expanded', 'true');
          await expect(toggle).toBeFocused();
          if (mobile) {
            await toggle.tap();
            await expect(toggle).toHaveAttribute('aria-expanded', 'false');
            await toggle.tap();
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
          }
        }
        const folder = sidebar.locator('[data-folder-toggle="folder-1"]');
        await tabTo(page, folder);
        await expect(folder).toHaveAttribute('data-focus-visible', 'true');
        await expect(folder).not.toHaveCSS('box-shadow', 'none');
        await page.screenshot({ path: info.outputPath('文件夹展开-focus.png'), animations: 'disabled' });
        await page.keyboard.press('Enter');
        await expect(folder).toHaveAccessibleName('收起工作');
        await expect(folder).toBeFocused();
        await expect(sidebar.getByRole('button', { name: '编辑器验收笔记', exact: true })).toBeVisible();
        await page.keyboard.press('Space');
        await expect(folder).toHaveAccessibleName('展开工作');
        await expect(folder).toBeFocused();
        await expect(sidebar.getByRole('button', { name: '编辑器验收笔记', exact: true })).toHaveCount(0);
        if (mobile) {
          await folder.tap();
          await expect(folder).toHaveAccessibleName('收起工作');
          await folder.tap();
          await expect(folder).toHaveAccessibleName('展开工作');
        }
      });
    });
  }
}

async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate(element => element === document.activeElement)) return;
  }
  await expect(target, '连续 Tab 应可到达目标控件').toBeFocused();
}
