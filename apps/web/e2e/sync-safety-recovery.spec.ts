import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.js';
import { createAppContext } from '../../api/src/app.factory.js';
import { createServer } from '../../api/src/server.js';
import { startLocalRuntime } from '../../desktop-runtime/src/runtime-server.mjs';
import { readMeta } from '../../desktop-runtime/src/sync-state.mjs';
import type { RecoveryPreview, SyncStatus } from '../src/features/sync/localSyncApi';

// 真实生产页面与 HTTP 路由；只有云端传输故障和临时 Basic Auth 是合成夹具。
// 不记录 trace、登录入口 URL 或凭据，截图仅保留在本机指定目录。
test.use({
  viewport: { width: 1440, height: 1000 },
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  launchOptions: {
    chromiumSandbox: true,
    ...(process.env.V4_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.V4_BROWSER_EXECUTABLE_PATH } : {})
  }
});
test.describe.configure({ mode: 'serial', timeout: 60000 });
test.beforeEach(({ page }) => {
  page.setDefaultTimeout(10000);
});

const output = fileURLToPath(new URL('../../../test-results/sync-safe-recovery/', import.meta.url));
const syncPath = '/api/local-runtime/sync';

async function keyboardReach(page: Page, target: Locator) {
  for (let step = 0; step < 160; step++) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function fixture(page: Page, delayed = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-sync-browser-'));
  const dataDirectory = path.join(root, 'local');
  const dataStore = createFileDataStore(path.join(root, 'cloud.json'));
  const cloud = createAppContext({
    dataStore,
    storageRootDir: root,
    uploadsDir: path.join(root, 'cloud-uploads')
  });
  const knowledge = cloud.modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const notes = Array.from({ length: 24 }, (_, index) =>
    knowledge.noteService.createNote({
      title: `合成恢复笔记 ${index + 1}`,
      rawMarkdown: `合成基线正文 ${index + 1}`,
      spaceId: space.id
    })
  );
  const username = `synthetic-${randomBytes(8).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  const expectedAuthorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  let requireLogin = false;
  let authenticated = 0;
  const server = createServer({ appContext: cloud, logger: { error() {}, warn() {} } });
  const handleCloud = server.listeners('request')[0];
  server.removeAllListeners('request');
  server.on('request', (request, response) => {
    if (requireLogin) {
      if (request.headers.authorization !== expectedAuthorization) {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: '合成云端需要临时登录。' } }));
        return;
      }
      authenticated++;
    }
    handleCloud(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const cloudOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let armed = false;
  let late: (() => Promise<Response>) | undefined;
  const writes: { deviceId: string; operationId: string }[] = [];
  const events: string[] = [];
  let retirementEntered = false;
  let releaseRetirement = () => {};
  const retirementGate = new Promise<void>(resolve => {
    releaseRetirement = resolve;
  });
  let runtime: Awaited<ReturnType<typeof startLocalRuntime>>;
  try {
    runtime = await startLocalRuntime({
      dataDirectory,
      distRoot: fileURLToPath(new URL('../dist/', import.meta.url)),
      logger: { error() {}, warn() {}, info() {} },
      syncOptions: {
        autoSync: false,
        fetcher: async (url: string, init?: RequestInit) => {
          // 夹具从不向非合成云端发请求，包括意外重定向。
          expect(new URL(url).origin).toBe(cloudOrigin);
          if (url.endsWith('/batch')) {
            writes.push(JSON.parse(String(init?.body)));
            if (armed) {
              armed = false;
              if (delayed) late = () => fetch(url, { ...init, redirect: 'error' });
              else await fetch(url, { ...init, redirect: 'error' });
              throw new Error('合成原提交响应丢失');
            }
          }
          if (url.endsWith('/device-retirement') && init?.method === 'POST') {
            retirementEntered = true;
            events.push('retirement-entered');
            await retirementGate;
          }
          if (requireLogin && url.endsWith('/bootstrap')) events.push('fixed-snapshot');
          return fetch(url, { ...init, redirect: 'error' });
        }
      }
    });
  } catch (error) {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== runtime.origin) {
      external.push(new URL(route.request().url()).origin);
      return route.abort();
    }
    return route.continue();
  });
  // 必须使用一次性入口取得真实 HttpOnly 会话，不注入 cookie 或绕过来源门禁。
  expect((await fetch(`${runtime.origin}${syncPath}`)).status).toBe(401);
  await page.goto(runtime.launchUrl);
  expect(
    (
      await page.request.get(`${runtime.origin}${syncPath}`, { headers: { Origin: 'https://synthetic.invalid' } })
    ).status()
  ).toBe(403);
  const api = async <T = SyncStatus>(route: string, data?: unknown): Promise<T> => {
    const response =
      data === undefined
        ? await page.request.get(`${runtime.origin}${route}`)
        : await page.request.post(`${runtime.origin}${route}`, { data });
    expect(response.ok(), `本机 HTTP ${route}: ${response.status()}`).toBeTruthy();
    return (await response.json()).data as T;
  };
  const edit = async (id: string, changes: Record<string, unknown>) => {
    const current = Object.hasOwn(changes, 'rawMarkdown')
      ? await api<{ updatedAt: string }>(`/api/knowledge/notes/${id}`)
      : null;
    const response = await page.request.patch(`${runtime.origin}/api/knowledge/notes/${id}`, {
      data: { ...changes, ...(current ? { expectedUpdatedAt: current.updatedAt } : {}) }
    });
    expect(response.ok(), `合成笔记修改失败: ${response.status()}`).toBeTruthy();
  };
  const dialog = page.getByRole('dialog', { name: '云端同步', exact: true });
  const panel = dialog.getByRole('region', { name: '安全恢复云端同步', exact: true });
  const closeDialog = async () => {
    await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await expect(dialog).toBeHidden();
  };
  const openDialog = async () => {
    await page
      .getByRole('button', { name: /本地资料|云端同步待确认/ })
      .first()
      .click();
    await expect(dialog).toBeVisible();
  };
  return {
    root,
    runtime,
    knowledge,
    notes,
    writes,
    events,
    dialog,
    panel,
    api,
    edit,
    closeDialog,
    openDialog,
    async expectSyncCompleted() {
      // 恢复面板先隐藏，工作区刷新稍后完成；必须等提交遮罩退出再截取完成状态。
      await expect(dialog.getByRole('status', { name: '提交中', exact: true })).toBeHidden();
      await expect(dialog.getByRole('button', { name: '立即同步', exact: true })).toBeEnabled();
      const summary = dialog.getByRole('status').filter({ hasText: '云端已同步' });
      await expect(summary).toHaveCount(1);
      await expect(summary).toBeVisible();
      await summary.scrollIntoViewIfNeeded();
    },
    retirementEntered: () => retirementEntered,
    releaseRetirement,
    async pause() {
      await openDialog();
      await dialog.getByRole('textbox', { name: '云端服务地址', exact: true }).fill(cloudOrigin);
      await dialog.getByRole('button', { name: '连接并比较资料', exact: true }).click();
      await expect(dialog).toContainText('云端已同步');
      for (const note of notes) await edit(note.id, { favorite: true });
      armed = true;
      await dialog.getByRole('button', { name: '立即同步', exact: true }).click();
      await expect(panel).toBeVisible();
      expect((await api(syncPath)).safetyPaused).toBe(true);
      for (const note of notes) await edit(note.id, { favorite: false });
      requireLogin = true;
    },
    async prepare() {
      const start = panel.getByRole('button', { name: '先备份并核对恢复', exact: true });
      await expect(start).toBeDisabled();
      const retire = panel.getByRole('checkbox', { name: /我确认永久作废旧同步编号/ });
      const upgrade = panel.getByRole('checkbox', { name: /我接受服务端 journal 格式升级/ });
      await keyboardReach(page, retire);
      await page.keyboard.press('Space');
      await expect(retire).toBeChecked();
      await expect(start).toBeDisabled();
      await page.keyboard.press('Tab');
      await expect(upgrade).toBeFocused();
      await page.keyboard.press('Space');
      await expect(upgrade).toBeChecked();
      await dialog.getByLabel('登录账号', { exact: true }).fill(username);
      await dialog.getByLabel('登录密码', { exact: true }).fill(password);
      await start.click();
      await expect.poll(() => retirementEntered).toBe(true);
      await expect(panel.getByText('正在处理同步操作，请等待完成后继续核对。')).toBeVisible();
      await expect(start).toBeDisabled();
      await expect(retire).toBeDisabled();
      const during = await api(syncPath);
      expect(during.safetyPaused).toBe(true);
      expect(during.recoverySession?.stage).toBe('retiring');
      const backups = await api<{ items: { id: string }[] }>('/api/local-runtime/backups');
      expect(backups.items).toHaveLength(1);
      expect(events).toEqual(['retirement-entered']);
      events.push('backup-verified-before-retirement');
      releaseRetirement();
      await expect(panel).toContainText('恢复阶段：等待核对并选择整组资料');
      await expect(dialog.getByLabel('登录密码', { exact: true })).toHaveValue('');
      await expect(panel.getByRole('button', { name: '保留本机这一组并继续同步', exact: true })).toBeEnabled();
      expect(authenticated).toBeGreaterThan(0);
      expect(events).toEqual(['retirement-entered', 'backup-verified-before-retirement', 'fixed-snapshot']);
      return api<RecoveryPreview>(`${syncPath}/recovery-preview?offset=0&limit=20`);
    },
    async sendLate() {
      // 原请求最初匿名发出；此处仅撤去夹具 Basic Auth，独立验证真实退役门禁。
      requireLogin = false;
      try {
        return await late?.();
      } finally {
        requireLogin = true;
      }
    },
    async screenshot(name: string) {
      fs.mkdirSync(output, { recursive: true });
      await page.screenshot({ path: path.join(output, name), animations: 'disabled' });
    },
    assertCleanBrowser() {
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
      const inspect = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) inspect(target);
          else if (entry.isFile()) {
            const contents = fs.readFileSync(target);
            expect(contents.includes(Buffer.from(password)), '临时密码不得写入资料或备份').toBe(false);
            expect(contents.includes(Buffer.from(expectedAuthorization)), '临时认证头不得写入资料或备份').toBe(false);
          }
        }
      };
      inspect(root);
    },
    async close() {
      releaseRetirement();
      try {
        await page.close();
      } finally {
        try {
          await runtime.close();
        } finally {
          await new Promise<void>(resolve => server.close(() => resolve()));
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    }
  };
}

for (const delayed of [false, true]) {
  test(`${delayed ? '迟到原请求' : '已提交但响应丢失'}：双确认、备份屏障、分页核对并保留本机撤回`, async ({ page }) => {
    const f = await fixture(page, delayed);
    try {
      await f.pause();
      const globalId = f.runtime.store.getStatus().deviceId;
      const original = f.runtime.store.readSync(db => readMeta(db, 'entityUpload'));
      const before = structuredClone(f.runtime.store.readOutbox());
      const writesBefore = f.writes.length;
      for (const name of ['更新登录并同步', '立即同步', '暂停云端同步'])
        await expect(f.dialog.getByRole('button', { name, exact: true })).toBeDisabled();
      for (const route of ['/retry', '/configure', '/resolve']) {
        const response = await page.request.post(`${f.runtime.origin}${syncPath}${route}`, {
          data: route === '/configure' ? { serverUrl: 'http://127.0.0.1:1' } : { choice: 'remote' }
        });
        expect([200, 422]).toContain(response.status());
        expect((await f.api(syncPath)).safetyPaused).toBe(true);
      }
      expect(f.writes).toHaveLength(writesBefore);
      expect(f.runtime.store.readSync(db => readMeta(db, 'entityUpload'))).toEqual(original);
      const preview = await f.prepare();
      expect(preview.total).toBeGreaterThan(20);
      expect(preview.nextOffset).toBe(20);
      expect(f.runtime.store.readOutbox()).toEqual(before);
      expect(f.runtime.store.readSync(db => readMeta(db, 'entityUpload'))).toEqual(original);
      expect((await f.api(syncPath)).safetyPaused).toBe(true);
      const item = preview.items.find(entry => entry.collection === 'notes');
      expect(item).toBeTruthy();
      const summary = f.panel.locator('summary').filter({ hasText: `notes · ${item!.id}` });
      await keyboardReach(page, summary);
      await page.keyboard.press('Enter');
      const comparison = f.panel
        .locator('details')
        .filter({ has: page.locator('summary').filter({ hasText: `notes · ${item!.id}` }) });
      await expect(comparison.getByText('本机值', { exact: true })).toBeVisible();
      await expect(comparison.getByText('固定云端值', { exact: true })).toBeVisible();
      await expect(comparison.locator('pre').first()).toContainText('"favorite": false');
      await expect(comparison.locator('pre').last()).toContainText(`"favorite": ${!delayed}`);
      await comparison.scrollIntoViewIfNeeded();
      await comparison.locator('pre').evaluateAll(elements =>
        elements.forEach(element => {
          element.scrollTop = element.scrollHeight;
        })
      );
      await f.screenshot(`${delayed ? 'delayed' : 'lost'}-comparison.png`);
      await keyboardReach(page, f.panel.getByRole('button', { name: '下一页', exact: true }));
      await page.keyboard.press('Enter');
      await expect(f.panel).toContainText('当前显示 21–');
      const previous = f.panel.getByRole('button', { name: '上一页', exact: true });
      await keyboardReach(page, previous);
      await page.keyboard.press('Enter');
      await expect(f.panel).toContainText('当前显示 1–20 项');
      if (delayed) {
        const late = await f.sendLate();
        expect(late?.status).toBe(409);
        expect((await late!.json()).error.code).toBe('SYNC_DEVICE_RETIRED');
      }
      await f.panel.getByRole('button', { name: '保留本机这一组并继续同步', exact: true }).click();
      await expect(f.panel).toBeHidden();
      const final = await f.api(syncPath);
      expect(final.safetyPaused).toBe(false);
      expect(final.phase).toBe('synced');
      expect(final.deviceId).toBe(preview.newDeviceId);
      expect(final.deviceId).not.toBe(globalId);
      expect(f.runtime.store.getStatus().deviceId).toBe(globalId);
      for (const note of f.notes) {
        expect(f.runtime.store.state.notes.find(value => value.id === note.id).favorite).toBe(false);
        expect(f.knowledge.noteService.getNote(note.id).favorite).toBe(false);
      }
      expect(f.writes.slice(writesBefore).every(operation => operation.deviceId === final.deviceId)).toBe(true);
      // 响应丢失分支必须以新发送身份补发撤回，不能靠空数组断言冒充成功。
      if (!delayed) expect(f.writes.length).toBeGreaterThan(writesBefore);
      expect((await f.api<{ items: unknown[] }>('/api/local-runtime/backups')).items).toHaveLength(2);
      await f.expectSyncCompleted();
      await f.screenshot(`${delayed ? 'delayed' : 'lost'}-completed.png`);
      f.assertCleanBrowser();
    } finally {
      await f.close();
    }
  });
}

test('旧预览不能覆盖后继编辑，刷新后明确采用云端并保留完整恢复依据', async ({ page }) => {
  const f = await fixture(page);
  try {
    await f.pause();
    const preview = await f.prepare();
    const note = f.notes[0];
    const successor = '合成后继正文：固定快照之后仍需完整保全。';
    await f.edit(note.id, { rawMarkdown: successor });
    const rejected = await page.request.post(`${f.runtime.origin}${syncPath}/recover-resolve`, {
      data: { recoveryId: preview.recoveryId, revision: preview.revision, choice: 'remote' }
    });
    expect(rejected.status()).toBe(422);
    expect((await rejected.json()).error.code).toBe('SYNC_RECOVERY_PREVIEW_CHANGED');
    await expect(f.panel.getByRole('alert')).toContainText('旧预览不可用于决定');
    await expect(f.panel.getByRole('button', { name: '采用云端这一组并继续同步', exact: true })).toBeDisabled();
    await expect(f.panel.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    expect((await f.api(syncPath)).safetyPaused).toBe(true);
    await f.panel.getByRole('alert').scrollIntoViewIfNeeded();
    await f.screenshot('stale-preview-blocked.png');
    await f.panel.getByRole('button', { name: '刷新整组预览', exact: true }).click();
    const remoteChoice = f.panel.getByRole('button', { name: '采用云端这一组并继续同步', exact: true });
    await expect(remoteChoice).toBeEnabled();
    const refreshed = await f.api<RecoveryPreview>(`${syncPath}/recovery-preview`);
    expect(refreshed.recoveryId).toBe(preview.recoveryId);
    expect(refreshed.revision).not.toBe(preview.revision);
    await remoteChoice.click();
    await expect(f.panel).toBeHidden();
    expect((await f.api(syncPath)).safetyPaused).toBe(false);
    expect(f.runtime.store.state.notes.find(value => value.id === note.id).rawMarkdown).toBe(note.rawMarkdown);
    const records = await f.api<
      { kind: string; local: { notes: { id: string; rawMarkdown: string }[] }; outbox: unknown[] }[]
    >(`${syncPath}/recovery`);
    expect(
      records.some(
        record =>
          record.kind === 'sync-safety-recovery' &&
          record.outbox.length > 0 &&
          record.local.notes.some(value => value.id === note.id && value.rawMarkdown === successor)
      )
    ).toBe(true);
    await f.expectSyncCompleted();
    await f.screenshot('remote-completed.png');
    f.assertCleanBrowser();
  } finally {
    await f.close();
  }
});
