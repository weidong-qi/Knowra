import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './fixtures/syntheticTest';
import { mockEditorWorkspace } from './fixtures/editorWorkspace';

for (const mode of ['light', 'dark'] as const) {
  for (const mobile of [false, true]) {
    test.describe(`状态弹层焦点 ${mode} ${mobile ? '触屏375' : '桌面'}`, () => {
      test.use({ viewport: mobile ? { width: 375, height: 812 } : { width: 1440, height: 900 }, hasTouch: mobile });
      test.beforeEach(async ({ page }) => {
        await mockEditorWorkspace(page, []);
        await page.addInitScript(
          mode => localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify({ mode })),
          mode
        );
      });

      test('祖先导航关闭陈旧弹层、恢复焦点且重开Escape有效', async ({ page }, info) => {
        for (const action of ['Enter', 'Space', mobile ? 'tap' : 'click']) {
          await page.goto('/#/materials?folder=folder-1');
          await page.reload();
          await expect(page.getByRole('article', { name: '笔记索引' })).toBeVisible();
          const trigger = page.getByRole('button', { name: '工作区状态', exact: true });
          if (mobile) await trigger.tap();
          else await trigger.click();
          const dialog = page.getByRole('dialog', { name: '工作区状态', exact: true });
          const parent = dialog.getByRole('button', { name: '跳转到「笔记库」', exact: true });
          if (action === 'Enter' || action === 'Space') await tabTo(page, parent);
          if (action === 'tap') await parent.tap();
          else if (action === 'click') await parent.click();
          else await page.keyboard.press(action);
          await expect(page).toHaveURL(/#\/materials\?scope=root$/);
          await expect(dialog).toBeHidden();
          await expect(trigger).toBeFocused();
          // 直接使用全局键盘，不能靠locator.press/focus补救产品焦点。
          await page.keyboard.press('Enter');
          await expect(dialog).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(dialog).toBeHidden();
          await expect(trigger).toBeFocused();
          if (action === 'Enter')
            await page.screenshot({ path: info.outputPath('navigation-focus-restored.png'), animations: 'disabled' });
        }
      });

      test('外部hash和前后退关闭旧弹层，反复重开不遗留焦点', async ({ page }) => {
        await page.goto('/#/materials?folder=folder-1');
        const trigger = page.getByRole('button', { name: '工作区状态', exact: true });
        const dialog = page.getByRole('dialog', { name: '工作区状态', exact: true });
        const open = async () => {
          if (mobile) await trigger.tap();
          else await trigger.click();
          await expect(dialog).toBeVisible();
        };
        const closed = async () => {
          await expect(dialog).toBeHidden();
          await expect(trigger).toBeFocused();
        };
        await open();
        await page.evaluate(() => {
          window.location.hash = '/materials?scope=root';
        });
        await expect(page).toHaveURL(/#\/materials\?scope=root$/);
        await closed();
        await open();
        await page.goBack();
        await expect(page).toHaveURL(/#\/materials\?folder=folder-1$/);
        await closed();
        await open();
        await page.goForward();
        await expect(page).toHaveURL(/#\/materials\?scope=root$/);
        await closed();
      });

      test('未导航时全局Escape仍关闭且可重复开启', async ({ page }) => {
        await page.goto('/#/materials?folder=folder-1');
        const trigger = page.getByRole('button', { name: '工作区状态', exact: true });
        for (let index = 0; index < 2; index += 1) {
          if (mobile) await trigger.tap();
          else await trigger.click();
          const dialog = page.getByRole('dialog', { name: '工作区状态', exact: true });
          await tabTo(page, dialog.getByRole('button', { name: '跳转到「笔记库」', exact: true }));
          await page.keyboard.press('Escape');
          await expect(dialog).toBeHidden();
          await expect(trigger).toBeFocused();
          await expect(page).toHaveURL(/#\/materials\?folder=folder-1$/);
        }
      });
    });
  }
}

async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 30; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate(element => element === document.activeElement)) return;
  }
  await expect(target).toBeFocused();
}
