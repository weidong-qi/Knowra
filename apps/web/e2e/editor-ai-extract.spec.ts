import { expect, test, type Page } from '@playwright/test';

const note = (rawMarkdown: string, contentLoaded: boolean) => ({ id: 'note-1', spaceId: 'space-1', title: '正则化与过拟合', folderId: 'folder-1',
  tagIds: [], internalLinks: [], rawMarkdown, contentLoaded, favorite: false, deleted: false, status: 'draft', sourceType: 'manual',
  createdAt: '2026-08-12T13:14:00.000Z', updatedAt: '2026-08-31T02:32:00.000Z' });

async function mockWorkspace(page: Page, policies: unknown[], created: Record<string, unknown>[], saved: string[], features = { knowledgeProposals: true }, featureWrites: unknown[] = []) {
  let markdown = '过拟合指模型在训练集上表现很好，但在新数据上泛化能力差。';
  await page.route('**/api/ai/features', async route => {
    if (route.request().method() === 'PUT') { const body = route.request().postDataJSON() as typeof features; featureWrites.push(body); features = { ...features, ...body }; }
    await route.fulfill({ json: { data: features } });
  });
  await page.route('**/api/ai/actions**', route => route.fulfill({ json: { data: [] } }));
  await page.route('**/api/ai/inbox**', route => route.fulfill({ json: { data: [] } }));
  await page.route('**/api/ai/actions/drafts', route => route.fulfill({ json: { data: { accepted: true } } }));
  await page.route('**/api/storage/attachments/cleanup', route => route.fulfill({ json: { data: { items: [], pending: 0 } } }));
  await page.route('**/api/ai/assistant/status', route => route.fulfill({ json: { data: { provider: 'deepseek', modelId: 'deepseek-flash',
    configured: true, executionLocation: 'server', generationAvailable: true, unavailableReason: null, budget: null } } }));
  await page.route('**/api/ai/access-policies**', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      created.push(body);
      await route.fulfill({ json: { data: { policyId: 'policy-new', spaceId: 'space-1', excludedNoteIds: [], includeAttachments: false, read: true, egress: true,
        recipients: ['deepseek'], revision: 1, issuedAt: '2026-10-06T00:00:00.000Z', revokedAt: null, ...body } } });
    } else await route.fulfill({ json: { data: policies } });
  });
  await page.route('**/api/ai/conversations**', route => route.fulfill({ json: { data: route.request().url().includes('/attachments') ? { attachments: [] } : [] } }));
  await page.route('**/api/knowledge/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    let data: unknown = [];
    if (url.pathname.endsWith('/link-relations')) data = { noteId: 'note-1', spaceId: 'space-1', contentHash: 'a'.repeat(64), outgoing: [], backlinks: [] };
    else if (url.pathname.endsWith('/spaces')) data = [{ id: 'space-1', name: '主空间' }];
    else if (url.pathname.endsWith('/folders/tree')) data = [{ id: 'folder-1', name: '工作', parentId: null, children: [] }];
    else if (url.pathname.endsWith('/notes/note-1')) {
      if (request.method() === 'PATCH') { markdown = String((request.postDataJSON() as { rawMarkdown?: string }).rawMarkdown ?? ''); saved.push(markdown); }
      data = note(markdown, true);
    } else if (url.pathname.endsWith('/notes')) data = [note('', false)];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
}

const extractRequest = '请根据我在笔记《正则化与过拟合》（noteId: note-1）里标记的重点，提炼知识点。';

test('编辑器“让 AI 提炼知识点”：先保存草稿，再打开助手并预填请求；没有授权时由用户确认授权，不自动发送', async ({ page }) => {
  const created: Record<string, unknown>[] = [], saved: string[] = [];
  let sent = 0;
  await mockWorkspace(page, [], created, saved);
  await page.route('**/api/ai/conversations/**/messages', async route => { if (route.request().method() === 'POST') sent++; await route.fallback(); });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#/materials/notes/note-1');
  await expect(page.getByRole('heading', { name: '正则化与过拟合' })).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 提炼前新增');
  await page.getByRole('button', { name: '切换检查器', exact: true }).click();
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: '让 AI 助手提炼知识点' })).toBeVisible();
  await test.info().attach('编辑器入口', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: '让 AI 提炼知识点' }).click();
  await expect(page).toHaveURL(/#\/assistant\?new=1&noteId=note-1&intent=extract$/);
  expect(saved.at(-1) ?? '').toContain('提炼前新增');
  await expect(page.getByRole('textbox', { name: '消息' })).toHaveValue(extractRequest);
  const dialog = page.getByRole('dialog', { name: '授权助手读取资料' });
  await expect(dialog).toBeVisible();
  await test.info().attach('授权确认', { body: await page.screenshot(), contentType: 'image/png' });
  expect(created).toEqual([]);
  await dialog.getByRole('button', { name: '确认授权' }).click();
  await expect.poll(() => created.length).toBe(1);
  expect(created[0]).toMatchObject({ spaceId: 'space-1', scope: { kind: 'fixed', noteIds: ['note-1'] } });
  await expect(page.getByRole('textbox', { name: '消息' })).toHaveValue(extractRequest);
  expect(sent).toBe(0);
});

test('编辑器“让 AI 提炼知识点”：已有覆盖本篇的授权时直接选用，不再弹出授权对话框', async ({ page }) => {
  const created: Record<string, unknown>[] = [];
  await mockWorkspace(page, [{ policyId: 'policy-1', spaceId: 'space-1', scope: { kind: 'library' }, excludedNoteIds: [], includeAttachments: false, read: true,
    egress: true, recipients: ['deepseek'], revision: 1, issuedAt: '2026-10-06T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null }], created, []);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#/materials/notes/note-1');
  await page.getByRole('button', { name: '切换检查器', exact: true }).click();
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await page.getByRole('button', { name: '让 AI 提炼知识点' }).click();
  await expect(page.getByRole('textbox', { name: '消息' })).toHaveValue(extractRequest);
  await expect(page.getByText(/已选用现有读取授权/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: '授权助手读取资料' })).toBeHidden();
  expect(created).toEqual([]);
});

test('功能未开启时入口仍可进入助手：预填请求并提示“该功能未开启，可在设置中开启”，不弹出授权，可前往设置开启', async ({ page }) => {
  const created: Record<string, unknown>[] = [], writes: unknown[] = [];
  await mockWorkspace(page, [], created, [], { knowledgeProposals: false }, writes);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#/materials/notes/note-1');
  await page.getByRole('button', { name: '切换检查器', exact: true }).click();
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await page.getByRole('button', { name: '让 AI 提炼知识点' }).click();
  await expect(page.getByRole('textbox', { name: '消息' })).toHaveValue(extractRequest);
  await expect(page.getByText('该功能未开启，可在设置中开启。')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '授权助手读取资料' })).toBeHidden();
  await test.info().attach('功能未开启', { body: await page.screenshot(), contentType: 'image/png' });
  expect(created).toEqual([]);
  await page.getByRole('button', { name: '前往设置' }).click();
  await expect(page).toHaveURL(/#\/settings/);
  const toggle = page.getByRole('checkbox', { name: 'AI 提炼知识点' });
  await expect(toggle).not.toBeChecked();
  await toggle.locator('xpath=ancestor::label').click();
  const dialog = page.getByRole('dialog', { name: '开启“AI 提炼知识点”？' });
  await expect(dialog).toContainText('相关笔记片段会被发送到外部服务');
  await test.info().attach('开启确认', { body: await page.screenshot(), contentType: 'image/png' });
  expect(writes).toEqual([]);
  await dialog.getByRole('button', { name: '确认开启' }).click();
  await expect.poll(() => writes).toEqual([{ knowledgeProposals: true }]);
  await expect(toggle).toBeChecked();
  await toggle.locator('xpath=ancestor::label').click();
  await expect.poll(() => writes).toEqual([{ knowledgeProposals: true }, { knowledgeProposals: false }]);
  await expect(page.getByRole('dialog')).toBeHidden();
});
