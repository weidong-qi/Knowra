import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.js';
import { createAppContext } from '../../api/src/app.factory.js';
import { createLocalSyncService } from '../../api/src/modules/sync/local-provider.js';
import { syncContract } from '../../api/src/modules/sync/protocol-contract.ts';
import { entriesFor } from '../../api/src/modules/sync/journal.ts';
import { writeJsonFileAtomically } from '../../api/src/infrastructure/atomic-json-file.js';
import { temporaryDirectory } from './helpers.mjs';

function fixture(t, options) {
  const root = temporaryDirectory(t),
    file = path.join(root, 'cloud.json');
  const store = createFileDataStore(file, options);
  const knowledge = createAppContext({ dataStore: store, uploadsDir: path.join(root, 'uploads'), storageRootDir: root })
    .modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({ title: '历史快照', rawMarkdown: '初始正文', spaceId: space.id });
  return { file, store, knowledge, note, service: createLocalSyncService(store, knowledge.noteService, 'demo') };
}
const query = snapshot => ({
  ...syncContract(),
  capabilities: syncContract().capabilities.join(','),
  snapshotId: snapshot.snapshotId
});

test('压缩快照：跨分页完整、写入后不可变、重启可继续、各设备独立释放', t => {
  const f = fixture(t);
  for (let i = 0; i < 210; i++)
    f.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: `历史正文${i}\n${'固定内容'.repeat(100)}` });
  const expected = entriesFor(f.store.state, f.store.getSyncJournal());
  const first = f.service.bootstrap(syncContract());
  const second = f.service.bootstrap(syncContract());
  assert.notEqual(first.snapshotId, second.snapshotId);
  const persisted = f.store.getSyncJournal().snapshots[first.snapshotId];
  assert.equal(persisted.entries, undefined);
  assert(Buffer.byteLength(JSON.stringify(persisted)) < Buffer.byteLength(JSON.stringify(expected)) / 3);
  f.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: '快照之后的正文' });
  const reopened = createFileDataStore(f.file);
  const service = createLocalSyncService(reopened, null, 'demo');
  const actual = [];
  for (let offset = 0; offset < first.count; offset += 137) {
    const page = service.snapshot({ ...query(first), offset, limit: 137 });
    actual.push(...page.entries);
    assert.equal(page.nextOffset, offset + 137 < first.count ? offset + 137 : null);
  }
  assert.deepEqual(actual, expected);
  service.releaseSnapshot({ snapshotId: first.snapshotId });
  assert.throws(
    () => service.snapshot(query(first)),
    e => e.code === 'CURSOR_EXPIRED'
  );
  assert.deepEqual(service.snapshot({ ...query(second), offset: 99, limit: 205 }).entries, expected.slice(99, 304));
});

test('快照缓存写入失败回滚；核心资料与旧格式快照继续可读', t => {
  let fail = false;
  const f = fixture(t, {
    writeJson(file, value) {
      if (fail) throw new Error('模拟磁盘失败');
      writeJsonFileAtomically(file, value);
    }
  });
  const before = fs.readFileSync(f.file),
    state = structuredClone(f.store.state),
    journal = structuredClone(f.store.getSyncJournal());
  fail = true;
  assert.throws(() => f.service.bootstrap(syncContract()), /模拟磁盘失败/);
  assert.equal(JSON.stringify(f.store.state), JSON.stringify(state));
  assert.deepEqual(f.store.getSyncJournal(), journal);
  assert.deepEqual(fs.readFileSync(f.file), before);
  fail = false;
  const snapshot = f.service.bootstrap(syncContract());
  f.store.runSyncJournalTransaction(() => {
    const value = f.store.getSyncJournal().snapshots[snapshot.snapshotId];
    value.entries = entriesFor(f.store.state, f.store.getSyncJournal());
    delete value.entriesEncoding;
    delete value.entryPages;
    delete value.entryPageSize;
  });
  assert.deepEqual(f.service.snapshot(query(snapshot)).entries, entriesFor(f.store.state, f.store.getSyncJournal()));
});
