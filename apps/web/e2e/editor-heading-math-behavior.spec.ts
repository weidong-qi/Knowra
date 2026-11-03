import { expect, type Locator } from '@playwright/test';
import { test } from './fixtures/syntheticTest';
import { mockEditorWorkspace } from './fixtures/editorWorkspace';

async function focusStart(block: Locator) {
  await block.evaluate(element => {
    (element.closest('[contenteditable]') as HTMLElement).focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

for (const level of [1, 2, 3, 4, 5, 6]) {
  test(`空 H${level} 一次 Backspace 变正文且撤销恢复标题`, async ({ page }) => {
    await mockEditorWorkspace(page, [], [], `${'#'.repeat(level)}\n`);
    await page.goto('/#/materials/notes/note-1');
    await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
    const editor = page.locator('.ProseMirror');
    await focusStart(editor.locator(`:scope > h${level}`));
    await page.keyboard.press('Backspace');
    await expect(editor.locator(':scope > p')).toHaveCount(1);
    await expect(editor.locator(':scope > :first-child')).toBeEmpty();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.locator(`:scope > h${level}`)).toHaveCount(1);
  });
}

test('加载文末公式补可输入尾段，空闲不保存，输入后正常保存', async ({ page }) => {
  const saved: string[] = [];
  await mockEditorWorkspace(page, saved, [], '$$\nx^2\n$$\n');
  await page.goto('/#/materials/notes/note-1');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const editor = page.locator('.ProseMirror');
  await expect(editor.locator(':scope > [data-math-block]')).toHaveCount(1);
  const paragraph = editor.locator(':scope > p:last-child');
  await expect(paragraph).toHaveCount(1);
  await expect(paragraph).toBeEmpty();
  // 超过自动保存 debounce，确认载入补段落没有被当作用户编辑。
  await page.waitForTimeout(1200);
  expect(saved).toEqual([]);
  await focusStart(paragraph);
  await page.keyboard.type('After formula');
  await expect.poll(() => saved.at(-1)).toBe('$$\nx^2\n$$\n\nAfter formula\n');
  await expect(editor.locator(':scope > p')).toHaveCount(1);
});

test('公式已有后文时保持现有段落，不另补空段', async ({ page }) => {
  await mockEditorWorkspace(page, [], [], '$$\nx^2\n$$\n\n已有后文\n');
  await page.goto('/#/materials/notes/note-1');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const editor = page.locator('.ProseMirror');
  await expect(editor.locator(':scope > p')).toHaveCount(1);
  await expect(editor.locator(':scope > :last-child')).toHaveText('已有后文');
});
