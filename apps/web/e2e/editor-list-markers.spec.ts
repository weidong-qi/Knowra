import { expect, type Locator } from '@playwright/test';
import { test } from './fixtures/syntheticTest';
import { mockEditorWorkspace } from './fixtures/editorWorkspace';
import { openEditorToolbarMenu } from '../../../scripts/test-support/editor-menu.mjs';

const markdown = [
  '- 一级实心圆',
  '  - 二级空心圆',
  '    - 三级实心方块',
  '      - 四级仍是实心方块',
  '      - [ ] 深层待办',
  '      - [x] 深层已完成',
  '',
  '1. 有序父项',
  '   - 混合二级空心圆',
  '     1. 混合三级编号',
  '        - 混合四级实心方块',
  '',
  '- 另一组一级实心圆',
  '  1. 混合二级编号',
  '     - 混合三级实心方块',
].join('\n');

async function checkMarkers(editor: Locator) {
  const markers = await editor.locator('li').evaluateAll(items => items.map(element => {
    const style = getComputedStyle(element, '::before');
    return {
      label: element.querySelector(':scope > p')?.textContent,
      radius: style.borderRadius, border: style.borderTopWidth,
      background: style.backgroundColor, width: style.width,
      content: style.content,
    };
  }));
  const marker = (label: string) => {
    const found = markers.find(item => item.label === label);
    expect(found, label).toBeDefined();
    return found!;
  };
  const filled = marker('一级实心圆').background;
  expect(filled).not.toBe('rgba(0, 0, 0, 0)');
  for (const label of ['一级实心圆', '另一组一级实心圆']) {
    expect(marker(label)).toMatchObject({ radius: '50%', background: filled, width: '5px' });
  }
  for (const label of ['二级空心圆', '混合二级空心圆']) {
    expect(marker(label)).toMatchObject({ radius: '50%', border: '1px', background: 'rgba(0, 0, 0, 0)', width: '5px' });
  }
  for (const label of ['三级实心方块', '四级仍是实心方块', '混合三级实心方块', '混合四级实心方块']) {
    expect(marker(label)).toMatchObject({ radius: '0px', border: '0px', background: filled, width: '5px' });
  }
  for (const label of ['有序父项', '混合二级编号', '混合三级编号']) {
    expect(marker(label).content).toContain('counter(knowra-ordered-item)');
  }
  for (const label of ['深层待办', '深层已完成']) {
    expect(marker(label)).toMatchObject({ radius: '4px', border: '1px', width: '17px' });
  }
  expect(marker('深层待办').background).not.toBe(marker('深层已完成').background);
}

for (const mode of ['light', 'dark'] as const) {
  test(`无序列表在${mode}主题、编辑阅读与源码预览中区分嵌套层级`, async ({ page }, info) => {
    await mockEditorWorkspace(page, [], [], markdown);
    await page.addInitScript(mode => {
      localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify({ mode, theme: 'orange', shape: 'rounded', deco: 'off' }));
    }, mode);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('/#/materials/notes/note-1');
    const editor = page.locator('.ProseMirror');
    await expect(editor.getByText('混合三级实心方块', { exact: true })).toBeVisible();
    await checkMarkers(editor);
    await info.attach(`list-markers-${mode}`, { body: await editor.screenshot({ path: info.outputPath(`list-markers-${mode}.png`) }), contentType: 'image/png' });

    await openEditorToolbarMenu(page, '视图');
    await page.getByRole('menuitem', { name: '阅读模式', exact: true }).click();
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await checkMarkers(editor);

    await openEditorToolbarMenu(page, '视图');
    await page.getByRole('menuitem', { name: '显示源码编辑器', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown 源码编辑器' })).toBeVisible();
    await checkMarkers(editor);
    await page.setViewportSize({ width: 390, height: 844 });
    await checkMarkers(editor);
    await info.attach(`list-markers-${mode}-narrow`, { body: await editor.screenshot({ path: info.outputPath(`list-markers-${mode}-narrow.png`) }), contentType: 'image/png' });
  });
}
