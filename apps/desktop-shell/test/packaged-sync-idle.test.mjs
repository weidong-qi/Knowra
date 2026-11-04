import { syncContract } from '../../api/src/modules/sync/protocol-contract.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { _electron as electron, expect } from '@playwright/test';
import { Note } from '../../api/src/modules/knowledge/domain/note.ts';
import { openWorkspace } from '../../desktop-runtime/test/helpers.mjs';
import { writeMeta } from '../../desktop-runtime/src/sync-state.mjs';
import { executablePath } from './packaged-app-path.mjs';
import { closeTestApplication, launchTestApplication } from './app-lifecycle.mjs';

test(
  '打包 Mac 应用：7201 条基线稳定空闲不写库、不刷新资料并记录后台能耗',
  {
    skip: process.env.KNOWRA_SYNC_ENERGY_CHECK !== '1',
    timeout: 120000
  },
  async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-packaged-idle-'));
    let requests = 0;
    let app;
    let db;
    const server = http.createServer((request, response) => {
      requests++;
      const data =
        request.url === '/api/sync/status'
          ? { protocolVersion: 1, scope: 'notes', ...syncContract(), ownerId: 'demo', datasetEpoch: 'energy' }
          : request.url.startsWith('/api/sync/device?')
            ? { sequence: 0 }
            : {
                ...syncContract(),
                ownerId: 'demo',
                groups: [],
                cursor: 'idle',
                datasetEpoch: 'energy',
                hasMore: false
              };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
      db?.close();
      await closeTestApplication(app);
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const { store, space } = openWorkspace(path.join(directory, 'offline'));
    store.syncTransaction((database, state) => {
      for (let index = 0; index < 3600; index++) {
        const content = `同步样本 ${index}\n${'用于测试空闲同步的中文正文。'.repeat(32)}`;
        const contentHash = createHash('sha256').update(content).digest('hex');
        const note = new Note({
          id: `idle-note-${index}`,
          spaceId: space.id,
          title: `笔记 ${index}`,
          rawMarkdown: content,
          contentHash
        });
        state.notes.push(note);
        state.noteVersions.push({
          id: `idle-version-${index}`,
          noteId: note.id,
          content,
          contentHash,
          createdAt: note.createdAt,
          createdBy: 'user'
        });
      }
      const insert = database.prepare('INSERT OR REPLACE INTO sync_base VALUES (?, ?, ?, ?)');
      for (const [collection, items] of Object.entries(state))
        for (const value of items) insert.run(collection, value.id, 1, JSON.stringify(value));
      for (const [key, value] of Object.entries({
        serverUrl: `http://127.0.0.1:${server.address().port}`,
        epoch: 'energy',
        cursor: 'idle'
      }))
        writeMeta(database, key, value);
      database.prepare("UPDATE sync_outbox SET state = 'acknowledged'").run();
    });
    store.close();
    app = await launchTestApplication(electron, {
      executablePath,
      env: { ...process.env, KNOWRA_DESKTOP_SMOKE_DIR: directory },
      timeout: 20000
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: '本地资料已同步', exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('AVAILABLE · 3600 ITEMS', { exact: true })).toBeVisible({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    const syncStatus = () => page.evaluate(async () => (await (await fetch('/api/local-runtime/sync')).json()).data);
    const initial = await syncStatus();
    assert.equal(initial.error, null);
    db = new DatabaseSync(path.join(directory, 'offline/local.sqlite'), { readOnly: true });
    const version = () => db.prepare('PRAGMA data_version').get().data_version;
    const beforeVersion = version();
    const metric = () =>
      app.evaluate(({ app: nativeApp }) =>
        nativeApp
          .getAppMetrics()
          .find(item => item.name === 'Knowra 本地资料服务' || item.serviceName === 'Knowra 本地资料服务')
      );
    const before = await metric();
    assert.ok(before, '必须定位到本次测试的后台服务');
    const workspaceReads = [];
    page.on('request', request => {
      if (request.method() === 'GET' && request.url().includes('/api/knowledge/')) {
        workspaceReads.push(request.url());
        t.diagnostic(`空闲资料请求：${request.url()}`);
      }
    });
    const samples = [];
    const started = Date.now();
    const beforeRequests = requests;
    while (Date.now() - started < 60000) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      samples.push(await metric());
    }
    const final = await syncStatus();
    const after = samples.at(-1);
    assert.equal(final.error, null);
    assert.equal(final.generation, initial.generation);
    assert.equal(version(), beforeVersion);
    assert.deepEqual(workspaceReads, []);
    const result = {
      durationMs: Date.now() - started,
      baselineRows: 7201,
      cpuSeconds: after.cpu.cumulativeCPUUsage - before.cpu.cumulativeCPUUsage,
      firstWorkingSetKB: before.memory.workingSetSize,
      finalWorkingSetKB: after.memory.workingSetSize,
      peakWorkingSetKB: Math.max(...samples.map(item => item.memory.workingSetSize)),
      cloudRequests: requests - beforeRequests,
      sqliteCommitDelta: version() - beforeVersion,
      workspaceReads,
      executablePath
    };
    t.diagnostic(JSON.stringify(result));
    if (process.env.KNOWRA_PACKAGED_ENERGY_OUTPUT) {
      fs.writeFileSync(process.env.KNOWRA_PACKAGED_ENERGY_OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
      await page.screenshot({ path: `${process.env.KNOWRA_PACKAGED_ENERGY_OUTPUT}.png` });
    }
  }
);
