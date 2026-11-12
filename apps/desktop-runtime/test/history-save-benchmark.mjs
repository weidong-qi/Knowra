// 手动运行：node --expose-gc apps/desktop-runtime/test/history-save-benchmark.mjs
// 可传入 SQLite store 模块绝对路径，用同一夹具比较修改前后的实现。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createAppContext } from '../../api/src/app.factory.ts';
const moduleUrl = process.argv[2]
  ? pathToFileURL(process.argv[2])
  : new URL('../src/sqlite-data-store.mjs', import.meta.url);
const { createSqliteDataStore } = await import(moduleUrl);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-history-benchmark-'));
const store = createSqliteDataStore(path.join(root, 'local.sqlite'));
try {
  const knowledge = createAppContext({ dataStore: store, storageRootDir: root }).modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({ spaceId: space.id, title: '性能夹具', rawMarkdown: '正文' });
  store.runTransaction(() => {
    store.state.contentAnnotations.push({
      id: 'annotation',
      spaceId: space.id,
      noteId: note.id,
      quoteText: '正文',
      fromPosition: 0,
      toPosition: 2,
      kind: 'important',
      sourceMode: 'manual',
      status: 'active',
      anchorFingerprint: 'benchmark',
      noteContentHash: store.state.noteVersions[0].contentHash,
      idempotencyKey: 'benchmark'
    });
    for (let i = 0; i < 20000; i++)
      store.state.annotationRevisions.push({
        id: `revision-${i}`,
        annotationId: 'annotation',
        operation: 'update',
        revision: i + 1,
        snapshot: { quoteText: `${i}:${'历史正文'.repeat(512)}`, anchor: { path: [0, i] } }
      });
  });
  global.gc?.();
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    store.runTransaction(() => {
      store.state.notes[0].title = `性能夹具 ${i}`;
    });
    durations.push(Math.round(performance.now() - start));
  }
  console.log(
    JSON.stringify({
      revisions: store.state.annotationRevisions.length,
      saveMs: durations,
      maxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024)
    })
  );
} finally {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
