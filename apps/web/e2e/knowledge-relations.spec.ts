import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalRuntime } from '../../desktop-runtime/src/runtime-server.mjs';
import type { ConceptState } from '@study-accelerator/web-core';

function capturePageErrors(page: Page) {
  const diagnostics = {
    phase: '初始化',
    errors: [] as Array<{ phase: string; url: string; message: string; stack: string | undefined }>
  };
  page.on('pageerror', error => {
    const entry = { phase: diagnostics.phase, url: page.url(), message: error.message, stack: error.stack };
    diagnostics.errors.push(entry);
    // 即使后续定位先失败，CI 日志也保留原始堆栈和发生阶段。
    console.error('概念浏览器异常', JSON.stringify(entry));
  });
  return diagnostics;
}

test('真实 SQLite 闭环：条目投影确认、编辑关系、真实图、刷新和连带删除', async ({ page }) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-relations-browser-'));
  const runtime = await startLocalRuntime({
    dataDirectory: root,
    distRoot: fileURLToPath(new URL('../dist/', import.meta.url)),
    logger: { error() {}, warn() {}, info() {} },
    syncOptions: { autoSync: false }
  });
  const diagnostics = capturePageErrors(page);
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === runtime.origin ? route.continue() : route.abort()
  );
  try {
    await page.goto(runtime.launchUrl);
    const item = await page.request.post(`${runtime.origin}/api/knowledge/items`, {
      data: {
        id: 'relation-basis',
        title: '合成关系依据',
        canonicalStatement: '矩阵是张量的一种。',
        knowledgeType: 'concept',
        sourceMode: 'manual'
      }
    });
    expect(item.ok(), await item.text()).toBeTruthy();
    for (const [id, name, role] of [
      ['matrix', '合成矩阵', 'subject'],
      ['tensor', '合成张量', 'mentions']
    ] as const) {
      const response = await page.request.post(`${runtime.origin}/api/knowledge/concepts/commands`, {
        data: {
          command: {
            type: 'createConcept',
            id,
            name,
            role,
            itemIds: ['relation-basis'],
            operationId: `create-${id}`,
            expectedRevision: 0
          }
        }
      });
      expect(response.ok(), await response.text()).toBeTruthy();
    }
    const snapshot = async (): Promise<ConceptState> =>
      (await (await page.request.get(`${runtime.origin}/api/knowledge/concepts`)).json()).data;
    diagnostics.phase = '读取概念详情与投影';
    await page.goto(`${runtime.origin}/#/knowledge/concepts?concept=matrix`);
    await expect(page.getByRole('region', { name: '定义', exact: true })).toContainText('矩阵是张量的一种。');
    const section = page.getByRole('region', { name: '概念关系' });
    await expect(section.getByRole('heading', { name: '条目投影 · 待定类型（1）' })).toBeVisible();
    expect((await snapshot()).relations).toHaveLength(0);
    diagnostics.phase = '打开投影概念图';
    await page.getByRole('button', { name: '在概念图中查看' }).click();
    const graph = page.getByRole('main', { name: '概念图工作区' });
    await expect(graph.getByRole('status')).toContainText('0 条正式关系 · 1 条投影候选');
    await expect(graph.locator('canvas').first()).toBeVisible();
    diagnostics.phase = '从概念图返回详情';
    await graph.getByRole('button', { name: '打开概念详情与关系' }).click();
    diagnostics.phase = '打开投影确认弹窗并选择类型';
    await section.getByRole('button', { name: '选择类型并确认' }).click();
    let dialog = page.getByRole('dialog', { name: '确认条目投影的关系类型' });
    await expect(dialog.getByRole('button', { name: '确认并保存关系' })).toBeDisabled();
    await dialog.getByRole('button', { name: '关系类型' }).click();
    await page.getByRole('option', { name: '是一种', exact: true }).click();
    diagnostics.phase = '保存投影关系并关闭弹窗';
    await dialog.getByRole('button', { name: '确认并保存关系' }).click();
    await expect(dialog).toHaveCount(0);
    expect((await snapshot()).relations[0]).toMatchObject({
      fromConceptId: 'matrix',
      toConceptId: 'tensor',
      type: 'isA',
      basisItemId: 'relation-basis'
    });
    diagnostics.phase = '打开关系编辑弹窗并选择类型';
    await section.getByRole('button', { name: '编辑关系' }).click();
    dialog = page.getByRole('dialog', { name: '编辑关系' });
    await dialog.getByRole('button', { name: '关系类型' }).click();
    await page.getByRole('option', { name: '相关', exact: true }).click();
    diagnostics.phase = '保存关系修改并关闭弹窗';
    await dialog.getByRole('button', { name: '保存关系' }).click();
    await expect(dialog).toHaveCount(0);
    diagnostics.phase = '打开正式关系图并刷新';
    await page.getByRole('button', { name: '在概念图中查看' }).click();
    await expect(graph.getByRole('status')).toContainText('1 条正式关系 · 0 条投影候选');
    await page.reload();
    await expect(graph.getByRole('status')).toContainText('1 条正式关系 · 0 条投影候选');
    await expect(graph.getByRole('region', { name: '所选概念' })).toContainText('未评估');
    diagnostics.phase = '返回详情并打开移出确认';
    await graph.getByRole('button', { name: '打开概念详情与关系' }).click();
    await page.getByRole('button', { name: '挂靠操作：合成关系依据' }).click();
    await page.getByRole('menuitem', { name: '移出', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '移出知识点？' });
    await expect(dialog).toContainText('同时删除以下 1 条关系');
    diagnostics.phase = '删除挂靠与关系并关闭弹窗';
    await dialog.getByRole('button', { name: '删除关联并删除关系' }).click();
    await expect(dialog).toHaveCount(0);
    diagnostics.phase = '再次打开概念图确认连带删除';
    await page.getByRole('button', { name: '在概念图中查看' }).click();
    await expect(graph.getByRole('status')).toContainText('0 条正式关系 · 0 条投影候选');
    expect((await snapshot()).relations).toEqual([]);
    expect(diagnostics.errors).toEqual([]);
  } finally {
    await page.close();
    await runtime.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
