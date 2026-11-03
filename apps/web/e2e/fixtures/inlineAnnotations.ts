import type { Page } from '@playwright/test';
import { planInlineAnnotations } from '../../../api/src/modules/knowledge/application/inline-annotations.js';
import { createNote } from './editorWorkspace';

/** 新路径的合成服务使用真实派生逻辑；不把旧 POST 成功伪装成内联保存。 */
export async function mockInlineAnnotations(page: Page, savedMarkdown: string[], rows: Array<Record<string, unknown>>) {
  const legacyWrites: string[] = [];
  await page.route('**/api/knowledge/annotations**', async route => {
    const method = route.request().method();
    if (method !== 'GET') {
      legacyWrites.push(method);
      return route.fulfill({ status: 400, json: { error: { message: '内联重点必须通过正文保存派生' } } });
    }
    const markdown = savedMarkdown.at(-1);
    if (markdown !== undefined) {
      const changes = planInlineAnnotations(
        createNote(markdown, true),
        { id: 'synthetic-version' },
        rows,
        '2026-10-22T00:00:00.000Z'
      );
      for (const { annotation } of changes) {
        const index = rows.findIndex(row => row.id === annotation.id);
        if (index < 0) rows.push(annotation);
        else rows[index] = annotation;
      }
    }
    await route.fulfill({ json: { data: rows } });
  });
  return { legacyWrites };
}
