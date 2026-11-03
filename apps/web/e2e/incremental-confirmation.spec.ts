import { expect } from '@playwright/test';
import { test } from './fixtures/syntheticTest';
import { mockShellServices } from './fixtures/shellServices';

// 只允许合成页面资源与显式模拟的只读外壳请求；未知请求由 syntheticTest 阻断。
const graph = { state: {
  concepts: [{ id: 'synthetic-concept', name: '合成原图概念', sense: '用于检查原图状态隔离' }],
  items: [{ id: 'synthetic-item', conceptId: 'synthetic-concept', title: '合成旧条目', kind: 'fact', statement: '原图条目应保持原样。', sources: [{ noteId: '合成图来源', quote: '合成图原文。' }] }]
}, results: [] };

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`合成增量确认操作与隔离 ${viewport.width}px`, async ({ page }, info) => {
    await mockShellServices(page);
    await page.route('**/api/knowledge/**', async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const pathname = new URL(route.request().url()).pathname;
      const known = ['/api/knowledge/spaces', '/api/knowledge/folders/tree', '/api/knowledge/tag-groups', '/api/knowledge/notes', '/api/knowledge/tags'];
      if (!known.includes(pathname)) return route.fallback();
      await route.fulfill({ json: { data: pathname.endsWith('/spaces') ? [{ id: 'synthetic-space', name: '合成空间', defaultFlag: true }] : [] } });
    });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto('/#/knowledge/graph');
    await page.getByLabel('选择实验结果文件').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(graph)) });
    await expect(page.getByRole('button', { name: '回到示例' })).toBeVisible();
    await page.getByRole('button', { name: /^合成原图概念，/ }).click();
    const originalDetails = await page.getByRole('region', { name: '详情', exact: true }).textContent();
    const originalGraph = await page.getByRole('group', { name: '概念图', exact: true }).innerHTML();
    const launch = page.getByRole('button', { name: '增量确认演示（实验）' });
    await launch.click();
    const dialog = page.getByRole('dialog', { name: '增量确认演示（实验）' });
    const summary = dialog.getByLabel('本次演示统计');
    await expect(dialog).toContainText('关闭或刷新即清空');
    await expect(summary).toContainText('新增 0 个概念、0 条条目');
    const capture = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      await expect.poll(() => dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await expect.poll(() => dialog.evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; })).toBe(true);
      const path = info.outputPath(`${name}.png`);
      await page.screenshot({ path, animations: 'disabled' });
      await info.attach(name, { path, contentType: 'image/png' });
    };
    await dialog.getByRole('region', { name: '新增条目与原文' }).scrollIntoViewIfNeeded();
    await capture('01-new-item');
    await dialog.getByRole('region', { name: '已有概念与内容' }).scrollIntoViewIfNeeded();
    await capture('02-existing-concept');
    const assign = dialog.getByRole('button', { name: '归到这里', exact: true });
    await assign.focus(); await page.keyboard.press('Enter');
    await expect(summary).toContainText('新增 0 个概念、1 条条目');
    await expect(dialog.getByRole('status')).toBeFocused();
    await dialog.getByRole('button', { name: '撤销本条选择' }).click();
    await expect(summary).toContainText('新增 0 个概念、0 条条目');
    await dialog.getByRole('button', { name: /2\. x.grad/ }).click();
    const create = dialog.getByRole('button', { name: '另建', exact: true });
    await create.focus(); await page.keyboard.press('Enter');
    await expect(dialog.getByLabel('新概念名称')).toBeFocused();
    await dialog.getByRole('button', { name: '取消另建' }).focus(); await page.keyboard.press('Enter');
    await expect(summary).toContainText('新增 0 个概念、0 条条目');
    await expect(dialog.getByRole('status')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await launch.click();
    await dialog.getByRole('button', { name: /2\. x.grad/ }).click();
    await create.click();
    await dialog.getByLabel('新概念名称').fill('');
    await expect(dialog.getByRole('button', { name: '确认另建（仅演示）' })).toBeDisabled();
    await dialog.getByLabel('新概念名称').fill('x.grad 合成操作');
    await dialog.getByRole('button', { name: '确认另建（仅演示）' }).focus(); await page.keyboard.press('Enter');
    await expect(summary).toContainText('新增 1 个概念、1 条条目');
    await dialog.getByRole('status').scrollIntoViewIfNeeded();
    await capture('03-created');
    await dialog.getByRole('button', { name: '撤销本条选择' }).focus(); await page.keyboard.press('Enter');
    await expect(summary).toContainText('新增 0 个概念、0 条条目');
    await dialog.getByRole('button', { name: /3\. 检查 grad/ }).click();
    await dialog.getByRole('button', { name: '暂不决定' }).click();
    await expect(summary).toContainText('待定 1 条');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(launch).toBeFocused();
    await expect(page.getByRole('button', { name: '回到示例' })).toBeVisible();
    expect(await page.getByRole('region', { name: '详情', exact: true }).textContent()).toBe(originalDetails);
    expect(await page.getByRole('group', { name: '概念图', exact: true }).innerHTML()).toBe(originalGraph);
    await launch.click();
    await expect(summary).toContainText('新增 0 个概念、0 条条目');
    await expect(summary).toContainText('待定 0 条');
    await dialog.getByRole('button', { name: '归到这里' }).click();
    await page.reload();
    await expect(dialog).toHaveCount(0);
    // 刷新原图也按既有约定清空；重新导入合成图后才继续截图/检查。
    await page.getByLabel('选择实验结果文件').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(graph)) });
    await launch.click();
    await expect(summary).toContainText('新增 0 个概念、0 条条目');
    await dialog.getByRole('button', { name: '关闭并清空演示' }).click();
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
