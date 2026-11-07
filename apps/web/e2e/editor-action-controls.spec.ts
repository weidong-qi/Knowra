import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './fixtures/syntheticTest';
import { mockEditorWorkspace } from './fixtures/editorWorkspace';
import { openEditorToolbarMenu } from '../../../scripts/test-support/editor-menu.mjs';

async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 70; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate(element => element === document.activeElement)) return;
  }
  await expect(target).toBeFocused();
}

for (const mode of ['light', 'dark'] as const) {
  for (const mobile of [false, true]) {
    test.describe(`编辑器普通按钮 ${mode} ${mobile ? '触屏375' : '桌面'}`, () => {
      test.use({ viewport: mobile ? { width: 375, height: 812 } : { width: 1440, height: 900 }, hasTouch: mobile });
      test.beforeEach(async ({ page }) => {
        await mockEditorWorkspace(page, [], [], '已有正文');
        await page.route('**/api/ai/model-settings', route =>
          route.fulfill({
            json: {
              data: {
                configured: false,
                modelId: 'deepseek-flash',
                modelSupported: true,
                supportedModelIds: ['deepseek-flash']
              }
            }
          })
        );
        await page.addInitScript(
          mode => localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify({ mode })),
          mode
        );
      });
      test('移除文件的键盘、触摸与导入等待保护', async ({ page }, info) => {
        let finish!: () => void;
        const pending = new Promise<void>(resolve => {
          finish = resolve;
        });
        let imports = 0;
        await page.route('**/api/knowledge/notes/import-markdown*', async route => {
          imports += 1;
          await pending;
          await route.fulfill({ status: 500, json: { error: { message: '合成导入失败' } } });
        });
        await page.goto('/#/materials/notes/note-1');
        await expect(page.locator('.ProseMirror')).toContainText('已有正文');
        await openEditorToolbarMenu(page, '文件');
        await page.getByRole('menuitem', { name: '导入 Markdown' }).click();
        const dialog = page.getByRole('dialog', { name: '导入 Markdown' });
        const input = dialog.getByLabel('拖放 Markdown 文件到这里');
        const file = { name: 'synthetic.md', mimeType: 'text/markdown', buffer: Buffer.from('# 合成正文') };
        for (const key of ['Enter', 'Space']) {
          await input.setInputFiles(file);
          const remove = dialog.getByRole('button', { name: '移除 synthetic.md' });
          await tabTo(page, remove);
          await expect(remove).toHaveCSS('outline-style', 'solid');
          await page.screenshot({ path: info.outputPath(`移除-${key}-focus.png`), animations: 'disabled' });
          await page.keyboard.press(key);
          await expect(remove).toHaveCount(0);
        }
        if (mobile) {
          await input.setInputFiles(file);
          const remove = dialog.getByRole('button', { name: '移除 synthetic.md' });
          expect((await remove.boundingBox())!.width).toBeGreaterThanOrEqual(44);
          await remove.tap();
          await expect(remove).toHaveCount(0);
        }
        await input.setInputFiles(file);
        await dialog.getByRole('button', { name: '导入 1 篇' }).click();
        const remove = dialog.getByRole('button', { name: '移除 synthetic.md' });
        await expect(remove).toBeDisabled();
        await remove.click({ force: true });
        await expect.poll(() => imports).toBe(1);
        finish();
        await expect(dialog.getByRole('alert')).toContainText('合成导入失败');
        await expect(remove).toBeEnabled();
        await remove.click();
        await expect(remove).toHaveCount(0);
      });
      test('恢复排除范围的键盘、错误重试与等待保护', async ({ page }, info) => {
        const annotation = {
          id: 'annotation-1',
          noteId: 'note-1',
          spaceId: 'space-1',
          noteVersionId: 'version',
          kind: 'important',
          scopeType: 'selection',
          sourceMode: 'manual',
          quoteText: '已有正文',
          headingPath: [],
          fromPosition: 0,
          toPosition: 4,
          prefixText: '',
          suffixText: '',
          anchorFingerprint: 'synthetic',
          noteContentHash: 'synthetic',
          idempotencyKey: 'synthetic',
          status: 'active',
          lifecycleStatus: 'active',
          anchorStatus: 'resolved',
          revision: 3
        };
        const exclusion = { id: 'excluded-1', status: 'active', anchor: { quoteText: '合成排除片段' } };
        let finish!: () => void;
        const pending = new Promise<void>(resolve => {
          finish = resolve;
        });
        const restores: unknown[] = [];
        await page.route('**/api/knowledge/annotations**', async route => {
          const url = new URL(route.request().url());
          if (route.request().method() === 'DELETE') {
            restores.push({ path: url.pathname, body: route.request().postDataJSON() });
            if (restores.length === 1) {
              await pending;
              return route.fulfill({ status: 500, json: { error: { message: '合成恢复失败' } } });
            }
            return route.fulfill({ json: { data: { annotation, exclusion } } });
          }
          const data = url.pathname.endsWith('/preview')
            ? {
                annotation,
                currentContentHash: 'synthetic',
                resolution: { status: 'resolved', quoteText: '已有正文' },
                exclusions: [exclusion]
              }
            : url.pathname.endsWith('/knowledge-links')
              ? {
                  annotationId: annotation.id,
                  candidates: [
                    {
                      knowledgeItem: { id: 'knowledge-1', title: '合成关联知识' },
                      evidence: { id: 'evidence-1', status: 'valid' }
                    }
                  ],
                  confirmed: [],
                  evidenceStatus: []
                }
              : [annotation];
          await route.fulfill({ json: { data } });
        });
        await page.goto('/#/materials/notes/note-1');
        await expect(page.locator('.ProseMirror')).toContainText('已有正文');
        await page.getByRole('button', { name: '切换文档检查器' }).click();
        const inspector = page.getByRole('complementary', { name: '文档检查器' });
        await inspector.getByRole('tab', { name: '标注' }).click();
        await page.getByRole('button', { name: '重点 1 更多操作' }).click();
        await page.getByRole('menuitem', { name: '预览与编辑' }).click();
        const dialog = page.getByRole('dialog', { name: '重点详情' });
        const knowledge = dialog.getByRole('button', { name: '合成关联知识' });
        await tabTo(page, knowledge);
        await expect(knowledge).not.toHaveCSS('box-shadow', 'none');
        await page.screenshot({ path: info.outputPath('关联知识-focus.png'), animations: 'disabled' });
        const restore = dialog.getByRole('button', { name: '恢复排除范围：合成排除片段' });
        await page.keyboard.press('Tab');
        await expect(restore).toBeFocused();
        await expect(restore).not.toHaveCSS('box-shadow', 'none');
        await page.screenshot({ path: info.outputPath('恢复排除-focus.png'), animations: 'disabled' });
        await page.keyboard.press(mode === 'light' ? 'Enter' : 'Space');
        await expect(restore).toBeDisabled();
        await restore.click({ force: true });
        expect(restores).toHaveLength(1);
        finish();
        await expect(restore).toBeEnabled();
        if (mobile) await restore.tap();
        else await restore.click();
        await expect(dialog).toHaveCount(0);
        expect(restores).toEqual(
          Array(2).fill({
            path: '/api/knowledge/annotations/annotation-1/exclusions/excluded-1',
            body: { expectedRevision: 3 }
          })
        );
        await page.getByRole('button', { name: '重点 1 更多操作' }).click();
        await page.getByRole('menuitem', { name: '预览与编辑' }).click();
        await tabTo(page, knowledge);
        if (mobile) await knowledge.tap();
        else await page.keyboard.press(mode === 'light' ? 'Enter' : 'Space');
        await expect(page).toHaveURL(/#\/knowledge\?item=knowledge-1$/);
      });
    });
  }
}
