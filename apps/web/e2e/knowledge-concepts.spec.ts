import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalRuntime } from '../../desktop-runtime/src/runtime-server.mjs';
import type { ConceptState } from '@study-accelerator/web-core';

test('真实页面与 SQLite：新建、挂靠、改角色、一键删除关系、直接合并和撤销删除', async ({ page }) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-concepts-browser-'));
  const runtime = await startLocalRuntime({
    dataDirectory: root,
    distRoot: fileURLToPath(new URL('../dist/', import.meta.url)),
    logger: { error() {}, warn() {}, info() {} },
    syncOptions: { autoSync: false }
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === runtime.origin ? route.continue() : route.abort()
  );
  try {
    await page.goto(runtime.launchUrl);
    const created = await page.request.post(`${runtime.origin}/api/knowledge/items`, {
      data: {
        id: 'synthetic-k',
        title: '合成卷积知识',
        canonicalStatement: '卷积神经网络使用卷积操作。',
        knowledgeType: 'concept',
        sourceMode: 'manual'
      }
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    await page.goto(`${runtime.origin}/#/knowledge/concepts`);
    const createConcept = async (name: string) => {
      await page.getByRole('button', { name: '新建概念', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '新建概念', exact: true });
      await dialog.getByRole('textbox', { name: '概念名称' }).fill(name);
      const responsePending = page.waitForResponse(
        response =>
          response.url().endsWith('/api/knowledge/concepts/commands') && response.request().method() === 'POST'
      );
      await dialog.getByRole('button', { name: '保存概念' }).click();
      const response = await responsePending;
      expect(response.ok(), await response.text()).toBeTruthy();
      await expect(dialog).toHaveCount(0);
    };
    await createConcept('CNN');
    await createConcept('卷积神经网络');
    const snapshot = async (): Promise<ConceptState> =>
      (await (await page.request.get(`${runtime.origin}/api/knowledge/concepts`)).json()).data;
    let state = await snapshot();
    const a = state.concepts.find(row => row.name === 'CNN')!;
    const b = state.concepts.find(row => row.name === '卷积神经网络')!;
    const open = async (id: string) => {
      await page.goto(`${runtime.origin}/#/knowledge/concepts?concept=${id}`);
      await expect(page.getByRole('button', { name: '挂入知识点', exact: true })).toBeVisible();
    };
    const link = async () => {
      await page.getByRole('button', { name: '挂入知识点', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: /^挂入/ });
      const checkbox = dialog.getByRole('checkbox', { name: '合成卷积知识', exact: true });
      await checkbox.locator('xpath=ancestor::label').click();
      await expect(checkbox).toBeChecked();
      await dialog.getByRole('button', { name: '挂入 1 条知识点' }).click();
      await expect(dialog).toHaveCount(0);
    };
    await open(a.id);
    await link();
    await page.getByRole('button', { name: '挂靠操作：合成卷积知识', exact: true }).click();
    await page.getByRole('menuitem', { name: '改为提及', exact: true }).click();
    await expect(page.getByRole('article', { name: '概念详情' })).toContainText('提及 1');
    await open(b.id);
    await link();
    state = await snapshot();
    const relation = await page.request.post(`${runtime.origin}/api/knowledge/concepts/commands`, {
      data: {
        command: {
          type: 'createRelation',
          id: a.id,
          expectedRevision: state.concepts.find(row => row.id === a.id)!.revision,
          operationId: 'synthetic-relation',
          relationId: 'synthetic-edge',
          toConceptId: b.id,
          relationType: 'relatedTo',
          basisItemId: 'synthetic-k'
        }
      }
    });
    expect(relation.ok(), await relation.text()).toBeTruthy();
    await open(a.id);
    await page.reload();
    await page.getByRole('button', { name: '挂靠操作：合成卷积知识', exact: true }).click();
    await page.getByRole('menuitem', { name: '移出', exact: true }).click();
    const remove = page.getByRole('dialog', { name: '移出知识点？', exact: true });
    await expect(remove).toContainText('同时删除以下 1 条关系');
    await remove.getByRole('button', { name: '删除关联并删除关系', exact: true }).click();
    await expect(remove).toHaveCount(0);
    expect((await snapshot()).relations).toHaveLength(0);
    await link();
    await page.getByRole('button', { name: '概念更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '合并到…', exact: true }).click();
    const merge = page.getByRole('dialog', { name: '合并概念？', exact: true });
    await expect(merge).toContainText('合并不可撤销');
    await merge.getByRole('button', { name: '合并目标' }).click();
    await page.getByRole('option', { name: '卷积神经网络', exact: true }).click();
    await merge.getByRole('button', { name: '确认合并', exact: true }).click();
    await expect(merge).toHaveCount(0);
    state = await snapshot();
    expect(state.concepts).toHaveLength(1);
    expect(state.links).toHaveLength(1);
    expect(state.concepts[0].aliases).toContain('CNN');
    await page.getByRole('button', { name: '概念更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '删除概念', exact: true }).click();
    await page
      .getByRole('dialog', { name: '删除概念？', exact: true })
      .getByRole('button', { name: '删除概念及关系' })
      .click();
    await page.getByRole('button', { name: '撤销删除', exact: true }).click();
    await expect.poll(async () => (await snapshot()).concepts.length).toBe(1);
    await page.reload();
    expect((await snapshot()).concepts[0].name).toBe('卷积神经网络');
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await runtime.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
