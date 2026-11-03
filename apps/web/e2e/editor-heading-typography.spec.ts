import { expect, type Locator } from '@playwright/test';
import { test } from './fixtures/syntheticTest';
import { mockEditorWorkspace } from './fixtures/editorWorkspace';
import { openEditorToolbarMenu } from '../../../scripts/test-support/editor-menu.mjs';

const markdown = [
  '# 这是一级标题', '## 这是二级标题', '### 这是三级标题',
  '#### 这是四级标题', '##### 这是五级标题', '###### 这是六级标题 **加粗**',
  '这是普通的正文文字', '**这是加粗的正文文字**'
].join('\n\n');

async function checkTypography(editor: Locator, fontSize: number) {
  await expect(editor).toHaveCSS('font-size', `${fontSize}px`);
  for (const [index, ratio] of [2.25, 1.75, 1.5, 1.25, 1, 1].entries()) {
    const heading = editor.locator(`h${index + 1}`);
    await expect(heading).toHaveCSS('font-size', `${fontSize * ratio}px`);
    await expect(heading).toHaveCSS('border-bottom-width', '0px');
  }
  await expect(editor.locator('p strong')).toHaveCSS('font-size', `${fontSize}px`);
  const headingColor = await editor.locator('h5').evaluate(element => getComputedStyle(element).color);
  const mutedColor = await editor.locator('h6').evaluate(element => getComputedStyle(element).color);
  expect(mutedColor).not.toBe(headingColor);
  await expect(editor.locator('h6 strong')).toHaveCSS('color', mutedColor);
  // 实际主题纸面上的 H6 仍须达到普通文字对比度，不能只验证“变灰”。
  const contrast = await editor.locator('h6').evaluate(element => {
    const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (color: string) => rgb(color).map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(getComputedStyle(element.closest('[data-pdf-document]')!).backgroundColor);
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
}

for (const mode of ['light', 'dark'] as const) {
  test(`正文六级标题在${mode}主题、阅读与源码预览中保持字号层级`, async ({ page }, info) => {
    await mockEditorWorkspace(page, [], [], markdown);
    await page.addInitScript(mode => {
      localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify({ mode, theme: 'orange', shape: 'rounded', deco: 'off' }));
    }, mode);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('/#/materials/notes/note-1');
    const editor = page.locator('.ProseMirror');
    await expect(editor.locator('h6')).toHaveText('这是六级标题 加粗');
    await checkTypography(editor, 15);
    await info.attach(`heading-${mode}`, { body: await editor.screenshot(), contentType: 'image/png' });

    await openEditorToolbarMenu(page, '视图');
    await page.getByRole('menuitem', { name: '阅读模式', exact: true }).click();
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await checkTypography(editor, 15);

    await openEditorToolbarMenu(page, '视图');
    await page.getByRole('menuitem', { name: '显示源码编辑器', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown 源码编辑器' })).toBeVisible();
    await checkTypography(editor, 15);

    // 直接覆盖已有正文令牌，验证字号定制，不假设产品提供字号设置 UI。
    await editor.evaluate(element => (element as HTMLElement).style.setProperty('--note-font-size', '20px'));
    await checkTypography(editor, 20);
    await page.setViewportSize({ width: 390, height: 844 });
    await checkTypography(editor, 20);
    await info.attach(`heading-${mode}-narrow`, { body: await editor.screenshot(), contentType: 'image/png' });
    await editor.evaluate(element => (element as HTMLElement).style.setProperty('--note-heading-4-size', '1.4em'));
    await expect(editor.locator('h4')).toHaveCSS('font-size', '28px');
  });
}
