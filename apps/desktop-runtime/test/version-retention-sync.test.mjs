import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { anchorForBlock, calculateContentHash, projectMarkdown } from '@study-accelerator/content-anchor';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.js';
import { createAppContext } from '../../api/src/app.factory.js';
import { createServer } from '../../api/src/server.js';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.js';
import { NoteVersion } from '../../api/src/modules/knowledge/domain/note-version.js';
import { ContentAnnotation } from '../../api/src/modules/knowledge/domain/content-annotation.js';
import { selectVersionsToPrune } from '../../api/src/modules/knowledge/domain/note-version-retention.js';
import { nextEntityUpload } from '../src/entity-sync-state.mjs';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { createPostgresAppContext } from '../../api/src/postgres-app.factory.js';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { temporaryDirectory, openWorkspace, markText, inlineId } from './helpers.mjs';

const DAY = 24 * 3600 * 1000;

async function fixture(t, postgres) {
  const root = temporaryDirectory(t);
  const cloud = postgres ? null : createFileDataStore(path.join(root, 'cloud.json'));
  const database = postgres ? await createPostgresTestDatabase() : null;
  let context, server;
  t.after(async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    try {
      await context?.close?.();
    } finally {
      await database?.close();
    }
  });
  context = postgres
    ? await createPostgresAppContext({
        databaseUrl: database.databaseUrl,
        storageRootDir: root,
        uploadsDir: path.join(root, 'uploads')
      })
    : createAppContext({ dataStore: cloud, storageRootDir: root });
  const space = await context.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  server = createServer({ appContext: context });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  function device(name, options) {
    const directory = path.join(root, name);
    let workspace = openWorkspace(directory, options);
    const transfer = createAttachmentTransfer({
      uploadsDir: path.join(directory, 'uploads'),
      storageRootDir: directory
    });
    let engine = createSyncEngine(workspace.store, { entityTransfer: transfer, autoSync: false });
    t.after(async () => {
      await engine.close();
      workspace.store.close();
    });
    const result = {
      ...workspace,
      engine,
      connect: () => engine.configure({ serverUrl: origin }),
      restart: async () => {
        await engine.close();
        workspace.store.close();
        workspace = openWorkspace(directory, options);
        engine = createSyncEngine(workspace.store, { entityTransfer: transfer, autoSync: false });
        Object.assign(result, workspace, { engine });
      }
    };
    return result;
  }
  return {
    space,
    device,
    knowledge: context.modules.knowledge,
    versions: noteId => context.modules.knowledge.noteVersionService.listVersions({ noteId })
  };
}

test(
  '真实 PostgreSQL：重点来源降级及旧格式待同步请求保护',
  {
    skip: !process.env.KNOWRA_SYNC_TEST_DATABASE_URL,
    timeout: 60000
  },
  async t => {
    const f = await fixture(t, true);
    const nested = await f.knowledge.noteService.createNote({
      spaceId: f.space.id,
      title: '嵌套重点',
      rawMarkdown: '<mark data-k="outer">甲<mark data-k="inner">乙</mark>丙</mark>尾'
    });
    const empty = await f.knowledge.noteService.createNote({
      spaceId: f.space.id,
      title: '空重点',
      rawMarkdown: markText('原文', 'empty')
    });
    const writer = f.device('review-writer');
    const reader = f.device('review-reader');
    await writer.connect();
    const evidenceFor = async (note, markId) => {
      const { evidence } = await f.knowledge.knowledgeItemService.createCandidate({
        spaceId: f.space.id,
        title: `来源${markId}`,
        canonicalStatement: '来源证据',
        sourceMode: 'annotation',
        evidence: [{ sourceType: 'annotation', annotationId: inlineId(note.id, markId) }]
      });
      return evidence[0];
    };
    // 证据由云端独立创建，离线设备的上传不包含这些来源记录。
    const nestedEvidence = await evidenceFor(nested, 'outer');
    const emptyEvidence = await evidenceFor(empty, 'empty');
    writer.knowledge.noteService.updateNote(nested.id, { rawMarkdown: '甲新增<mark data-k="inner">乙</mark>丙尾' });
    writer.knowledge.noteService.updateNote(empty.id, { rawMarkdown: markText('', 'empty') });
    await writer.engine.sync();
    assert.equal(writer.engine.status().error, null, JSON.stringify(writer.engine.status()));
    await reader.connect();
    assert.equal(reader.engine.status().error, null, JSON.stringify(reader.engine.status()));
    for (const [evidence, status] of [
      [nestedEvidence, 'stale'],
      [emptyEvidence, 'insufficient']
    ]) {
      assert.equal((await f.knowledge.repositories.knowledgeEvidenceRepository.findById(evidence.id)).status, status);
      assert.equal(reader.store.state.knowledgeEvidence.find(value => value.id === evidence.id).status, status);
    }
    const note = writer.knowledge.noteService.getNote(nested.id);
    const version = writer.knowledge.noteVersionService
      .listVersions({ noteId: note.id })
      .find(item => item.contentHash === calculateContentHash(note.rawMarkdown));
    const anchor = anchorForBlock(projectMarkdown(note.rawMarkdown), 0);
    const legacy = new ContentAnnotation({
      id: 'legacy-pg-offline',
      spaceId: note.spaceId,
      noteId: note.id,
      noteVersionId: version.id,
      schemaVersion: 2,
      scopeType: 'blocks',
      anchor: { ...anchor, noteVersionId: version.id },
      originSnapshot: {
        noteVersionId: version.id,
        contentHash: version.contentHash,
        scopeType: 'blocks',
        segments: anchor.segments,
        quoteText: anchor.quoteText,
        headingPath: []
      },
      quoteText: anchor.quoteText,
      fromPosition: anchor.sourceStart,
      toPosition: anchor.sourceEnd,
      anchorFingerprint: 'legacy-pg',
      noteContentHash: version.contentHash,
      idempotencyKey: 'legacy-pg'
    });
    writer.knowledge.repositories.contentAnnotationRepository.save(legacy);
    const frozen = structuredClone(nextEntityUpload(writer.store));
    await writer.engine.sync();
    assert.equal(writer.engine.status().error?.code, 'SYNC_CLIENT_UPGRADE_REQUIRED');
    assert.deepEqual(nextEntityUpload(writer.store), frozen);
    assert.equal(writer.knowledge.contentAnnotationService.getAnnotation(legacy.id).id, legacy.id);
    assert.equal(await f.knowledge.repositories.contentAnnotationRepository.findById(legacy.id), null);
    await writer.restart();
    assert.deepEqual(nextEntityUpload(writer.store), frozen);
    assert.equal(writer.knowledge.contentAnnotationService.getAnnotation(legacy.id).id, legacy.id);
  }
);

for (const postgres of [false, true])
  test(
    `${postgres ? 'PostgreSQL' : '文件云端'}：标注历史清理保留私有任务副本，失败回滚及重启后不再上传`,
    {
      skip: postgres && !process.env.KNOWRA_SYNC_TEST_DATABASE_URL,
      timeout: 60000
    },
    async t => {
      const f = await fixture(t, postgres);
      let fail = false,
        a;
      a = f.device('history-a', {
        beforeCommit() {
          if (fail && a.store.deletionFacts.has('annotationRevisions', 'old-revision-5'))
            throw new Error('history deletion rollback');
        }
      });
      const b = f.device('history-b');
      await a.connect();
      const note = a.knowledge.noteService.createNote({
        title: '标注历史',
        rawMarkdown: `${markText('重点内容', 'history-mark')}\n\n当前正文`,
        spaceId: f.space.id
      });
      const annotation = a.knowledge.contentAnnotationService.getAnnotation(inlineId(note.id, 'history-mark'));
      a.store.runTransaction(
        () => {
          a.store.state.contentAnnotations.find(item => item.id === annotation.id).revision = 31;
          for (let i = 2; i <= 30; i++) {
            const version = new NoteVersion({
              id: `old-version-${i}`,
              noteId: note.id,
              content: `${note.rawMarkdown}\n旧正文 ${i}`,
              createdAt: new Date(Date.now() - (40 + i) * DAY).toISOString()
            });
            a.store.state.noteVersions.push(version);
            a.store.state.annotationRevisions.push({
              id: `old-revision-${i}`,
              annotationId: annotation.id,
              revision: i,
              operation: 'sourceReconciled',
              oldAnchor: null,
              newAnchor: { ...annotation.anchor, noteVersionId: version.id },
              rangeSummary: { scopeType: annotation.scopeType, quoteText: annotation.quoteText },
              reason: null,
              createdAt: version.createdAt
            });
          }
        },
        { origin: 'migration' }
      );
      a.store.metadataTransaction(db => {
        db.exec('CREATE TABLE ai_history_probe (payload TEXT)');
        db.prepare('INSERT INTO ai_history_probe VALUES (?)').run(
          JSON.stringify({ annotationRevisions: [{ annotationId: annotation.id, revision: 5 }] })
        );
      });
      await a.engine.sync();
      assert.equal(a.engine.status().error, null, JSON.stringify(a.engine.status()));
      await b.connect();
      assert.ok(
        b.store.state.annotationRevisions.some(item => item.id === 'old-revision-5'),
        '两设备实际收到清理前的历史'
      );
      await f.knowledge.noteService.updateNote(note.id, {
        title: '云端清理后',
        updatedAt: new Date(Date.now() + 1000).toISOString()
      });
      assert.ok(
        !(await f.knowledge.repositories.annotationRevisionRepository.list()).some(item => item.id === 'old-revision-5')
      );
      fail = true;
      await a.engine.sync();
      assert.ok(a.engine.status().error);
      assert.equal(a.store.deletionFacts.has('annotationRevisions', 'old-revision-5'), false);
      fail = false;
      await a.engine.sync();
      await b.engine.sync();
      for (const device of [a, b]) {
        assert.equal(device.engine.status().error, null, JSON.stringify(device.engine.status()));
        assert.equal(device.engine.status().pendingEntities, 0);
      }
      assert.ok(a.store.state.annotationRevisions.some(item => item.id === 'old-revision-5'));
      assert.ok(a.store.state.noteVersions.some(item => item.id === 'old-version-5'));
      assert.ok(!a.store.state.annotationRevisions.some(item => item.id === 'old-revision-6'));
      assert.ok(!b.store.state.annotationRevisions.some(item => item.id === 'old-revision-5'));
      assert.ok(!b.store.state.noteVersions.some(item => item.id === 'old-version-5'));
      await a.restart();
      assert.equal(nextEntityUpload(a.store), null);
      assert.equal(a.engine.status().pendingEntities, 0);
      assert.ok(a.store.state.annotationRevisions.some(item => item.id === 'old-revision-5'));
      const current = a.knowledge.contentAnnotationService.getAnnotation(annotation.id);
      a.knowledge.contentAnnotationService.updateAnnotation(annotation.id, {
        expectedRevision: current.revision,
        comment: '清理后继续使用'
      });
      await a.engine.sync();
      assert.equal(a.engine.status().error, null, JSON.stringify(a.engine.status()));
      assert.equal(a.engine.status().pendingEntities, 0);
    }
  );

for (const postgres of [false, true])
  test(
    `${postgres ? 'PostgreSQL' : '文件云端'}：清理、恢复私有引用正文、失败回滚及冻结上传重启后两设备收敛`,
    {
      skip: postgres && !process.env.KNOWRA_SYNC_TEST_DATABASE_URL,
      timeout: 60000
    },
    async t => {
      const f = await fixture(t, postgres);
      let failRestore = false;
      const a = f.device('a', {
        beforeCommit: () => {
          if (failRestore) throw new Error('restore rollback');
        }
      });
      const b = f.device('b');
      await a.connect();
      const note = a.knowledge.noteService.createNote({
        title: '多年笔记',
        rawMarkdown: '正文 0',
        spaceId: f.space.id
      });
      const now = Date.now();
      const old = Array.from(
        { length: 30 },
        (_, index) =>
          new NoteVersion({
            id: `aged-version-${String(index).padStart(3, '0')}`,
            noteId: note.id,
            content: `历史 ${index}`,
            createdAt: new Date(now - 70 * DAY + index * 12 * 3600 * 1000).toISOString()
          })
      );
      const removable = selectVersionsToPrune({ versions: old.map(({ id, createdAt }) => ({ id, createdAt })), now });
      assert.ok(removable.length > 10);
      const cited = removable[0];
      a.store.runTransaction(() => {
        a.store.state.noteVersions.push(...old);
      });
      a.store.metadataTransaction(db => {
        db.exec('CREATE TABLE IF NOT EXISTS ai_citation_probe (payload TEXT)');
        db.prepare('INSERT INTO ai_citation_probe VALUES (?)').run(JSON.stringify({ noteVersionId: cited }));
      });
      await a.engine.sync();
      a.knowledge.noteService.updateNote(note.id, { rawMarkdown: '正文 1' });
      await a.engine.sync();
      await a.engine.sync();
      assert.equal(a.engine.status().error, null, JSON.stringify(a.engine.status().error));
      const cloudVersions = await f.versions(note.id);
      assert.ok(cloudVersions.length < old.length / 2, `云端版本应被稀疏化，实际 ${cloudVersions.length}`);
      assert.ok(
        cloudVersions.some(item => item.content === '正文 1'),
        '当前正文版本保留'
      );
      assert.ok(!cloudVersions.some(item => item.id === cited), '云端不知道设备私有引用，按策略清理');
      const local = a.store.state.noteVersions
        .filter(item => item.noteId === note.id)
        .map(item => item.id)
        .sort();
      assert.deepEqual(
        local,
        [...cloudVersions.map(item => item.id), cited].sort(),
        '设备释放已清理副本，仅保留被引用副本'
      );
      assert.equal(a.engine.status().pendingEntities, 0, '保留的副本不会作为新建上传');
      const oldVersion = a.knowledge.noteVersionService.getVersion(cited, note.id);
      const before = a.store.exportSnapshot().data;
      failRestore = true;
      assert.throws(
        () => a.knowledge.noteService.updateNote(note.id, { rawMarkdown: oldVersion.content }),
        /restore rollback/
      );
      failRestore = false;
      assert.deepEqual(a.store.exportSnapshot().data, before, '失败恢复不留下新正文或新版本');
      a.knowledge.noteService.updateNote(note.id, { rawMarkdown: oldVersion.content });
      const restored = a.knowledge.repositories.noteVersionRepository.findByNoteIdAndContentHash(
        note.id,
        oldVersion.contentHash
      );
      assert.notEqual(restored.id, cited, '已清理 ID 不得复活');
      assert.deepEqual(a.knowledge.noteVersionService.getVersion(cited, note.id), oldVersion, '私有记录仍可读取原版本');
      const operation = nextEntityUpload(a.store);
      assert.ok(operation.changes.some(entry => entry.collection === 'noteVersions' && entry.id === restored.id));
      assert.ok(!operation.changes.some(entry => entry.collection === 'noteVersions' && entry.id === cited));
      await a.restart();
      assert.deepEqual(nextEntityUpload(a.store), operation, '重启保持冻结操作及新版本 ID');
      await a.engine.sync();
      await a.engine.sync();
      assert.equal(a.engine.status().error, null, JSON.stringify(a.engine.status()));
      assert.equal(a.engine.status().pendingEntities, 0);
      assert.deepEqual(a.knowledge.noteVersionService.getVersion(cited, note.id), oldVersion);
      assert.equal(
        a.store.readSync(
          db => JSON.parse(db.prepare('SELECT payload FROM ai_citation_probe').get().payload).noteVersionId
        ),
        cited
      );
      a.knowledge.noteService.updateNote(note.id, { title: '恢复后重存', rawMarkdown: oldVersion.content });
      assert.equal(
        a.knowledge.repositories.noteVersionRepository.findByNoteIdAndContentHash(note.id, oldVersion.contentHash).id,
        restored.id,
        '后续保存复用新版本'
      );
      await a.engine.sync();
      const finalVersions = await f.versions(note.id);
      assert.ok(finalVersions.some(version => version.id === restored.id));
      assert.ok(!finalVersions.some(version => version.id === cited));
      await b.connect();
      assert.equal(b.engine.status().error, null);
      assert.deepEqual(
        b.store.state.noteVersions
          .filter(item => item.noteId === note.id)
          .map(item => item.id)
          .sort(),
        finalVersions.map(item => item.id).sort()
      );
      assert.equal(b.knowledge.noteService.getNote(note.id).rawMarkdown, oldVersion.content);
    }
  );

for (const postgres of [false, true])
  test(
    `${postgres ? 'PostgreSQL' : '文件云端'}：规范版本墓碑关联本地别名，私有副本保留且重启不再上传`,
    {
      skip: postgres && !process.env.KNOWRA_SYNC_TEST_DATABASE_URL,
      timeout: 60000
    },
    async t => {
      const f = await fixture(t, postgres);
      let failAlias = false,
        a;
      a = f.device('alias-device', {
        beforeCommit: () => {
          if (failAlias && a.store.deletionFacts.has('noteVersions', 'private-alias'))
            throw new Error('alias deletion rollback');
        }
      });
      await a.connect();
      const note = a.knowledge.noteService.createNote({
        title: '别名清理',
        rawMarkdown: '当前正文',
        spaceId: f.space.id
      });
      const oldWeek = Math.floor((Date.now() - 70 * DAY) / (7 * DAY)) * 7 * DAY + 3 * DAY;
      const versions = [0, 1, 2].map(
        i =>
          new NoteVersion({
            id: `canonical-${i}`,
            noteId: note.id,
            content: `旧正文${i}`,
            createdAt: new Date(oldWeek - i * 3600000).toISOString()
          })
      );
      a.store.runTransaction(() => a.store.state.noteVersions.push(...versions));
      await a.engine.sync();
      const other = a.knowledge.noteService.createNote({
        title: '同正文另一笔记',
        rawMarkdown: versions[1].content,
        spaceId: f.space.id
      });
      await a.engine.sync();
      const otherVersion = a.store.state.noteVersions.find(item => item.noteId === other.id);
      const privateAlias = { ...versions[1], id: 'private-alias' };
      const unusedAlias = { ...versions[2], id: 'unused-alias' };
      a.store.runTransaction(() => a.store.state.noteVersions.push(privateAlias, unusedAlias));
      a.store.metadataTransaction(db => {
        db.exec('CREATE TABLE ai_alias_probe (payload TEXT)');
        db.prepare('INSERT INTO ai_alias_probe VALUES (?)').run(JSON.stringify({ noteVersionId: privateAlias.id }));
      });
      assert.equal(a.engine.status().pendingEntities, 0, '同正文规范基线抑制别名上传');
      a.knowledge.noteService.updateNote(note.id, { rawMarkdown: '触发云端清理' });
      failAlias = true;
      await a.engine.sync();
      assert.ok(a.engine.status().error, '确认执行了别名墓碑事务失败注入');
      assert.equal(a.store.deletionFacts.has('noteVersions', privateAlias.id), false, '失败不留下部分别名删除事实');
      assert.ok(
        a.store.state.noteVersions.some(item => item.id === unusedAlias.id),
        '失败不删除本地别名'
      );
      failAlias = false;
      await a.engine.sync();
      await a.engine.sync();
      assert.equal(a.engine.status().error, null, JSON.stringify(a.engine.status()));
      assert.equal(a.engine.status().pendingEntities, 0, '墓碑之后也不重新上传别名');
      assert.ok(
        !(await f.versions(note.id)).some(
          item => item.content === privateAlias.content || item.content === unusedAlias.content
        )
      );
      assert.deepEqual(a.knowledge.noteVersionService.getVersion(privateAlias.id, note.id), privateAlias);
      assert.ok(!a.store.state.noteVersions.some(item => item.id === unusedAlias.id), '无引用别名释放');
      const fact = a.store.deletionFacts.list().find(item => item.entityId === privateAlias.id);
      assert.equal(fact?.source.canonicalVersionId, versions[1].id);
      assert.equal(fact.source.kind, 'remote-version-alias');
      assert.equal(a.store.deletionFacts.has('noteVersions', otherVersion.id), false, '同正文不同笔记不关联删除');
      assert.ok(a.store.state.noteVersions.some(item => item.id === otherVersion.id));
      await a.restart();
      assert.equal(a.engine.status().pendingEntities, 0);
      assert.equal(nextEntityUpload(a.store), null);
      assert.deepEqual(
        a.store.deletionFacts.list().find(item => item.entityId === privateAlias.id),
        fact
      );
      a.knowledge.noteService.updateNote(note.id, { rawMarkdown: privateAlias.content });
      const restored = a.knowledge.repositories.noteVersionRepository.findByNoteIdAndContentHash(
        note.id,
        privateAlias.contentHash
      );
      assert.notEqual(restored.id, privateAlias.id, '恢复私有别名正文创建新 ID');
      await a.engine.sync();
      await a.engine.sync();
      assert.equal(a.engine.status().error, null, JSON.stringify(a.engine.status()));
      assert.equal(a.engine.status().pendingEntities, 0);
      assert.ok((await f.versions(note.id)).some(item => item.id === restored.id));
      assert.deepEqual(a.knowledge.noteVersionService.getVersion(privateAlias.id, note.id), privateAlias);
    }
  );

for (const postgres of [false, true])
  test(
    `${postgres ? 'PostgreSQL' : '文件云端'}：采样窗口内绑定知识后继续编辑，离线来源见证仍能同步`,
    {
      skip: postgres && !process.env.KNOWRA_SYNC_TEST_DATABASE_URL,
      timeout: 60000
    },
    async t => {
      const f = await fixture(t, postgres),
        a = f.device('sampled-source'),
        b = f.device('sampled-reader');
      await a.connect();
      const body = i => `${markText('重点内容', 'sample-source')}\n\n其它 ${i}`;
      const note = a.knowledge.noteService.createNote({ title: '采样来源', rawMarkdown: body(0), spaceId: f.space.id });
      const annotation = { id: inlineId(note.id, 'sample-source') };
      for (let i = 1; i <= 2; i++) a.knowledge.noteService.updateNote(note.id, { rawMarkdown: body(i) });
      const source = a.knowledge.contentAnnotationService.getAnnotation(annotation.id);
      assert.ok(
        a.store.state.annotationRevisions.some(
          record => record.annotationId === source.id && record.revision === source.revision
        ),
        '当前修订不能因采样缺少来源见证'
      );
      const { item, evidence } = a.knowledge.knowledgeItemService.createCandidate({
        title: '采样后知识',
        canonicalStatement: '来源必须留证',
        sourceMode: 'annotation',
        evidence: [{ sourceType: 'annotation', annotationId: source.id, expectedAnnotationRevision: source.revision }]
      });
      a.knowledge.noteService.updateNote(note.id, { rawMarkdown: body(3) });
      await a.engine.sync();
      assert.equal(a.engine.status().error, null, JSON.stringify(a.engine.status()));
      assert.equal(a.engine.status().pendingEntities, 0);
      await b.connect();
      assert.equal(b.engine.status().error, null);
      assert.equal(b.knowledge.knowledgeItemService.listEvidence(item.id)[0].quoteText, evidence[0].quoteText);
      assert.equal(b.knowledge.knowledgeItemService.listEvidence(item.id)[0].noteVersionId, evidence[0].noteVersionId);
    }
  );
