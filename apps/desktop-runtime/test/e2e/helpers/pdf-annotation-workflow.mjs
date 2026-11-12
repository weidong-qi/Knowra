import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { syntheticPdf } from '../../../../../scripts/test-support/pdf-fixtures.mjs';

export async function exercisePdfAnnotationWorkflow(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const api = (url, method = 'GET', data) =>
    page.evaluate(
      async ({ url, method, data }) => {
        const response = await fetch(url, {
          method,
          ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {})
        });
        const result = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(result));
        return result.data;
      },
      { url, method, data }
    );
  const space = await api('/api/knowledge/spaces/default', 'POST', {});
  const bytes = syntheticPdf({
    pages: ['First selected text', 'Second page text', 'Third page text'].map(text => ({
      text,
      width: 420,
      height: 595
    }))
  });
  const note = await page.evaluate(
    async ({ bytes, spaceId }) => {
      const query = new URLSearchParams({ operationId: 'pdf-workflow', spaceId, fileName: '标注工作流.pdf' });
      const response = await fetch(`/api/storage/pdf-imports?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: new Uint8Array(bytes)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(result));
      return result.data;
    },
    { bytes: [...bytes], spaceId: space.id }
  );
  const url = `${new URL(page.url()).origin}/#/materials/notes/${note.id}`;
  const marksUrl = `/api/pdf/${note.id}/annotations`;
  const marks = () => api(marksUrl);
  const saved = async () => expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  const undo = page.getByRole('button', { name: '撤销标注操作', exact: true });
  const redo = page.getByRole('button', { name: '重做标注操作', exact: true });
  await page.reload();
  await page.goto(url);
  await expect(page.locator('.textLayer').first()).toContainText('First selected text', { timeout: 30000 });
  await expect(undo).toBeDisabled();
  await page
    .locator('.textLayer')
    .first()
    .evaluate(layer => {
      const range = document.createRange();
      range.selectNodeContents(layer.querySelector('span'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      layer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
  await page.getByRole('button', { name: '标注为重点', exact: true }).click();
  await expect.poll(async () => (await marks()).length).toBe(1);
  const originalId = (await marks())[0].id;
  await undo.click();
  await expect.poll(async () => (await marks()).length).toBe(0);
  await redo.click();
  await expect.poll(async () => (await marks()).length).toBe(1);
  assert.notEqual((await marks())[0].id, originalId);
  const clickMark = async () => {
    // 定位会产生异步 scroll 与覆盖层更新；等浏览器完成这轮布局后再点击。
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mark = page.locator('[data-knowra-pdf-overlay] [data-type="highlight"]').first();
    const rect = await mark.boundingBox();
    assert(rect);
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await expect(page.getByRole('dialog', { name: 'PDF 标注操作' })).toBeVisible();
  };
  await clickMark();
  await page.getByRole('button', { name: '添加批注', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑 PDF 批注' });
  const field = editor.getByRole('textbox', { name: '批注内容' });
  await expect(field).toBeFocused();
  await field.fill('需要复习的批注 ABC');
  await expect.poll(async () => (await marks())[0].comment).toBe('需要复习的批注 ABC');
  await editor.getByRole('button', { name: '完成', exact: true }).click();
  await undo.click();
  await expect.poll(async () => (await marks())[0].comment).toBe('');
  await redo.click();
  await expect.poll(async () => (await marks())[0].comment).toBe('需要复习的批注 ABC');
  await clickMark();
  await page.getByRole('button', { name: '改为疑问', exact: true }).click();
  await expect.poll(async () => (await marks())[0].kind).toBe('question');
  await undo.click();
  await expect.poll(async () => (await marks())[0].kind).toBe('important');
  await redo.click();
  await expect.poll(async () => (await marks())[0].kind).toBe('question');
  await clickMark();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect.poll(async () => (await marks()).length).toBe(0);
  await undo.click();
  await expect.poll(async () => (await marks()).length).toBe(1);
  // 非输入区域的 Mac/Web 快捷键；重做删除后再撤销，不能被原生菜单吞掉。
  await page.getByLabel('PDF 页面', { exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await marks()).length).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await marks()).length).toBe(1);
  // 输入框内的撤销只改文字，不得删除或恢复整个标注。
  await clickMark();
  await page.getByRole('button', { name: '编辑批注', exact: true }).click();
  await field.press('End');
  await field.pressSequentially(' appended');
  await field.press('ControlOrMeta+z');
  await expect(field).not.toHaveValue(/appended/);
  await editor.getByRole('button', { name: '完成', exact: true }).click();
  await saved();
  assert.equal((await marks()).length, 1);
  // 两条不同页、不同分类和批注状态的合成标注用于组合筛选。
  for (const [id, pageIndex, kind, comment] of [
    ['filter-two', 1, 'question', ''],
    ['filter-three', 2, 'pitfall', '另一个批注']
  ]) {
    await api(`${marksUrl}/${id}`, 'PUT', {
      type: 'highlight',
      segments: [{ pageIndex, rect: [40, 500, 160, 520] }],
      quoteText: id,
      kind,
      comment,
      expectedRevision: 0,
      operationId: id
    });
  }
  await page.reload();
  await expect(page.locator('.textLayer').first()).toContainText('First selected text');
  await expect(undo).toBeDisabled();
  await expect(page.getByText('3 条标注')).toBeVisible();
  const search = page.getByRole('searchbox', { name: '搜索标注和批注' });
  await search.fill('abc');
  await expect(page.getByText('1 条标注')).toBeVisible();
  const choose = async (name, option) => {
    await page.getByRole('button', { name: /^筛选标注/ }).click();
    const dialog = page.getByRole('dialog', { name: '筛选标注', exact: true });
    if (name === '标注页码') {
      await dialog.getByRole('button', { name: /标注页码/ }).click();
      await page.getByRole('option', { name: option, exact: true }).click();
      // Select 的退出动画仍可保留焦点作用域；先等嵌套列表真正卸载。
      await expect(page.getByRole('listbox', { includeHidden: true })).toHaveCount(0);
    } else {
      await dialog.getByRole('group', { name, exact: true }).getByRole('button', { name: option, exact: true }).click();
    }
    // 选项关闭后将焦点放回筛选弹层，再用 Escape 关闭弹层。
    await dialog.focus();
    await expect(dialog).toBeFocused();
    await dialog.press('Escape');
    await expect(dialog).toBeHidden();
  };
  await choose('标注分类', '疑问');
  await choose('标注页码', '第 2 页');
  const badge = page.getByRole('button', { name: /^筛选标注/ }).locator('[class*="countBadge"]');
  const startedDark = await page.getByRole('button', { name: '切换浅色模式', exact: true }).isVisible();
  for (const mode of ['light', 'dark']) {
    const toggle = page.getByRole('button', {
      name: mode === 'dark' ? '切换深色模式' : '切换浅色模式',
      exact: true
    });
    if (await toggle.isVisible()) await toggle.click();
    await expect(badge).toHaveText('2');
    const contrast = await badge.evaluate(element => {
      const luminance = color => {
        const values = color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number);
        return values.reduce((sum, value, index) => {
          const channel = value / 255;
          const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          return sum + linear * [0.2126, 0.7152, 0.0722][index];
        }, 0);
      };
      const style = getComputedStyle(element);
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrast, `${mode} PDF 筛选数量徽标对比度`).toBeGreaterThanOrEqual(4.5);
  }
  if (!startedDark) await page.getByRole('button', { name: '切换浅色模式', exact: true }).click();
  await expect(page.getByText('没有匹配的标注，请调整或清除筛选。')).toBeVisible();
  await search.fill('');
  await expect(page.getByText('1 条标注')).toBeVisible();
  await choose('批注状态', '有批注');
  await expect(page.getByText('0 条标注')).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.getByText('3 条标注')).toBeVisible();
  // 用真实逐键输入验证筛选命中变化：编辑器不得卸载，只保存首字符或丢失焦点。
  await choose('批注状态', '无批注');
  await page.getByRole('button', { name: /定位标注.*filter-two/ }).click();
  const sidebarField = page
    .getByRole('complementary', { name: 'PDF 检查器' })
    .getByRole('textbox', { name: '评论', exact: true });
  await sidebarField.click();
  const originalField = await sidebarField.elementHandle();
  assert(originalField);
  await page.keyboard.type('h');
  assert.equal(await originalField.evaluate(el => el.isConnected && document.activeElement === el), true);
  await page.keyboard.type('ello');
  await expect(sidebarField).toHaveValue('hello');
  await expect(sidebarField).toBeFocused();
  await expect.poll(async () => (await marks()).find(item => item.id === 'filter-two').comment).toBe('hello');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await expect(sidebarField).toHaveValue('');
  assert.equal(await originalField.evaluate(el => el.isConnected && document.activeElement === el), true);
  await expect.poll(async () => (await marks()).find(item => item.id === 'filter-two').comment).toBe('');
  await originalField.dispose();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await search.fill('abc');
  await page.getByRole('tab', { name: '目录', exact: true }).click();
  await page.getByRole('tab', { name: '标注 3', exact: true }).click();
  await expect(search).toHaveValue('abc');
  if (process.env.KNOWRA_E2E_OUTPUT) {
    fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
    await page.screenshot({ path: path.join(process.env.KNOWRA_E2E_OUTPUT, 'pdf-annotation-filter-search.png') });
  }
  // 点击过滤结果仍可定位；浮层最后一次输入在退出/重开验收中检查。
  await page.getByRole('button', { name: /定位标注.*First selected text/ }).click();
  await clickMark();
  await page.getByRole('button', { name: '编辑批注', exact: true }).click();
  if (process.env.KNOWRA_E2E_OUTPUT)
    await page.screenshot({ path: path.join(process.env.KNOWRA_E2E_OUTPUT, 'pdf-direct-comment-editor.png') });
  await field.fill('暂时不匹配过滤条件');
  await expect(page.getByText('当前选中标注不符合筛选，仍可继续编辑。', { exact: true })).toBeVisible();
  await expect(field).toBeVisible();
  await field.fill('退出前直接编辑的批注 ABC');
  assert.deepEqual(errors, []);
  return { url, noteId: note.id, comment: '退出前直接编辑的批注 ABC' };
}
