import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './fixtures/syntheticTest';
import { mockEditorWorkspace } from './fixtures/editorWorkspace';

for (const mode of ['light', 'dark'] as const) {
  for (const mobile of [false, true]) {
    test.describe(`路径与大纲 ${mode} ${mobile ? '触屏375' : '桌面'}`, () => {
      test.use({ viewport: mobile ? { width: 375, height: 812 } : { width: 1440, height: 900 }, hasTouch: mobile });
      test.beforeEach(async ({ page }) => {
        const markdown = [
          '# 重复标题',
          ...Array.from({ length: 28 }, (_, index) => `前置段落 ${index + 1} ${'合成内容'.repeat(10)}`),
          '## 重复标题',
          '### 子标题',
          '尾部正文'
        ].join('\n\n');
        await mockEditorWorkspace(page, [], [], markdown);
        await page.addInitScript(
          mode => localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify({ mode })),
          mode
        );
      });

      test('路径祖先保留键盘、触摸导航与当前段语义', async ({ page }, info) => {
        for (const key of ['Enter', 'Space']) {
          await page.goto('/#/materials?folder=folder-1');
          await page.reload();
          await expect(page.getByRole('article', { name: '笔记索引' })).toBeVisible();
          const trigger = page.getByRole('button', { name: '工作区状态', exact: true });
          if (mobile) await trigger.tap();
          else await trigger.click();
          const status = page.getByRole('dialog', { name: '工作区状态', exact: true });
          const parent = status.getByRole('button', { name: '跳转到「笔记库」', exact: true });
          await expect(status.locator('[aria-current="location"]')).toHaveText('工作');
          await tabTo(page, parent);
          await expect(parent).toHaveCSS('outline-style', 'solid');
          if (key === 'Enter')
            await page.screenshot({ path: info.outputPath('path-focus.png'), animations: 'disabled' });
          await page.keyboard.press(key);
          await expect(page).toHaveURL(/#\/materials\?scope=root$/);
          // 导航会移除活动祖先按钮；基线也不能从游离焦点直接 Escape。
          // 此处只验证弹层内的关闭契约，不冒称修复全局焦点恢复缺口。
          await status.press('Escape');
          await expect(status).toBeHidden();
        }
        if (mobile) {
          await page.goto('/#/materials?folder=folder-1');
          await page.reload();
          await page.getByRole('button', { name: '工作区状态', exact: true }).tap();
          await page
            .getByRole('dialog', { name: '工作区状态', exact: true })
            .getByRole('button', { name: '跳转到「笔记库」', exact: true })
            .tap();
          await expect(page).toHaveURL(/#\/materials\?scope=root$/);
        }
      });

      test('大纲重复标题保留层级、键盘定位和触摸操作', async ({ page }, info) => {
        await page.goto('/#/materials/notes/note-1');
        await expect(page.locator('[data-editor-ready]')).toHaveAttribute('data-editor-ready', 'true');
        const trigger = page.getByRole('button', { name: '切换文档检查器', exact: true });
        if (mobile) await trigger.tap();
        else await trigger.click();
        const inspector = page.getByRole('complementary', { name: '文档检查器', exact: true });
        await inspector.getByRole('tab', { name: '大纲', exact: true }).click();
        const rows = inspector.getByRole('navigation', { name: '文档大纲' }).getByRole('button');
        await expect(rows).toHaveCount(3);
        expect(await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-depth')))).toEqual(
          ['0', '1', '2']
        );
        const target = inspector.getByRole('button', { name: '跳转到「重复标题」，H2', exact: true });
        for (const action of mobile ? ['Enter', 'Space', 'tap'] : ['Enter', 'Space']) {
          // 每次先定位另一标题，证明后续操作实际改变正文位置，而不是沿用旧结果。
          await rows.first().click();
          await expect.poll(() => headingInViewport(page, 'h1')).toBe(true);
          await expect.poll(() => headingInViewport(page, 'h2')).toBe(false);
          // 正文中的 Tab 是编辑命令；从真实大纲页签进入列表，避免把 Tab 写进正文。
          await inspector.getByRole('tab', { name: '大纲', exact: true }).focus();
          await tabTo(page, target);
          await expect(target).toHaveCSS('outline-style', 'solid');
          if (action === 'Enter')
            await page.screenshot({ path: info.outputPath('outline-focus.png'), animations: 'disabled' });
          if (action === 'tap') await target.tap();
          else await page.keyboard.press(action);
          await expect.poll(() => headingInViewport(page, 'h2')).toBe(true);
          if (!mobile) {
            await expect.poll(() => selectedHeading(page)).toBe('H2:重复标题');
            await expect(page.locator('.ProseMirror')).toBeFocused();
          } else {
            // 窄屏检查器是模态面板，保留其原有焦点围栏；正文实际滚动需独立验证。
            await expect.poll(() => inspector.evaluate(element => element.contains(document.activeElement))).toBe(true);
          }
        }
        if (mobile) {
          await page.keyboard.press('Escape');
          await expect(page.getByRole('dialog', { name: '文档检查器', exact: true })).toBeHidden();
          await expect(trigger).toBeFocused();
        }
      });
    });
  }
}

async function headingInViewport(page: Page, selector: string) {
  return page.locator('.ProseMirror').evaluate((editor, selector) => {
    const root = editor.closest('[data-editor-scroll-root]');
    const heading = editor.querySelector(selector);
    const bounds = root?.getBoundingClientRect();
    const box = heading?.getBoundingClientRect();
    return Boolean(bounds && box && box.top >= bounds.top - 2 && box.top < bounds.bottom - 24);
  }, selector);
}

async function selectedHeading(page: Page) {
  return page.evaluate(() => {
    const anchor = window.getSelection()?.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    const heading = element?.closest('h1,h2,h3,h4');
    return heading ? `${heading.tagName}:${heading.textContent}` : '';
  });
}

async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate(element => element === document.activeElement)) return;
  }
  await expect(target, '连续Tab应能到达目标').toBeFocused();
}
