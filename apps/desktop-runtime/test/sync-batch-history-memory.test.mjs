import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { anchorFromProjectedRange, projectMarkdown, calculateContentHash } from '@study-accelerator/content-anchor';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.js';
import { createAppContext } from '../../api/src/app.factory.js';
import { prepareBatchState } from '../../api/src/modules/sync/batch-domain.ts';
import { temporaryDirectory } from './helpers.mjs';

test('版本引用索引在受限堆内存下不保活整批历史 JSON 字符串', () => {
  const moduleUrl = new URL('../../api/src/modules/knowledge/domain/note-version-references.js', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { createNoteVersionReferenceIndex } from ${JSON.stringify(moduleUrl)};
    const content = '仅用于历史引用内存回归的长正文'.repeat(2048);
    const records = Array.from({ length: 4000 }, (_, i) => ({
      noteVersionId: 'note-version-memory-' + i, content,
      nested: [{ contentHash: 'a'.repeat(63) + (i % 10) }]
    }));
    const referenced = createNoteVersionReferenceIndex({ annotationRevisions: records });
    for (let i = 0; i < records.length; i++) assert(referenced({ id: records[i].noteVersionId }));
    assert(referenced({ contentHash: records[0].nested[0].contentHash }));
    assert(!referenced({ id: 'unknown-version', contentHash: 'unknown-hash' }));
  `;
  const result = spawnSync(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 1024 * 1024
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function fixture(t) {
  const root = temporaryDirectory(t);
  const store = createFileDataStore(path.join(root, 'cloud.json'));
  const knowledge = createAppContext({ dataStore: store, storageRootDir: root }).modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({
    title: '历史内存回归',
    rawMarkdown: '需要保留的历史正文',
    spaceId: space.id
  });
  const anchor = anchorFromProjectedRange(projectMarkdown(note.rawMarkdown), 0, 4);
  knowledge.contentAnnotationService.createAnnotation({
    spaceId: space.id,
    noteId: note.id,
    schemaVersion: 2,
    scopeType: 'selection',
    quoteText: anchor.quoteText,
    fromPosition: anchor.sourceStart,
    toPosition: anchor.sourceEnd,
    anchorFingerprint: 'memory',
    anchor,
    noteContentHash: calculateContentHash(note.rawMarkdown),
    idempotencyKey: 'memory'
  });
  return store.state;
}

test('小批次复用未改变的不可变历史，后像的可变实体与集合仍隔离', t => {
  const before = fixture(t);
  assert(before.noteVersions.length && before.annotationRevisions.length);
  const original = JSON.stringify(before);
  freeze(before);
  const note = before.notes[0];
  const result = prepareBatchState(
    before,
    [{ collection: 'notes', id: note.id, value: { ...note, title: '只更新标题' } }],
    'demo'
  );
  for (const collection of ['noteVersions', 'annotationRevisions']) {
    assert.notEqual(result.state[collection], before[collection]);
    for (const row of before[collection])
      assert.equal(
        result.state[collection].find(item => item.id === row.id),
        row
      );
  }
  result.state.notes[0].title = '后像后续修改';
  assert.equal(JSON.stringify(before), original);
});

test('版本别名只复制确实改写引用的修订，嵌套引用正确且旧记录不变', t => {
  const before = fixture(t),
    version = before.noteVersions[0];
  const alias = { ...version, id: 'device-alias-version' };
  const original = JSON.stringify(before);
  const existing = before.annotationRevisions[0];
  const added = {
    ...existing,
    id: 'new-alias-revision',
    revision: existing.revision + 1,
    nested: { values: [{ noteVersionId: alias.id }, { sourceType: 'noteVersion', sourceId: alias.id }] }
  };
  freeze(before);
  const result = prepareBatchState(
    before,
    [
      { collection: 'noteVersions', id: alias.id, value: alias },
      { collection: 'annotationRevisions', id: added.id, value: added }
    ],
    'demo'
  );
  assert.equal(result.aliases[alias.id], version.id);
  assert.equal(
    result.state.annotationRevisions.find(row => row.id === existing.id),
    existing
  );
  const changed = result.state.annotationRevisions.find(row => row.id === added.id);
  assert.equal(changed.nested.values[0].noteVersionId, version.id);
  assert.equal(changed.nested.values[1].sourceId, version.id);
  assert.equal(added.nested.values[0].noteVersionId, alias.id);
  assert.equal(JSON.stringify(before), original);
});

test('历史复用仍拒绝无效字段、哈希和跨记录引用', t => {
  const baseline = fixture(t);
  for (const corrupt of [
    state => {
      state.annotationRevisions[0].revision = 0;
    },
    state => {
      state.noteVersions[0].contentHash = 'invalid';
    },
    state => {
      state.annotationRevisions[0].annotationId = 'missing';
    }
  ]) {
    const before = structuredClone(baseline);
    corrupt(before);
    freeze(before);
    assert.throws(() => prepareBatchState(before, [], 'demo'));
  }
});
