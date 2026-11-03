import { expect, type Locator } from '@playwright/test';
import { test } from './fixtures/syntheticTest';
import { mockEditorWorkspace } from './fixtures/editorWorkspace';

const markdown = '| 参数 | 范围 |\n| --- | --- |\n| brightness | 0.1 |\n| contrast | 0.2 |\n| saturation | 0.3 |\n| hue | 0.4 |\n';
const values = ['参数', '范围', 'brightness', '0.1', 'contrast', '0.2', 'saturation', '0.3', 'hue', '0.4'];

async function focusCell(cell: Locator) {
  await cell.evaluate(element => {
    (element.closest('[contenteditable]') as HTMLElement).focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

for (const direction of ['上方', '下方']) {
  for (const index of [0, 1, 4, 5, 8, 9]) {
    test(`表格第 ${index + 1} 格右键在${direction}插入段落保持整表且能继续输入`, async ({ page }) => {
      const saved: string[] = [];
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await mockEditorWorkspace(page, saved, [], markdown);
      await page.goto('/#/materials/notes/note-1');
      await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
      const editor = page.locator('.ProseMirror');
      const cells = editor.locator('th, td');
      await expect(cells).toHaveText(values);
      await focusCell(cells.nth(index));
      await cells.nth(index).click({ button: 'right' });
      const menu = page.getByRole('menu', { name: '编辑器右键快捷功能', exact: true });
      await menu.getByRole('menuitem', { name: '插入', exact: true }).hover();
      await page.getByRole('menu', { name: '插入', exact: true })
        .getByRole('menuitem', { name: `在${direction}插入段落`, exact: true }).click();
      await expect(menu).toBeHidden();
      await expect(editor.locator('table')).toHaveCount(1);
      await expect(cells).toHaveText(values);
      await expect(editor.locator(':scope > p')).toHaveCount(1);
      await page.keyboard.type('outside');
      await expect(editor.locator(':scope > p')).toHaveText('outside');
      await expect(cells).toHaveText(values);
      await expect.poll(() => saved.at(-1) ?? '').toContain('outside');
      expect(errors).toEqual([]);
    });
  }
}

test('HTML 粘贴的文末长表格下方有真实可点击入口，重复点击不重复追加', async ({ page }) => {
  const saved: string[] = [];
  await mockEditorWorkspace(page, saved, [], '');
  await page.goto('/#/materials/notes/note-1');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await editor.evaluate(element => {
    const data = new DataTransfer();
    data.setData('text/html', '<table><tr><th>项目</th><th>数值</th></tr>'
      + Array.from({ length: 12 }, (_, index) => `<tr><td>行${index}</td><td>${index}</td></tr>`).join('') + '</table>');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('tr')).toHaveCount(13);
  await expect(editor.locator(':scope > p')).toHaveCount(0);
  await editor.locator('tr:last-child').scrollIntoViewIfNeeded();
  // 表格手柄叠层按动画帧跟随滚动，等它落定后再做命中测试。
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const point = await editor.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const table = element.querySelector('table')!.getBoundingClientRect();
    const x = table.left + table.width / 2;
    const y = table.bottom + (rect.bottom - table.bottom) / 2;
    return { x, y, gap: rect.bottom - table.bottom, hit: element.contains(document.elementFromPoint(x, y)) };
  });
  expect(point.gap).toBeGreaterThan(15);
  expect(point.hit).toBe(true);
  await page.mouse.click(point.x, point.y);
  await expect(editor.locator(':scope > p')).toHaveCount(1);
  await editor.locator(':scope > p').click();
  await editor.locator(':scope > p').click();
  await expect(editor.locator(':scope > p')).toHaveCount(1);
  await page.keyboard.type('after pasted table');
  await expect.poll(() => saved.at(-1) ?? '').toContain('after pasted table');
  await expect(editor.locator('tr')).toHaveCount(13);
});

test('HTML 粘贴表格末行左格右键插下段落后仍能输入保存', async ({ page }) => {
  const saved: string[] = [];
  await mockEditorWorkspace(page, saved, [], '');
  await page.goto('/#/materials/notes/note-1');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await editor.evaluate(element => {
    const data = new DataTransfer();
    data.setData('text/html', '<table><tr><th>参数</th><th>范围</th></tr><tr><td>brightness</td><td>0.1</td></tr><tr><td>hue</td><td>0.4</td></tr></table>');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  const original = ['参数', '范围', 'brightness', '0.1', 'hue', '0.4'];
  await expect(editor.locator('th, td')).toHaveText(original);
  const cell = editor.locator('tr:last-child td:first-child');
  await focusCell(cell);
  await cell.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '编辑器右键快捷功能', exact: true });
  await menu.getByRole('menuitem', { name: '插入', exact: true }).hover();
  await page.getByRole('menu', { name: '插入', exact: true }).getByRole('menuitem', { name: '在下方插入段落', exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('th, td')).toHaveText(original);
  await page.keyboard.type('after paste');
  await expect(editor.locator(':scope > p')).toHaveText('after paste');
  await expect.poll(() => saved.at(-1) ?? '').toContain('after paste');
});
