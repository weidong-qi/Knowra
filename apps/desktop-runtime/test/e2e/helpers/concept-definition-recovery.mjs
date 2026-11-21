import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

async function api(page, url, data) {
  return page.evaluate(
    async ({ url, data }) => {
      const response = await fetch(
        url,
        data === undefined
          ? {}
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(result));
      return result.data;
    },
    { url, data }
  );
}

export function readDefinitionDrafts(page) {
  return page.evaluate(() => {
    const records =
      window.knowraDesktop?.readRecoveryDrafts?.() ??
      Object.fromEntries(
        Object.keys(sessionStorage)
          .filter(key => key.startsWith('knowra:knowledge-draft:v1:'))
          .map(key => [key, JSON.parse(sessionStorage.getItem(key))])
      );
    return Object.values(records).filter(draft => draft.definitionTarget);
  });
}

/** 只创建合成概念，保留真实草稿存储、退出握手和主体挂靠接口。 */
export async function prepareDefinitionDraft(page) {
  await api(page, '/api/knowledge/spaces/default', {});
  await api(page, '/api/knowledge/concepts/commands', {
    command: {
      type: 'createConcept',
      id: 'recovery-math',
      name: '恢复数学',
      expectedRevision: 0,
      operationId: 'create-recovery-math'
    }
  });
  await page.goto(`${new URL(page.url()).origin}/#/knowledge/concepts?concept=recovery-math`);
  await page.getByRole('button', { name: '写定义', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '为“恢复数学”写定义', exact: true });
  await dialog.getByRole('textbox', { name: '标题', exact: true }).fill('中断前的数学定义');
  await dialog.getByRole('textbox', { name: '核心陈述', exact: true }).fill('恢复后仍须作为原概念的主体定义。');
  await expect
    .poll(async () => (await readDefinitionDrafts(page))[0]?.value.canonicalStatement)
    .toBe('恢复后仍须作为原概念的主体定义。');
  const draft = (await readDefinitionDrafts(page))[0];
  assert.deepEqual(draft.definitionTarget, { conceptId: 'recovery-math', conceptName: '恢复数学' });
  return draft;
}

export async function recoverDefinitionDraft(page, draft, entry = 'write') {
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/#/${entry === 'items' ? 'knowledge' : 'knowledge/concepts?concept=recovery-math'}`);
  if (entry === 'items') {
    await page.getByRole('button', { name: `恢复草稿：${draft.value.title}`, exact: true }).click();
    await expect(page).toHaveURL(/knowledge\/concepts\?concept=recovery-math&draft=/);
  } else if (entry === 'restore') {
    await page.getByRole('button', { name: `恢复定义草稿：${draft.value.title}`, exact: true }).click();
  } else await page.getByRole('button', { name: '写定义', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '为“恢复数学”写定义', exact: true });
  await expect(dialog).toContainText('已恢复未保存的知识草稿');
  await expect(dialog.getByRole('textbox', { name: '标题', exact: true })).toHaveValue(draft.value.title);
  await expect(dialog.getByRole('textbox', { name: '核心陈述', exact: true })).toHaveValue(
    draft.value.canonicalStatement
  );
  await expect(dialog.getByRole('button', { name: /知识类型/ })).toBeDisabled();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: '定义', exact: true })).toContainText(draft.value.canonicalStatement);
  const items = await api(page, '/api/knowledge/items');
  assert.equal(items.length, 1);
  assert.equal(items[0].id, draft.candidateId);
  assert.equal(items[0].reviewStatus, 'candidate');
  const state = await api(page, '/api/knowledge/concepts');
  assert.equal(state.links.filter(link => !link.deletedAt && link.knowledgeItemId === draft.candidateId).length, 1);
  assert(
    state.links.some(
      link =>
        !link.deletedAt &&
        link.knowledgeItemId === draft.candidateId &&
        link.conceptId === draft.definitionTarget.conceptId &&
        link.role === 'subject'
    )
  );
  await expect.poll(() => readDefinitionDrafts(page)).toEqual([]);
}
