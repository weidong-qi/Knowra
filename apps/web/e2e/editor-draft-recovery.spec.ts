import { expect } from '@playwright/test';
import { appendEdit } from '../src/features/editor/annotationEditJournal';
import { test } from './fixtures/syntheticTest';
import { mockEditorWorkspace } from './fixtures/editorWorkspace';

test('恢复同正文批注草稿：页面保留恢复记录直到映射保存成功，重载后不重复提交', async ({ page }, info) => {
  const markdown = '合成批注恢复正文';
  const key = `knowra:note-draft:v1:${JSON.stringify(['space-1', 'note-1'])}`;
  const draft = { markdown, baseMarkdown: markdown, baseUpdatedAt: '2026-08-31T02:32:00.000Z',
    annotationEdits: appendEdit([], markdown, markdown, { deletedEmptyAnnotationIds: ['annotation-1'] }) };
  await mockEditorWorkspace(page, [], [], markdown);
  await page.addInitScript(({ key, draft }) => {
    if (sessionStorage.getItem('synthetic-recovery-seeded')) return;
    sessionStorage.setItem('synthetic-recovery-seeded', 'true');
    sessionStorage.setItem(key, JSON.stringify(draft));
  }, { key, draft });
  let release!: () => void;
  const response = new Promise<void>(resolve => { release = resolve; });
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/knowledge/notes/note-1', async route => {
    if (route.request().method() === 'PATCH') {
      requests.push(route.request().postDataJSON() as Record<string, unknown>);
      await response;
    }
    await route.fallback();
  });
  await page.clock.install();
  await page.goto('/#/materials/notes/note-1');
  await expect(page.locator('[data-editor-ready]')).toHaveAttribute('data-editor-ready', 'true');
  await expect(page.locator('.ProseMirror')).toHaveText(markdown);
  await expect(page.getByText('正文尚未保存', { exact: true })).toHaveCount(0);
  await page.clock.runFor(700);
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ rawMarkdown: markdown, expectedUpdatedAt: draft.baseUpdatedAt,
    annotationMapping: { edits: [expect.objectContaining({ deletedEmptyAnnotationIds: ['annotation-1'] })] } });
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? 'null'), key))
    .toMatchObject({ markdown, annotationEdits: draft.annotationEdits });
  await info.attach('recovered-annotation-saving', { body: await page.screenshot(), contentType: 'image/png' });
  release();
  await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), key)).toBeNull();
  await page.reload();
  await expect(page.locator('[data-editor-ready]')).toHaveAttribute('data-editor-ready', 'true');
  await expect(page.locator('.ProseMirror')).toHaveText(markdown);
  await page.clock.runFor(1000);
  expect(requests).toHaveLength(1);
});

test('恢复等待正文详情：实际远端正文变化仍显示冲突，保留草稿且不自动写入', async ({ page }) => {
  const key = `knowra:note-draft:v1:${JSON.stringify(['space-1', 'note-1'])}`;
  const draft = { markdown: '合成本地草稿', baseMarkdown: '合成旧基线', baseUpdatedAt: '2026-08-30T02:32:00.000Z' };
  const savedMarkdown: string[] = [];
  await mockEditorWorkspace(page, savedMarkdown, [], '合成远端新正文');
  await page.addInitScript(({ key, draft }) => sessionStorage.setItem(key, JSON.stringify(draft)), { key, draft });
  await page.clock.install();
  await page.goto('/#/materials/notes/note-1');
  await expect(page.locator('[data-editor-ready]')).toHaveAttribute('data-editor-ready', 'true');
  await expect(page.getByText('远端正文已更新，已恢复本地草稿，请导出草稿后核对。', { exact: true })).toBeVisible();
  await expect(page.locator('.ProseMirror')).toHaveText(draft.markdown);
  await page.clock.runFor(1000);
  expect(savedMarkdown).toHaveLength(0);
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? 'null'), key)).toEqual(draft);
});
