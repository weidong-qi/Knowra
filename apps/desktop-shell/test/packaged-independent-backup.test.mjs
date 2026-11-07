import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { _electron as electron, expect } from '@playwright/test';
import { executablePath } from './packaged-app-path.mjs';
import { closeTestApplication, launchTestApplication } from './app-lifecycle.mjs';
import { openLocalSync } from '../../desktop-runtime/test/e2e/helpers/workspace-status.mjs';
import { inspectRuntimeBackup } from '../../desktop-runtime/src/backup.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function database(directory) {
  const db = new DatabaseSync(path.join(directory, 'local.sqlite'), { readOnly: true });
  try {
    const entities = db
      .prepare('SELECT collection, id, payload FROM entities ORDER BY collection, id')
      .all()
      .map(row => ({ ...row, payload: JSON.parse(row.payload) }));
    const outbox = db.prepare('SELECT * FROM sync_outbox ORDER BY sequence').all();
    const metadata = Object.fromEntries(
      db
        .prepare('SELECT key, value FROM metadata')
        .all()
        .map(row => [row.key, row.value])
    );
    return {
      entities,
      outbox: JSON.parse(JSON.stringify(outbox)),
      metadata,
      version: db.prepare('PRAGMA user_version').get().user_version
    };
  } finally {
    db.close();
  }
}

test('真实打包 APP 从第一合成根完整导出，第二独立根导入、确认恢复并重启', { timeout: 120000 }, async t => {
  const evidenceBase = process.env.KNOWRA_BACKUP_EVIDENCE_DIR
    ? path.resolve(process.env.KNOWRA_BACKUP_EVIDENCE_DIR)
    : null;
  if (evidenceBase) fs.mkdirSync(evidenceBase, { recursive: true });
  const run = fs.mkdtempSync(path.join(evidenceBase ?? os.tmpdir(), 'knowra-independent-backup-'));
  const first = path.join(run, 'root-a'),
    second = path.join(run, 'root-b'),
    external = path.join(run, 'external');
  [first, second, external].forEach(directory => fs.mkdirSync(directory));
  const attachmentBytes = Buffer.from('独立恢复合成附件\0\xff\n', 'utf8');
  let app, page;
  t.after(async () => {
    await closeTestApplication(app);
    if (!evidenceBase) fs.rmSync(run, { recursive: true, force: true });
  });
  const launch = async directory => {
    app = await launchTestApplication(electron, {
      executablePath,
      env: { ...process.env, KNOWRA_DESKTOP_SMOKE_DIR: directory },
      timeout: 20000
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  };
  const quit = async () => {
    const closed = app.waitForEvent('close');
    await app.evaluate(({ app }) => app.quit());
    await closed;
    app = null;
  };
  const picker = async directory =>
    app.evaluate(({ dialog }, directory) => {
      // 唯一替换的产品依赖是原生选择器；IPC、私有 RPC、文件和数据库均真实执行。
      dialog.showOpenDialog = async () => ({ canceled: !directory, filePaths: directory ? [directory] : [] });
    }, directory);
  const openBackup = async () => {
    const draftNotice = page.getByRole('dialog', { name: '恢复草稿', exact: true });
    if (await draftNotice.isVisible()) await draftNotice.getByRole('button', { name: '收起提示', exact: true }).click();
    await openLocalSync(page, /本地资料.*连接云端/);
    await page.getByRole('button', { name: '本机备份与恢复', exact: true }).click();
  };
  const drafts = (spaceId, noteId, markdown) => ({
    version: 1,
    drafts: { [`knowra:note-draft:v1:${JSON.stringify([spaceId, noteId])}`]: { markdown, baseMarkdown: '草稿基线' } }
  });

  await launch(first);
  const source = await page.evaluate(async contentBase64 => {
    const send = async (url, method, body) => {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? `合成资料失败 ${response.status}`);
      return result.data;
    };
    const space = await send('/api/knowledge/spaces/default', 'POST', {});
    const folder = await send('/api/knowledge/folders', 'POST', { spaceId: space.id, name: '备份合成目录' });
    const tag = await send('/api/knowledge/tags', 'POST', { spaceId: space.id, name: '备份合成标签' });
    const linked = await send('/api/knowledge/notes', 'POST', {
      spaceId: space.id,
      title: '关联合成笔记',
      rawMarkdown: '关联笔记正文'
    });
    const note = await send('/api/knowledge/notes', 'POST', {
      spaceId: space.id,
      folderId: folder.id,
      tagIds: [tag.id],
      title: '独立完整恢复正文',
      rawMarkdown: '合成备份正文'
    });
    const attachment = await send('/api/storage/attachments', 'POST', {
      noteId: note.id,
      fileName: '合成附件.bin',
      contentBase64
    });
    const updated = await send(`/api/knowledge/notes/${note.id}`, 'PATCH', {
      expectedUpdatedAt: note.updatedAt,
      rawMarkdown: `完整合成正文\n\n[[${linked.id}]]\n\n[真实合成附件](/api/storage/attachments/${attachment.id}/content)`
    });
    return { space, folder, tag, linked, note: updated, attachment };
  }, attachmentBytes.toString('base64'));
  await page.reload();
  const nativeDraft = drafts(source.space.id, source.note.id, '第一根未保存原生正文');
  await page.evaluate(async record => {
    for (const [key, value] of Object.entries(record.drafts)) await window.knowraDesktop.writeRecoveryDraft(key, value);
  }, nativeDraft);
  const archivedDraft = Buffer.from(JSON.stringify(drafts(source.space.id, source.note.id, '第一根归档草稿')));
  const archiveId = digest(archivedDraft);
  fs.mkdirSync(path.join(first, 'offline/recovery-draft-archives'));
  fs.writeFileSync(path.join(first, 'offline/recovery-draft-archives', `${archiveId}.json`), archivedDraft);
  await openBackup();
  await page.getByRole('button', { name: '创建本机备份', exact: true }).click();
  await expect(page.getByText(/备份已保存：/)).toBeVisible();
  const initial = await page.evaluate(
    async () => (await (await fetch('/api/local-runtime/backups')).json()).data.items[0]
  );
  const originalBackup = path.join(first, 'offline/backups', initial.id);
  const beforeExport = database(originalBackup);
  assert.equal(beforeExport.version, 8);
  assert.equal(beforeExport.metadata.aiSchemaVersion, '7');
  const bridgeRejection = await page.evaluate(async id => {
    try {
      await window.knowraDesktop.transferBackup({
        action: 'export',
        datasetId: globalThis.knowraRuntime.datasetId,
        backupId: id,
        filePath: '/任意路径'
      });
      return '错误地接受路径';
    } catch (error) {
      return error.message;
    }
  }, initial.id);
  assert.match(bridgeRejection, /参数无效/);
  await picker(null);
  await page.getByRole('button', { name: '导出所选完整备份', exact: true }).click();
  await expect(page.getByText(/已取消导出/)).toBeVisible();
  assert.deepEqual(fs.readdirSync(external), []);
  await picker(path.join(first, 'offline'));
  await page.getByRole('button', { name: '导出所选完整备份', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('资料目录');
  assert.deepEqual(database(originalBackup), beforeExport);
  await picker(external);
  await page.getByRole('button', { name: '导出所选完整备份', exact: true }).click();
  await expect(page.getByText(/完整备份已导出：/)).toBeVisible();
  const exported = path.join(external, `Knowra-完整备份-${initial.id}`);
  assert.equal(inspectRuntimeBackup(exported).draftCount, 2);
  await page.screenshot({ path: path.join(run, '01-export.png') });
  await page.getByRole('button', { name: '导出所选完整备份', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('已存在');
  assert.deepEqual(database(exported), beforeExport);
  await quit();

  await launch(second);
  const previous = await page.evaluate(async () => {
    const send = async (url, body) =>
      (
        await (
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          })
        ).json()
      ).data;
    const space = await send('/api/knowledge/spaces/default', {});
    return send('/api/knowledge/notes', {
      spaceId: space.id,
      title: '第二根恢复前保护',
      rawMarkdown: '第二根原有正文'
    });
  });
  await page.reload();
  const previousDraft = drafts(previous.spaceId, previous.id, '第二根恢复前未保存正文');
  await page.evaluate(async record => {
    for (const [key, value] of Object.entries(record.drafts)) await window.knowraDesktop.writeRecoveryDraft(key, value);
  }, previousDraft);
  const previousDataset = await page.evaluate(() => globalThis.knowraRuntime.datasetId);
  await openBackup();
  await picker(exported);
  await page.getByRole('button', { name: '导入外部完整备份', exact: true }).click();
  await expect(page.getByText(/外部完整备份已校验并导入本机列表/)).toBeVisible();
  assert.equal(fs.existsSync(path.join(second, 'offline/active-dataset.json')), false);
  await expect(page.getByRole('heading', { name: '完整性检查通过' })).toHaveCount(0);
  const imported = await page.evaluate(async () =>
    (await (await fetch('/api/local-runtime/backups')).json()).data.items.find(item => item.purpose === 'imported')
  );
  await page.getByRole('button', { name: '检查所选备份', exact: true }).click();
  await expect(page.getByRole('heading', { name: '完整性检查通过' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认恢复所选备份', exact: true })).toBeDisabled();
  await page.screenshot({ path: path.join(run, '02-inspect.png') });
  await page.getByText('我确认使用所选备份恢复整个本机资料库', { exact: true }).click();
  await page.getByRole('button', { name: '确认恢复所选备份', exact: true }).click();
  await expect(page.getByText(/备份已恢复。重新加载后使用恢复的资料/)).toBeVisible();
  await page.screenshot({ path: path.join(run, '03-restored.png') });
  const pointer = JSON.parse(fs.readFileSync(path.join(second, 'offline/active-dataset.json'), 'utf8'));
  const restoredDirectory = path.join(second, 'offline', pointer.directory);
  await page.getByRole('button', { name: '重新加载已恢复资料', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
  const restoredDataset = await page.evaluate(() => globalThis.knowraRuntime.datasetId);
  assert.notEqual(restoredDataset, previousDataset);
  const verify = async () => {
    const result = await page.evaluate(
      async ({ noteId, attachmentId }) => {
        const note = (await (await fetch(`/api/knowledge/notes/${noteId}`)).json()).data;
        const links = (await (await fetch(`/api/knowledge/notes/${noteId}/links`)).json()).data;
        const bytes = Array.from(
          new Uint8Array(await (await fetch(`/api/storage/attachments/${attachmentId}/content`)).arrayBuffer())
        );
        const sync = (await (await fetch('/api/local-runtime/sync')).json()).data;
        return { note, links, bytes, sync, datasetId: globalThis.knowraRuntime.datasetId };
      },
      { noteId: source.note.id, attachmentId: source.attachment.id }
    );
    assert.equal(result.note.rawMarkdown, source.note.rawMarkdown);
    assert.equal(result.note.folderId, source.folder.id);
    assert.deepEqual(result.note.tagIds, [source.tag.id]);
    assert.equal(result.links[0].id, source.linked.id);
    assert.deepEqual(Buffer.from(result.bytes), attachmentBytes);
    assert.equal(result.datasetId, restoredDataset);
    const saved = database(restoredDirectory);
    assert.equal(saved.version, 8);
    assert.equal(saved.metadata.aiSchemaVersion, '7');
    assert.deepEqual(saved.outbox, beforeExport.outbox);
    assert.equal(saved.metadata['sync:clientPaused'], 'true');
    assert.notEqual(saved.metadata.aiRuntimeEpoch, beforeExport.metadata.aiRuntimeEpoch);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(restoredDirectory, 'recovery-drafts.json'), 'utf8')),
      nativeDraft
    );
    assert.deepEqual(
      fs.readFileSync(path.join(restoredDirectory, 'recovery-draft-archives', `${archiveId}.json`)),
      archivedDraft
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(second, 'offline/recovery-drafts.json'), 'utf8')),
      previousDraft
    );
    return result;
  };
  const live = await verify();
  const backups = await page.evaluate(
    async () => (await (await fetch('/api/local-runtime/backups')).json()).data.items
  );
  const protection = backups.find(item => item.purpose === 'before-restore');
  assert(protection);
  const protectedState = database(path.join(second, 'offline/backups', protection.id));
  assert.equal(protectedState.version, 8);
  assert.equal(protectedState.metadata.aiSchemaVersion, '7');
  assert.equal(
    protectedState.entities.find(item => item.collection === 'notes' && item.id === previous.id).payload.rawMarkdown,
    previous.rawMarkdown
  );
  assert.equal(inspectRuntimeBackup(path.join(second, 'offline/backups', protection.id)).draftCount, 1);
  await quit();
  await launch(second);
  await verify();
  await page.screenshot({ path: path.join(run, '04-restarted.png') });
  await quit();
  const buildInfo = JSON.parse(fs.readFileSync(path.join(first, 'ready.json'), 'utf8')).buildInfo;
  fs.writeFileSync(
    path.join(run, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        buildInfo,
        sourceBackupId: initial.id,
        importedBackupId: imported.id,
        protectionBackupId: protection.id,
        sourceRoot: first,
        restoredRoot: second,
        externalDirectory: exported,
        previousDataset,
        restoredDataset,
        noteId: source.note.id,
        linkedNoteId: source.linked.id,
        attachmentSha256: digest(attachmentBytes),
        draftCount: 2,
        pendingOutboxCount: beforeExport.outbox.length,
        schemaVersion: beforeExport.version,
        syncPaused: live.sync,
        limits: '仅两个独立合成资料根和普通本地目录；仅 stub 原生目录选择器。未验证真实外盘、exFAT、供应商或公网。'
      },
      null,
      2
    )
  );
  t.diagnostic(`合成完整恢复证据：${run}`);
});
