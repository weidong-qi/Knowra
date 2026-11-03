import { expect, type Locator } from '@playwright/test';
import { test } from './fixtures/syntheticTest';
import { mockEditorWorkspace } from './fixtures/editorWorkspace';

const appearanceKey = 'knowra:notes-index-appearance:v1';

async function expectMaterial(menu: Locator, material: 'glass' | 'acrylic', mode: 'light' | 'dark', width: number) {
  await expect(menu).toBeVisible();
  const scope = menu.locator('xpath=ancestor-or-self::*[@data-overlay-material][1]');
  await expect(scope).toHaveAttribute('data-overlay-material', material);
  await expect(scope).toHaveAttribute('data-ni-mode', mode);
  // 验证实际绘制层，不能仅凭 portal 上的数据属性认定材质生效。
  await expect(menu).toHaveCSS('backdrop-filter', material === 'glass' ? 'blur(14px) saturate(1.45)' : 'blur(28px) saturate(1.65)');
  await expect(menu).toHaveCSS('background-image', /linear-gradient/);
  expect(await menu.evaluate(element => Boolean(element.closest('#feature-stage')))).toBe(false);
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
}

for (const width of [1440, 390]) {
  test(`${width}px：材质切换、明暗、刷新和菜单子菜单焦点回归`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await mockEditorWorkspace(page, []);
    await page.route('**/api/ai/model-settings', route => route.fulfill({ json: { data: { configured: false, modelId: 'deepseek-flash', modelSupported: true, supportedModelIds: ['deepseek-flash'] } } }));
    await page.addInitScript(key => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ mode: 'light', overlayMaterial: 'glass' }));
    }, appearanceKey);
    await page.goto('/#/settings');
    const trigger = page.getByRole('button', { name: '预览菜单', exact: true });
    const shell = page.locator('[data-ni-mode]:has(> #feature-stage)');
    const backgrounds = new Map<string, string>();
    for (const mode of ['light', 'dark'] as const) {
      if (mode === 'dark') await page.getByRole('button', { name: '切换深色模式' }).click();
      for (const material of ['acrylic', 'glass'] as const) {
        const choice = page.getByRole('group', { name: '浮层材质' }).getByRole('button', { name: material === 'glass' ? '通透玻璃' : '磨砂亚克力', exact: true });
        await choice.click();
        await expect(choice).toHaveAttribute('aria-pressed', 'true');
        await expect(shell).toHaveAttribute('data-overlay-material', material);
        expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), appearanceKey)).toMatchObject({ mode, overlayMaterial: material });
        await page.reload();
        await expect(choice).toHaveAttribute('aria-pressed', 'true');
        await expect(shell).toHaveAttribute('data-ni-mode', mode);
        await trigger.click();
        const menu = page.getByRole('menu', { name: '预览菜单', exact: true });
        await expectMaterial(menu, material, mode, width);
        backgrounds.set(`${mode}-${material}`, await menu.evaluate(element => getComputedStyle(element).backgroundImage));
        await expect(menu.getByRole('menuitem', { name: '不可用选项' })).toHaveAttribute('aria-disabled', 'true');
        const status = menu.getByRole('menuitem', { name: '状态', exact: true });
        await status.click();
        // React Aria 使用父菜单项为子菜单提供可访问名称。
        const submenu = page.getByRole('menu', { name: '状态', exact: true });
        await expectMaterial(submenu, material, mode, width);
        await expect(submenu.getByRole('menuitem')).toHaveText(['草稿', '进行中', '已完成']);
        await page.screenshot({ path: info.outputPath(`${mode}-${material}-submenu.png`), animations: 'disabled' });
        // 指针打开子菜单时焦点仍在父项，Escape 从父菜单关闭整组。
        await expect(status).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(submenu).toBeHidden();
        await expect(menu).toBeHidden();
        await expect(trigger).toBeFocused();
        await page.keyboard.press('Space');
        await expect(menu).toBeVisible();
        await expect(status).toBeFocused();
        // 键盘进入子菜单后，向左和 Escape 都只关闭子级并将焦点归还父项。
        for (const closeKey of ['ArrowLeft', 'Escape']) {
          await page.keyboard.press('ArrowRight');
          await expectMaterial(submenu, material, mode, width);
          await expect(submenu.getByRole('menuitem', { name: '草稿', exact: true })).toBeFocused();
          await page.keyboard.press(closeKey);
          await expect(submenu).toBeHidden();
          await expect(menu).toBeVisible();
          await expect(status).toBeFocused();
        }
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(trigger).toBeFocused();
      }
    }
    expect(new Set(backgrounds.values()).size).toBe(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
