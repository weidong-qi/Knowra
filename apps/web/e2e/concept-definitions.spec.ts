import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalRuntime } from '../../desktop-runtime/src/runtime-server.mjs';

test('概念定义：明确知识分组、最早主体定义、角色变更及保存后重试挂靠', async ({ page }, info) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-concept-definitions-'));
  const runtime = await startLocalRuntime({
    dataDirectory: root,
    distRoot: fileURLToPath(new URL('../dist/', import.meta.url)),
    logger: { error() {}, warn() {}, info() {} },
    syncOptions: { autoSync: false }
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const post = async (url: string, data: unknown) => {
    const response = await page.request.post(`${runtime.origin}${url}`, { data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).data;
  };
  try {
    await page.route('**/*', route =>
      new URL(route.request().url()).origin === runtime.origin ? route.continue() : route.abort()
    );
    await page.goto(runtime.launchUrl);
    await post('/api/knowledge/spaces/default', {});
    for (const [id, text] of [
      ['early-definition', '研究数量与结构的学科。'],
      ['late-definition', '数学的另一种表述。']
    ]) {
      await post('/api/knowledge/items', {
        id,
        title: id,
        canonicalStatement: text,
        knowledgeType: 'concept',
        sourceMode: 'manual'
      });
    }
    await post('/api/knowledge/concepts/commands', {
      command: {
        type: 'createConcept',
        id: 'math',
        name: '数学',
        sense: '基础学科',
        expectedRevision: 0,
        operationId: 'create-math',
        itemIds: ['early-definition', 'late-definition'],
        role: 'mentions'
      }
    });
    await post('/api/knowledge/concepts/commands', {
      command: {
        type: 'createConcept',
        id: 'agent',
        name: '智能体',
        sense: '人工智能',
        expectedRevision: 0,
        operationId: 'create-agent'
      }
    });
    await page.goto(`${runtime.origin}/#/knowledge/concepts?concept=math`);
    const definition = page.getByRole('region', { name: '定义', exact: true });
    const conceptItems = page.getByRole('region', { name: '概念类知识点', exact: true });
    await expect(conceptItems.getByRole('button', { name: '概念类知识点 2' })).toBeVisible();
    await expect(definition).toContainText('基础学科');
    await page.screenshot({ path: info.outputPath('concept-mentioned-knowledge.png'), animations: 'disabled' });
    for (const id of ['late-definition', 'early-definition']) {
      await page.getByRole('button', { name: `挂靠操作：${id}`, exact: true }).click();
      await page.getByRole('menuitem', { name: '改为主体', exact: true }).click();
      await expect(page.getByRole('article', { name: '概念详情' })).toContainText(
        id === 'late-definition' ? '主体 1' : '主体 2'
      );
    }
    await expect(definition).toContainText('研究数量与结构的学科。');
    await expect(definition).not.toContainText('数学的另一种表述。');
    await expect(conceptItems).toHaveCount(0);
    await definition.getByRole('button', { name: '其他定义 1' }).click();
    await expect(definition).toContainText('数学的另一种表述。');
    await page.screenshot({
      path: info.outputPath('concept-primary-and-other-definitions.png'),
      animations: 'disabled'
    });
    await page.getByRole('button', { name: '挂靠操作：early-definition', exact: true }).click();
    await page.getByRole('menuitem', { name: '改为提及', exact: true }).click();
    await expect(definition).not.toContainText('研究数量与结构的学科。');
    await expect(definition).toContainText('数学的另一种表述。');
    await expect(conceptItems).toContainText('early-definition');

    await page.goto(`${runtime.origin}/#/knowledge/concepts?concept=agent`);
    await page.getByRole('button', { name: '写定义', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '为“智能体”写定义', exact: true });
    await expect(dialog.getByRole('button', { name: /知识类型/ })).toBeDisabled();
    await dialog.getByRole('textbox', { name: '核心陈述' }).fill('能够感知环境并采取行动的实体。');
    let failed = false;
    await page.route('**/api/knowledge/concepts/commands', async route => {
      const command = route.request().postDataJSON()?.command;
      if (!failed && command?.type === 'linkItems' && command.id === 'agent') {
        failed = true;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'TEST_LINK_FAILURE', message: '合成挂靠失败' } })
        });
      } else await route.continue();
    });
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '重试挂入', exact: true }).click();
    await expect(definition).toContainText('能够感知环境并采取行动的实体。');
    await expect(definition).toContainText('候选');
    await page.reload();
    await expect(definition).toContainText('能够感知环境并采取行动的实体。');
    const allItems = (
      await (await page.request.get(`${runtime.origin}/api/knowledge/items?includeArchived=true`)).json()
    ).data;
    expect(allItems.filter((item: { title: string }) => item.title === '智能体的定义')).toHaveLength(1);
    await definition.getByRole('button', { name: '查看定义知识：智能体的定义', exact: true }).click();
    await expect(page.getByRole('article', { name: '知识详情' })).toContainText('能够感知环境并采取行动的实体。');
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await runtime.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
