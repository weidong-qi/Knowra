import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import archiveDownload from '../../desktop-shell/src/archive-download.cjs';
import { startLocalRuntime } from '../src/runtime-server.mjs';
import { temporaryDirectory } from './helpers.mjs';

test('桌面 GET 导出的资料 ZIP 可由同归属的 Web 资料预检器读取；未改动桌面同步队列', async t => {
  const root = temporaryDirectory(t);
  const dataDirectory = path.join(root, 'offline');
  const distRoot = path.join(root, 'dist');
  fs.mkdirSync(distRoot);
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><head></head><body>Knowra</body></html>');
  const runtime = await startLocalRuntime({ dataDirectory, distRoot, syncOptions: { autoSync: false } });
  t.after(() => runtime.close());
  const session = await fetch(runtime.launchUrl, { redirect: 'manual' });
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const datasetId = runtime.store.getStatus().datasetId;
  const request = (route, method, body) =>
    fetch(`${runtime.origin}${route}`, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Knowra-Dataset': datasetId },
      body: JSON.stringify(body)
    });
  const space = (await (await request('/api/knowledge/spaces/default', 'POST', {})).json()).data;
  const saved = await request('/api/knowledge/notes', 'POST', {
    spaceId: space.id,
    title: '合成 ZIP 资料',
    rawMarkdown: '合成的已保存资料'
  });
  assert.equal(saved.status, 201);
  const note = (await saved.json()).data;
  const attachment = await request('/api/storage/attachments', 'POST', {
    noteId: note.id,
    fileName: '合成附件.txt',
    contentBase64: Buffer.from('合成附件内容').toString('base64')
  });
  assert.equal(attachment.status, 201);
  const outbox = runtime.store.readOutbox();
  assert(outbox.length > 0);
  const destination = path.join(root, 'interchange.zip');
  const webContents = {
    getURL: () => runtime.origin,
    mainFrame: {},
    session: { fetch: (url, options) => fetch(url, { ...options, headers: { ...options.headers, Cookie: cookie } }) }
  };
  const download = archiveDownload.createArchiveDownload({
    getWindow: () => ({ webContents, isDestroyed: () => false }),
    getOrigin: () => runtime.origin,
    isClosing: () => false,
    getDatasetStatus: id => assert.equal(id, runtime.store.getStatus().datasetId),
    dataDirectory,
    dialog: { showSaveDialog: async () => ({ filePath: destination }) }
  });
  assert.equal(
    await download({ sender: webContents, senderFrame: webContents.mainFrame }, datasetId),
    'interchange.zip'
  );
  const webRoot = path.join(root, 'web');
  const context = createAppContext({
    dataStore: createFileDataStore(path.join(webRoot, 'data.json')),
    storageRootDir: webRoot,
    uploadsDir: path.join(webRoot, 'uploads'),
    ownerId: 'demo'
  });
  const preview = await context.http.pdf.archive.inspect(fs.createReadStream(destination));
  assert.equal(preview.notes, 1);
  assert.equal(preview.attachments, 1);
  context.http.pdf.archive.cancel(preview.token);
  assert.deepEqual(runtime.store.readOutbox(), outbox);
  for (const route of ['/api/storage/archive/inspect', '/api/storage/archive/restore']) {
    const response = await request(route, 'POST', {});
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'LOCAL_FEATURE_UNAVAILABLE');
  }
});
