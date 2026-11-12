import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.js';
import { createAppContext } from '../../api/src/app.factory.js';
import { createPostgresAppContext } from '../../api/src/postgres-app.factory.js';
import { createServer } from '../../api/src/server.js';
import { createEmptyLocalState } from '../../api/src/infrastructure/local-data-schema.ts';
import { Note } from '../../api/src/modules/knowledge/domain/note.ts';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { openWorkspace } from './helpers.mjs';

const output = process.env.KNOWRA_SYNC_BENCH_OUTPUT;
if (!output || !path.isAbsolute(output)) throw new Error('请显式指定绝对路径 KNOWRA_SYNC_BENCH_OUTPUT。');
const databaseUrl = process.env.KNOWRA_SYNC_BENCH_DATABASE_URL;
if (
  databaseUrl &&
  (!['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname) ||
    !new URL(databaseUrl).pathname.includes('knowra_sync_capacity') ||
    process.env.KNOWRA_SYNC_BENCH_ALLOW_WRITES !== '1')
)
  throw new Error('容量测试只能覆盖显式授权的 knowra_sync_capacity 回环数据库。');
const counts = (process.env.KNOWRA_SYNC_BENCH_COUNTS ?? '100,1000,10000').split(',').map(Number);
const sha = value => createHash('sha256').update(value).digest('hex');
const bytesIn = directory =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .reduce(
      (sum, entry) =>
        sum +
        (entry.isDirectory()
          ? bytesIn(path.join(directory, entry.name))
          : fs.statSync(path.join(directory, entry.name)).size),
      0
    );
const report =
  process.env.KNOWRA_SYNC_BENCH_APPEND && fs.existsSync(output)
    ? JSON.parse(fs.readFileSync(output, 'utf8'))
    : {
        measuredAt: new Date().toISOString(),
        platform: process.platform,
        architecture: process.arch,
        cpu: os.cpus()[0]?.model,
        node: process.version,
        network: '127.0.0.1，仅测试回环传输',
        results: []
      };
for (const driver of process.env.KNOWRA_SYNC_BENCH_DRIVERS?.split(',') ??
  (databaseUrl ? ['local-json', 'postgres'] : ['local-json']))
  for (const count of counts) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-sync-capacity-'));
    let engine;
    let workspace;
    let server;
    let cloud;
    try {
      const cloudRoot = path.join(root, 'cloud');
      const dataStore = driver === 'local-json' ? createFileDataStore(path.join(cloudRoot, 'data.json')) : null;
      cloud =
        driver === 'postgres'
          ? await createPostgresAppContext({
              databaseUrl,
              storageRootDir: cloudRoot,
              uploadsDir: path.join(cloudRoot, 'uploads')
            })
          : createAppContext({ dataStore, storageRootDir: cloudRoot, uploadsDir: path.join(cloudRoot, 'uploads') });
      const space = await cloud.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
      const snapshot = {
        version: 'v1-local-json',
        schemaVersion: 5,
        data: createEmptyLocalState(),
        attachmentFiles: []
      };
      for (const key of Object.keys(snapshot.data)) snapshot.data[key] = [];
      snapshot.data.spaces = [space];
      snapshot.attachmentFiles = [];
      for (let index = 0; index < count; index++) {
        const content = `容量样本 ${index}\n${'中文正文与同步校验。'.repeat(12)}`;
        const note = new Note({
          id: `capacity-note-${index}`,
          spaceId: space.id,
          title: `容量笔记 ${index}`,
          rawMarkdown: content,
          contentHash: sha(content)
        });
        snapshot.data.notes.push(note);
        snapshot.data.noteVersions.push({
          id: `capacity-version-${index}`,
          noteId: note.id,
          content,
          contentHash: sha(content),
          createdAt: note.createdAt,
          createdBy: 'user'
        });
      }
      await cloud.http.storage.importKnowledgeBase(snapshot);
      server = createServer({
        appContext: cloud,
        logger: {
          error(error) {
            console.error(error);
          }
        }
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const localRoot = path.join(root, 'device');
      workspace = openWorkspace(localRoot);
      const transfer = createAttachmentTransfer({
        uploadsDir: path.join(localRoot, 'uploads'),
        storageRootDir: localRoot
      });
      engine = createSyncEngine(workspace.store, {
        entityTransfer: transfer,
        autoSync: false,
        noteService: workspace.knowledge.noteService
      });
      let started = performance.now();
      await engine.configure({ serverUrl: `http://127.0.0.1:${server.address().port}` });
      if (engine.status().error || engine.status().entityConflict)
        throw new Error(JSON.stringify(engine.status().error ?? engine.status().entityConflict.reasons));
      const initialDownloadMs = performance.now() - started;
      const saves = [];
      for (let index = 0; index < 20; index++) {
        started = performance.now();
        workspace.knowledge.noteService.updateNote('capacity-note-0', {
          rawMarkdown: `修改 ${index}，${'中文正文与同步校验。'.repeat(12)}`
        });
        saves.push(performance.now() - started);
      }
      started = performance.now();
      await engine.sync();
      if (engine.status().error || engine.status().pendingEntities) throw new Error(JSON.stringify(engine.status()));
      const incrementalSyncMs = performance.now() - started;
      saves.sort((a, b) => a - b);
      const attachments = [];
      if (count === 100) {
        const local = createAppContext({
          dataStore: workspace.store,
          storageRootDir: localRoot,
          uploadsDir: path.join(localRoot, 'uploads')
        });
        for (const size of [100 * 1024, 1024 * 1024, 5 * 1024 * 1024]) {
          const content = Buffer.alloc(size, 73);
          const record = local.http.storage.uploadAttachment({
            noteId: 'capacity-note-0',
            fileName: `capacity-${size}.bin`,
            contentBase64: content.toString('base64')
          });
          started = performance.now();
          await engine.sync();
          if (engine.status().error) throw new Error(engine.status().error.message);
          attachments.push({ bytes: size, uploadMs: performance.now() - started, sha256: record.sha256 });
        }
      }
      const result = {
        driver,
        notes: count,
        initialDownloadMs,
        saveP95Ms: saves[18],
        saveMaxMs: saves[19],
        incrementalSyncMs,
        localBytes: bytesIn(localRoot),
        processRssBytes: process.memoryUsage().rss,
        attachments,
        localSaveGatePassed: count < 1000 || saves[18] <= (count < 10000 ? 100 : 250)
      };
      report.results.push(result);
      fs.writeFileSync(output, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(result));
    } finally {
      await engine?.close();
      workspace?.store.close();
      if (server) await new Promise(resolve => server.close(resolve));
      await cloud?.close?.();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
