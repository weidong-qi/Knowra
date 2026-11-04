import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { once } from 'node:events';
import { test } from 'node:test';
import { anchorForBlock, calculateContentHash, projectMarkdown } from '@study-accelerator/content-anchor';
import { knowraCheck } from '@study-accelerator/shared/knowra-marks';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.js';
import { createAppContext } from '../../api/src/app.factory.js';
import { createServer } from '../../api/src/server.js';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { ContentAnnotation } from '../../api/src/modules/knowledge/domain/content-annotation.ts';
import { temporaryDirectory, openWorkspace, markText, inlineId } from './helpers.mjs';

async function fixture(t, options = {}) {
  const root = temporaryDirectory(t);
  const dataStore = createFileDataStore(path.join(root, 'cloud.json'), options);
  const context = createAppContext({ dataStore, uploadsDir: path.join(root, 'uploads'), storageRootDir: root });
  const knowledge = context.modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({ title: '双向同步', rawMarkdown: '基线', spaceId: space.id });
  const server = createServer({
    appContext: context,
    logger: {
      error(...args) {
        console.error(...args);
      }
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  function device(name, fetcher) {
    const directory = path.join(root, name);
    const workspace = openWorkspace(directory);
    const transfer = createAttachmentTransfer({
      uploadsDir: path.join(directory, 'uploads'),
      storageRootDir: directory
    });
    const engine = createSyncEngine(workspace.store, {
      entityTransfer: transfer,
      noteService: workspace.knowledge.noteService,
      autoSync: false,
      fetcher
    });
    t.after(async () => {
      await engine.close();
      workspace.store.close();
    });
    return {
      ...workspace,
      engine,
      transfer,
      context: createAppContext({
        dataStore: workspace.store,
        uploadsDir: path.join(directory, 'uploads'),
        storageRootDir: directory
      }),
      connect: () => engine.configure({ serverUrl: origin })
    };
  }
  return { root, dataStore, context, knowledge, space, note, origin, device };
}
const clean = device => assert.equal(device.engine.status().error, null, JSON.stringify(device.engine.status()));

test('自定义标签颜色经双端同步、JSON 重新加载与 SQLite 备份恢复保持原值', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('custom-a');
  const b = cloud.device('custom-b');
  await a.connect();
  await b.connect();
  const tag = a.knowledge.tagService.createTag({ spaceId: cloud.space.id, name: '自定义颜色', color: '#3c68ff' });
  a.knowledge.noteService.setNoteTags(cloud.note.id, [tag.id]);
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  assert.equal(b.store.state.tags.find(item => item.id === tag.id).color, '#3c68ff');
  assert.deepEqual(b.knowledge.noteService.getNote(cloud.note.id).tagIds, [tag.id]);
  b.knowledge.tagService.updateTag(tag.id, { color: '#ABCDEF' });
  await b.engine.sync();
  clean(b);
  await a.engine.sync();
  clean(a);
  assert.equal(a.store.state.tags.find(item => item.id === tag.id).color, '#abcdef');
  const reloadedCloud = createFileDataStore(path.join(cloud.root, 'cloud.json'));
  assert.equal(reloadedCloud.state.tags.find(item => item.id === tag.id).color, '#abcdef');
  const backupRoot = path.join(cloud.root, 'color-backup');
  fs.mkdirSync(backupRoot);
  a.store.backupTo(path.join(backupRoot, 'local.sqlite'));
  const restored = openWorkspace(backupRoot);
  try {
    assert.equal(restored.store.state.tags.find(item => item.id === tag.id).color, '#abcdef');
  } finally {
    restored.store.close();
  }
});

function addLegacyAnnotation(cloud, note, id, blockIndex = 0) {
  const version = cloud.knowledge.noteVersionService.listVersions({ noteId: note.id })[0];
  const anchor = anchorForBlock(projectMarkdown(note.rawMarkdown), blockIndex);
  return new ContentAnnotation({
    id,
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
    anchorFingerprint: id,
    noteContentHash: version.contentHash,
    idempotencyKey: id
  });
}

test('训练资产作为云端只读集合下行回收与清理状态', async t => {
  const cloud = await fixture(t);
  const item = cloud.knowledge.knowledgeItemService.createCandidate({
    id: 'sync-training-item',
    title: '训练来源',
    canonicalStatement: '知识内容',
    sourceMode: 'manual'
  }).item;
  cloud.knowledge.knowledgeItemService.confirmItem(item.id);
  const objective = cloud.knowledge.learningObjectiveService.createCandidate({
    id: 'sync-training-objective',
    knowledgeItemId: item.id,
    objective: '能够解释知识内容',
    actionVerb: 'explain',
    cognitiveLevel: 'understand'
  });
  cloud.knowledge.learningObjectiveService.confirmObjective(objective.id);
  const question = cloud.knowledge.questionService.createQuestion({
    id: 'sync-training-question',
    questionType: 'shortAnswer',
    stem: '请解释知识内容',
    learningObjectiveIds: [objective.id],
    sources: [{ sourceType: 'manual', quote: '人工编题' }]
  });
  const device = cloud.device('training-reader');
  await device.connect();
  clean(device);
  assert(device.store.state.questions.some(record => record.id === question.id));
  const trashed = cloud.knowledge.trainingAssetLifecycle.trash('question', question.id);
  await device.engine.sync();
  clean(device);
  assert(device.store.state.questions.find(record => record.id === question.id)?.deletedAt);
  cloud.knowledge.trainingAssetLifecycle.purge('question', question.id, trashed.updatedAt);
  await device.engine.sync();
  clean(device);
  assert.equal(
    device.store.state.questions.find(record => record.id === question.id),
    undefined
  );
});

test('完整事务：离线目录、标签、新笔记经 HTTP 在两个 SQLite 设备收敛', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  const b = cloud.device('b');
  await a.connect();
  await b.connect();
  clean(a);
  clean(b);
  const folder = a.knowledge.folderService.createFolder({ spaceId: cloud.space.id, name: '离线目录' });
  const tag = a.knowledge.tagService.createTag({ spaceId: cloud.space.id, name: '离线标签' });
  const note = a.knowledge.noteService.createNote({
    title: '本地创建',
    rawMarkdown: '中文离线正文',
    spaceId: cloud.space.id,
    folderId: folder.id,
    tagIds: [tag.id]
  });
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  const result = b.knowledge.noteService.getNote(note.id);
  assert.equal(result.rawMarkdown, '中文离线正文');
  assert.equal(result.folderId, folder.id);
  assert.deepEqual(result.tagIds, [tag.id]);
  assert.equal(a.engine.status().pendingEntities, 0);
  assert.equal(a.store.getStatus().pendingOperations, 0);
});

test('附件文件先确认再发布引用；另一设备下载并按哈希读回', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  const b = cloud.device('b');
  await a.connect();
  await b.connect();
  const bytes = Buffer.from('附件中文内容');
  const attachment = a.context.http.storage.uploadAttachment({
    noteId: cloud.note.id,
    fileName: '离线.txt',
    mimeType: 'text/plain',
    contentBase64: bytes.toString('base64')
  });
  a.knowledge.noteService.updateNote(cloud.note.id, {
    rawMarkdown: `[附件](/api/storage/attachments/${attachment.id}/content)`
  });
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  const remote = b.store.state.attachments.find(item => item.id === attachment.id);
  assert.deepEqual(b.transfer.read(remote), bytes);
  assert.equal(a.engine.status().pendingEntities, 0);
  fs.unlinkSync(path.join(cloud.root, 'b', remote.storagePath));
  b.store.syncTransaction((_db, state) => {
    state.attachments.find(item => item.id === attachment.id).status = 'missing';
  });
  const generation = b.engine.status().generation;
  await b.engine.sync();
  clean(b);
  assert.equal(b.store.state.attachments.find(item => item.id === attachment.id).status, 'ready');
  assert.deepEqual(b.transfer.read(remote), bytes);
  assert(b.engine.status().generation > generation, '空页中的附件修复也必须通知界面');
  const repairedGeneration = b.engine.status().generation;
  await b.engine.sync();
  clean(b);
  assert.equal(b.engine.status().generation, repairedGeneration);
});

test('完整事务丢响应重试保持原 ID，继续编辑不会被旧确认覆盖', async t => {
  const cloud = await fixture(t);
  let lose = true;
  const ids = [];
  const a = cloud.device('a', async (url, options) => {
    const response = await fetch(url, options);
    if (url.endsWith('/batch')) {
      ids.push(JSON.parse(options.body).operationId);
      if (lose) {
        lose = false;
        throw new Error('丢响应');
      }
    }
    return response;
  });
  await a.connect();
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '第一版' });
  await a.engine.sync();
  assert(a.engine.status().error);
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '后续版本' });
  await a.engine.sync();
  clean(a);
  assert.equal(ids[0], ids[1]);
  assert.equal(cloud.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '后续版本');
});

test('目录并发修改保留关联事务，采用云端前保留完整恢复副本', async t => {
  const cloud = await fixture(t);
  const folder = cloud.knowledge.folderService.createFolder({ spaceId: cloud.space.id, name: '目录' });
  const a = cloud.device('a');
  await a.connect();
  a.knowledge.folderService.updateFolder(folder.id, { name: '本地目录' });
  cloud.knowledge.folderService.updateFolder(folder.id, { name: '云端目录' });
  await a.engine.sync();
  clean(a);
  const conflict = a.engine.status().entityConflict;
  assert(conflict);
  assert.equal(a.store.state.folders.find(item => item.id === folder.id).name, '本地目录');
  await a.engine.resolve({ conflictId: conflict.id, choice: 'remote' });
  clean(a);
  assert.equal(a.store.state.folders.find(item => item.id === folder.id).name, '云端目录');
  assert(a.engine.recovery().some(item => item.local?.folders.some(folder => folder.name === '本地目录')));
});

test('离线重点创建、取消和恢复（改正文标记）跨设备同步，保留版本与修订', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  const b = cloud.device('b');
  await a.connect();
  await b.connect();
  const plain = '第一段重点内容与第二段';
  const marked = `${markText('第一段重点内容', 'offline')}与第二段`;
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: marked });
  const id = inlineId(cloud.note.id, 'offline');
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  assert.equal(b.store.state.contentAnnotations.find(item => item.id === id).quoteText, '第一段重点内容');
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: plain });
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  assert.equal(
    b.store.state.contentAnnotations.find(item => item.id === id).lifecycleStatus,
    'deleted',
    JSON.stringify({ a: a.engine.status(), b: b.engine.status() })
  );
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: marked });
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  assert.equal(b.store.state.contentAnnotations.find(item => item.id === id).lifecycleStatus, 'active');
  assert(b.store.state.annotationRevisions.filter(item => item.annotationId === id).length >= 3);
});

test(
  '真实 PostgreSQL：完整笔记、目录、附件事务与两设备 HTTP 同步',
  { skip: !process.env.KNOWRA_SYNC_TEST_DATABASE_URL, timeout: 60000 },
  async t => {
    const database = await createPostgresTestDatabase();
    let cloud, server;
    const createdIds = [],
      createdScopeIds = [];
    // node:test after 按注册顺序执行：先停止服务并清理记录／连接，最后删除 schema。
    // 立即登记，初始化中途失败也清理；一项清理失败不得阻止其余资源释放。
    t.after(async () => {
      try {
        if (server) await new Promise(resolve => server.close(resolve));
        if (cloud && createdScopeIds.length)
          await cloud.prisma.analysisScopeSnapshot.deleteMany({ where: { id: { in: createdScopeIds } } });
        if (cloud && createdIds.length) await cloud.prisma.note.deleteMany({ where: { id: { in: createdIds } } });
      } finally {
        try {
          await cloud?.close();
        } finally {
          await database.close();
        }
      }
    });
    const { databaseUrl } = database;
    assert(['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname));
    assert.equal(process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES, '1');
    const { createPostgresAppContext } = await import('../../api/src/postgres-app.factory.js');
    const root = temporaryDirectory(t);
    cloud = await createPostgresAppContext({
      databaseUrl,
      uploadsDir: path.join(root, 'uploads'),
      storageRootDir: root
    });
    server = createServer({
      appContext: cloud,
      logger: {
        error(...args) {
          console.error(...args);
        }
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const space = await cloud.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    const workspace = openWorkspace(path.join(root, 'device'));
    const transfer = createAttachmentTransfer({
      uploadsDir: path.join(root, 'device', 'uploads'),
      storageRootDir: path.join(root, 'device')
    });
    const engine = createSyncEngine(workspace.store, {
      entityTransfer: transfer,
      autoSync: false,
      noteService: workspace.knowledge.noteService
    });
    t.after(async () => {
      await engine.close();
      workspace.store.close();
    });
    await engine.configure({ serverUrl: origin });
    clean({ engine });
    const pgKnowledge = cloud.modules.knowledge;
    const pgRestore = await pgKnowledge.noteService.createNote({
      title: 'PG 历史恢复',
      spaceId: space.id,
      rawMarkdown: markText('改写乙', 'history')
    });
    await engine.sync();
    clean({ engine });
    const pgRestoredSource = await pgKnowledge.knowledgeItemService.createCandidate({
      title: 'PG 历史来源',
      canonicalStatement: 'PG 历史来源',
      sourceMode: 'annotation',
      evidence: [{ sourceType: 'annotation', annotationId: inlineId(pgRestore.id, 'history') }]
    });
    await pgKnowledge.knowledgeItemService.confirmItem(pgRestoredSource.item.id);
    workspace.knowledge.noteService.updateNote(pgRestore.id, { rawMarkdown: '改写乙' });
    await engine.sync();
    clean({ engine });
    workspace.knowledge.noteService.updateNote(pgRestore.id, { rawMarkdown: markText('原文甲', 'history') });
    await engine.sync();
    clean({ engine });
    assert.equal(
      (await cloud.prisma.knowledgeEvidence.findUnique({ where: { id: pgRestoredSource.evidence[0].id } })).status,
      'stale'
    );
    assert.equal(
      (await cloud.prisma.knowledgeItem.findUnique({ where: { id: pgRestoredSource.item.id } })).reviewStatus,
      'needsRevision'
    );

    const pgMarker = `<!--k pgcode s=code r=0-1 h=${knowraCheck(' ')}-->`;
    const pgCodeText = `<mark data-k="pgcode">文字重点</mark>\n\n${pgMarker}\n\`\`\`\n \n\`\`\``;
    const pgCode = await pgKnowledge.noteService.createNote({
      title: 'PG 代码来源',
      spaceId: space.id,
      rawMarkdown: pgCodeText
    });
    await engine.sync();
    clean({ engine });
    const pgCodeSource = await pgKnowledge.knowledgeItemService.createCandidate({
      title: 'PG 代码来源知识',
      canonicalStatement: 'PG 代码来源知识',
      sourceMode: 'annotation',
      evidence: [{ sourceType: 'annotation', annotationId: inlineId(pgCode.id, 'pgcode') }]
    });
    await pgKnowledge.knowledgeItemService.confirmItem(pgCodeSource.item.id);
    workspace.knowledge.noteService.updateNote(pgCode.id, { rawMarkdown: pgCodeText.replace('\n \n', '\nX\n') });
    await engine.sync();
    clean({ engine });
    assert.equal(
      (await cloud.prisma.knowledgeEvidence.findUnique({ where: { id: pgCodeSource.evidence[0].id } })).status,
      'stale'
    );
    assert.equal(
      (await cloud.prisma.knowledgeItem.findUnique({ where: { id: pgCodeSource.item.id } })).reviewStatus,
      'needsRevision'
    );

    const pgOld = await pgKnowledge.noteService.createNote({
      title: 'PG 旧重点',
      spaceId: space.id,
      rawMarkdown: '前言\n\n旧重点\n\n结尾'
    });
    await engine.sync();
    clean({ engine });
    const [pgOldVersion] = await pgKnowledge.noteVersionService.listVersions({ noteId: pgOld.id });
    const pgOldAnchor = anchorForBlock(projectMarkdown(pgOld.rawMarkdown), 1);
    const pgLegacy = new ContentAnnotation({
      id: 'pg-legacy-after-mark',
      spaceId: space.id,
      noteId: pgOld.id,
      noteVersionId: pgOldVersion.id,
      schemaVersion: 2,
      scopeType: 'blocks',
      anchor: pgOldAnchor,
      originSnapshot: {
        noteVersionId: pgOldVersion.id,
        contentHash: pgOldVersion.contentHash,
        scopeType: 'blocks',
        segments: pgOldAnchor.segments,
        quoteText: pgOldAnchor.quoteText,
        headingPath: []
      },
      quoteText: pgOldAnchor.quoteText,
      fromPosition: pgOldAnchor.sourceStart,
      toPosition: pgOldAnchor.sourceEnd,
      anchorFingerprint: 'pg-legacy-after-mark',
      noteContentHash: pgOldVersion.contentHash,
      idempotencyKey: 'pg-legacy-after-mark'
    });
    await pgKnowledge.repositories.contentAnnotationRepository.save(pgLegacy);
    const pgLegacySource = await pgKnowledge.knowledgeItemService.createCandidate({
      title: 'PG 旧重点来源',
      canonicalStatement: 'PG 旧重点来源',
      sourceMode: 'annotation',
      evidence: [{ sourceType: 'annotation', annotationId: pgLegacy.id }]
    });
    await pgKnowledge.knowledgeItemService.confirmItem(pgLegacySource.item.id);
    const pgMarked = `${markText('前言', 'pg-lead')}\n\n旧重点\n\n结尾`;
    workspace.knowledge.noteService.updateNote(pgOld.id, { rawMarkdown: pgMarked });
    await engine.sync();
    clean({ engine });
    workspace.knowledge.noteService.updateNote(pgOld.id, { rawMarkdown: `${pgMarked}修改` });
    await engine.sync();
    clean({ engine });
    assert.equal(
      (await pgKnowledge.annotationScopeService.previewAnnotation(pgLegacy.id)).resolution.status,
      'resolved'
    );
    assert.equal(
      (await cloud.prisma.knowledgeEvidence.findUnique({ where: { id: pgLegacySource.evidence[0].id } })).status,
      'valid'
    );
    assert.equal(
      (await cloud.prisma.knowledgeItem.findUnique({ where: { id: pgLegacySource.item.id } })).reviewStatus,
      'confirmed'
    );

    const folder = workspace.knowledge.folderService.createFolder({
      spaceId: space.id,
      name: `PG 离线目录 ${Date.now()}`
    });
    const note = workspace.knowledge.noteService.createNote({
      title: 'PG 离线笔记',
      spaceId: space.id,
      folderId: folder.id,
      rawMarkdown: 'PostgreSQL 正文'
    });
    createdIds.push(note.id);
    await engine.sync();
    clean({ engine });
    assert.equal((await cloud.modules.knowledge.noteService.getNote(note.id)).rawMarkdown, 'PostgreSQL 正文');
    assert.equal(engine.status().pendingEntities, 0);
    const localContext = createAppContext({
      dataStore: workspace.store,
      uploadsDir: path.join(root, 'device', 'uploads'),
      storageRootDir: path.join(root, 'device')
    });
    const file = localContext.http.storage.uploadAttachment({
      noteId: note.id,
      fileName: 'PG 附件.txt',
      contentBase64: Buffer.from('真实数据库附件').toString('base64')
    });
    const text = `${markText('PostgreSQL', 'pg')} 正文\n[附件](/api/storage/attachments/${file.id}/content)`;
    workspace.knowledge.noteService.updateNote(note.id, { rawMarkdown: text });
    const annotation = { id: inlineId(note.id, 'pg') };
    await engine.sync();
    clean({ engine });
    assert.equal((await cloud.http.storage.getAttachmentContent({ id: file.id })).content.toString(), '真实数据库附件');
    assert(await cloud.prisma.contentAnnotation.findUnique({ where: { id: annotation.id } }));
    const second = openWorkspace(path.join(root, 'second'));
    const secondTransfer = createAttachmentTransfer({
      uploadsDir: path.join(root, 'second', 'uploads'),
      storageRootDir: path.join(root, 'second')
    });
    const secondEngine = createSyncEngine(second.store, {
      autoSync: false,
      entityTransfer: secondTransfer,
      noteService: second.knowledge.noteService
    });
    try {
      await secondEngine.configure({ serverUrl: origin });
      clean({ engine: secondEngine });
      assert(second.store.state.contentAnnotations.some(item => item.id === annotation.id));
      assert.equal(
        secondTransfer.read(second.store.state.attachments.find(item => item.id === file.id)).toString(),
        '真实数据库附件'
      );
    } finally {
      await secondEngine.close();
      second.store.close();
    }
    const cursor = (await cloud.http.sync.status()).cursor;
    const versionsBefore = await cloud.prisma.noteVersion.count({ where: { noteId: note.id } });
    workspace.knowledge.noteService.updateNote(note.id, { rawMarkdown: '失败后应回滚，再重试' });
    const { nextEntityUpload } = await import('../src/entity-sync-state.mjs');
    const operation = nextEntityUpload(workspace.store);
    await cloud.prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION knowra_batch_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'batch failure injection'; END $$`
    );
    await cloud.prisma.$executeRawUnsafe(
      'CREATE TRIGGER knowra_batch_reject BEFORE UPDATE ON "SyncJournal" FOR EACH ROW EXECUTE FUNCTION knowra_batch_reject()'
    );
    try {
      await assert.rejects(cloud.http.sync.pushBatch(operation), /batch failure injection/);
    } finally {
      await cloud.prisma.$executeRawUnsafe('DROP TRIGGER knowra_batch_reject ON "SyncJournal"');
      await cloud.prisma.$executeRawUnsafe('DROP FUNCTION knowra_batch_reject()');
    }
    assert.equal((await cloud.modules.knowledge.noteService.getNote(note.id)).rawMarkdown, text);
    assert.equal(await cloud.prisma.noteVersion.count({ where: { noteId: note.id } }), versionsBefore);
    assert.equal((await cloud.http.sync.status()).cursor, cursor);
    await engine.sync();
    clean({ engine });
    assert.equal(engine.status().pendingEntities, 0);
    const scopeService = workspace.knowledge.annotationScopeService;
    const scopeInput = {
      spaceId: space.id,
      mode: 'all',
      noteIds: [note.id],
      idempotencyKey: `pg-stage1-${Date.now()}`
    };
    const scope = scopeService.createAnalysisScope({
      ...scopeInput,
      previewHash: scopeService.previewAnalysisScope(scopeInput).previewHash
    });
    createdScopeIds.push(scope.id);
    const { item } = workspace.knowledge.knowledgeItemService.createCandidate({
      title: 'PG 回收站知识',
      canonicalStatement: '保留独立身份',
      sourceMode: 'manual'
    });
    const linked = workspace.knowledge.knowledgeItemService.createCandidate({
      title: 'PG 来源撤回',
      canonicalStatement: '人工核对来源',
      sourceMode: 'annotation',
      evidence: [{ sourceType: 'manual', quoteText: '历史摘录' }]
    });
    assert(workspace.store.state.analysisScopeSnapshots.some(row => row.id === scope.id));
    assert(
      (nextEntityUpload(workspace.store)?.changes ?? []).some(
        entry => entry.collection === 'analysisScopeSnapshots' && entry.id === scope.id
      )
    );
    await engine.sync();
    clean({ engine });
    assert.equal(engine.status().pendingEntities, 0, JSON.stringify(engine.status()));
    assert.equal((await cloud.prisma.analysisScopeSnapshot.findUnique({ where: { id: scope.id } })).mode, 'all');
    workspace.knowledge.knowledgeItemService.retireEvidence(linked.item.id, linked.evidence[0].id);
    await engine.sync();
    clean({ engine });
    assert.equal(
      (await cloud.prisma.knowledgeEvidence.findUnique({ where: { id: linked.evidence[0].id } })).applicabilityStatus,
      'withdrawn'
    );
    workspace.knowledge.annotationScopeService.trashAnalysisScope(scope.id, {
      spaceId: space.id,
      expectedUpdatedAt: scope.updatedAt
    });
    workspace.knowledge.knowledgeItemService.trash(item.id);
    workspace.knowledge.deleteFolderAndCleanup(folder.id, { mode: 'with-content' });
    await engine.sync();
    clean({ engine });
    assert(await cloud.prisma.analysisScopeSnapshot.findFirst({ where: { id: scope.id, deletedAt: { not: null } } }));
    assert(await cloud.prisma.knowledgeItem.findFirst({ where: { id: item.id, deletedAt: { not: null } } }));
    assert(await cloud.prisma.folder.findFirst({ where: { id: folder.id, deletedAt: { not: null } } }));
    assert(await cloud.prisma.note.findFirst({ where: { id: note.id, deletedAt: { not: null } } }));
    workspace.knowledge.restoreDeletedFolder(folder.id);
    const trashedScope = scopeService.getAnalysisScope(scope.id, space.id, true);
    scopeService.restoreAnalysisScope(scope.id, { spaceId: space.id, expectedUpdatedAt: trashedScope.updatedAt });
    workspace.knowledge.knowledgeItemService.restoreDeleted(item.id);
    await engine.sync();
    clean({ engine });
    assert.equal((await cloud.prisma.analysisScopeSnapshot.findUnique({ where: { id: scope.id } })).deletedAt, null);
    assert.equal((await cloud.prisma.knowledgeItem.findUnique({ where: { id: item.id } })).deletedAt, null);
    assert.equal((await cloud.prisma.note.findUnique({ where: { id: note.id } })).deletedAt, null);
  }
);

test('目录删除和标签合并与笔记引用同组提交', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  const b = cloud.device('b');
  await a.connect();
  await b.connect();
  const folder = a.knowledge.folderService.createFolder({ spaceId: cloud.space.id, name: '待删除目录' });
  const source = a.knowledge.tagService.createTag({ spaceId: cloud.space.id, name: '来源标签' });
  const target = a.knowledge.tagService.createTag({ spaceId: cloud.space.id, name: '目标标签' });
  a.knowledge.noteService.updateNote(cloud.note.id, { folderId: folder.id, tagIds: [source.id] });
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  a.knowledge.deleteFolderAndCleanup(folder.id, { mode: 'keep', destinationId: null });
  a.knowledge.mergeTags(source.id, target.id);
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  const note = b.knowledge.noteService.getNote(cloud.note.id);
  assert.equal(note.folderId, null);
  assert.deepEqual(note.tagIds, [target.id]);
  assert(!b.store.state.tags.some(item => item.id === source.id));
  const group = cloud.dataStore.getSyncJournal().changes.at(-1).items;
  assert(group.some(item => item.collection === 'notes'));
  assert(group.some(item => item.collection === 'folders' && item.value?.deletedAt));
  assert(group.some(item => item.collection === 'tags' && !item.value));
});

test('阶段1 目录组合回收、标注和已保存分析范围删除恢复跨设备收敛', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('stage1-a');
  const b = cloud.device('stage1-b');
  await a.connect();
  await b.connect();
  const folder = a.knowledge.folderService.createFolder({ spaceId: cloud.space.id, name: '可恢复目录' });
  a.knowledge.noteService.updateNote(cloud.note.id, { folderId: folder.id });
  const plain = a.knowledge.noteService.getNote(cloud.note.id).rawMarkdown;
  const marked = `${markText(plain.slice(0, 2), 'stage1')}${plain.slice(2)}`;
  const note = a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: marked });
  const annotation = { id: inlineId(note.id, 'stage1') };
  const scopeService = a.knowledge.annotationScopeService;
  const scopeInput = { spaceId: cloud.space.id, mode: 'all', noteIds: [note.id], idempotencyKey: 'stage1-scope' };
  const scope = scopeService.createAnalysisScope({
    ...scopeInput,
    previewHash: scopeService.previewAnalysisScope(scopeInput).previewHash
  });
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  a.knowledge.noteService.updateNote(note.id, { rawMarkdown: plain });
  scopeService.trashAnalysisScope(scope.id, { spaceId: cloud.space.id, expectedUpdatedAt: scope.updatedAt });
  a.knowledge.deleteFolderAndCleanup(folder.id, { mode: 'with-content' });
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  assert.equal(b.knowledge.noteService.getNote(note.id, { includeDeleted: true }).deleted, true);
  assert.equal(b.store.state.folders.find(item => item.id === folder.id).deletedAt !== null, true);
  assert.equal(b.store.state.contentAnnotations.find(item => item.id === annotation.id).lifecycleStatus, 'deleted');
  assert.equal(b.knowledge.annotationScopeService.listAnalysisScopes({ spaceId: cloud.space.id }).length, 0);
  assert.equal(
    b.knowledge.annotationScopeService.listAnalysisScopes({ spaceId: cloud.space.id, includeDeleted: true }).length,
    1
  );
  b.knowledge.restoreDeletedFolder(folder.id);
  b.knowledge.noteService.updateNote(note.id, { rawMarkdown: marked });
  const trashedScope = b.knowledge.annotationScopeService.getAnalysisScope(scope.id, cloud.space.id, true);
  b.knowledge.annotationScopeService.restoreAnalysisScope(scope.id, {
    spaceId: cloud.space.id,
    expectedUpdatedAt: trashedScope.updatedAt
  });
  await b.engine.sync();
  clean(b);
  await a.engine.sync();
  clean(a);
  assert.equal(a.knowledge.noteService.getNote(note.id).deleted, false);
  assert.equal(a.store.state.contentAnnotations.find(item => item.id === annotation.id).lifecycleStatus, 'active');
  assert.equal(cloud.dataStore.state.analysisScopeSnapshots.find(item => item.id === scope.id).deletedAt, null);
});

test('阶段1 标签删除事实阻止旧设备复活已删除标签', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('tag-a');
  const b = cloud.device('tag-b');
  await a.connect();
  await b.connect();
  const tag = a.knowledge.tagService.createTag({ spaceId: cloud.space.id, name: '即将删除' });
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  a.knowledge.deleteTagAndCleanup(tag.id);
  await a.engine.sync();
  clean(a);
  assert.equal(
    cloud.dataStore.state.tags.some(item => item.id === tag.id),
    false
  );
  b.knowledge.noteService.createNote({
    spaceId: cloud.space.id,
    title: '旧端待传',
    rawMarkdown: '内容',
    tagIds: [tag.id]
  });
  await b.engine.sync();
  assert.equal(
    cloud.dataStore.state.tags.some(item => item.id === tag.id),
    false
  );
  assert.equal(
    cloud.dataStore.state.notes.some(item => item.title === '旧端待传' && item.tagIds.includes(tag.id)),
    false
  );
});

test('阶段2 知识点永久删除后旧设备不能回写旧 ID', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('purge-a');
  const b = cloud.device('purge-b');
  await a.connect();
  await b.connect();
  const { item } = a.knowledge.knowledgeItemService.createCandidate({
    title: '待清理知识',
    canonicalStatement: '原定义'
  });
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  const stale = b.knowledge.knowledgeItemService.getItem(item.id);
  a.knowledge.knowledgeItemService.trash(item.id);
  await a.engine.sync();
  clean(a);
  const preflight = cloud.knowledge.inspectKnowledgePurge(item.id);
  assert.equal(preflight.decision, 'can-purge-no-history');
  cloud.knowledge.permanentlyDeleteKnowledgeItem(item.id, { expectedUpdatedAt: preflight.expectedUpdatedAt });
  b.knowledge.knowledgeItemService.updateItem(item.id, { title: '旧设备回写', expectedUpdatedAt: stale.updatedAt });
  await b.engine.sync();
  assert.equal(
    cloud.dataStore.state.knowledgeItems.some(record => record.id === item.id),
    false
  );
  assert(cloud.dataStore.getSyncJournal().tombstones[JSON.stringify(['knowledgeItems', item.id])]);
});

test('附件上传失败不发布正文引用；重试后完成全部关联事务', async t => {
  const cloud = await fixture(t);
  let fail = true;
  const a = cloud.device('a', (url, options) =>
    url.endsWith('/blobs') && fail ? Promise.reject(new Error('附件连接中断')) : fetch(url, options)
  );
  await a.connect();
  const file = a.context.http.storage.uploadAttachment({
    noteId: cloud.note.id,
    fileName: '断线.txt',
    contentBase64: Buffer.from('断线后恢复').toString('base64')
  });
  a.knowledge.noteService.updateNote(cloud.note.id, {
    rawMarkdown: `[附件](/api/storage/attachments/${file.id}/content)`
  });
  await a.engine.sync();
  assert(a.engine.status().error);
  assert.equal(cloud.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '基线');
  assert.equal(cloud.dataStore.state.attachments.length, 0);
  fail = false;
  await a.engine.retry();
  clean(a);
  assert.equal(a.engine.status().pendingEntities, 0);
});

test('JSON 完整事务写盘失败同时回滚业务、日志、序号和回执', async t => {
  const { writeJsonFileAtomically } = await import('../../api/src/infrastructure/atomic-json-file.ts');
  let fail = false;
  const cloud = await fixture(t, {
    writeJson: (...args) => {
      if (fail) throw new Error('模拟磁盘失败');
      return writeJsonFileAtomically(...args);
    }
  });
  const a = cloud.device('a');
  await a.connect();
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '必须保持原子' });
  const { nextEntityUpload } = await import('../src/entity-sync-state.mjs');
  const operation = nextEntityUpload(a.store);
  const before = JSON.stringify({ state: cloud.dataStore.state, journal: cloud.dataStore.getSyncJournal() });
  fail = true;
  await assert.rejects(cloud.context.http.sync.pushBatch(operation), error => error.code === 'STORAGE_WRITE_FAILED');
  assert.equal(JSON.stringify({ state: cloud.dataStore.state, journal: cloud.dataStore.getSyncJournal() }), before);
  fail = false;
  assert.equal((await cloud.context.http.sync.pushBatch(operation)).status, 'accepted');
});

test('暂停云端提交不影响离线落盘，恢复开关后继续同步', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  await a.connect();
  const previous = process.env.KNOWRA_SYNC_PUSH_ENABLED;
  try {
    process.env.KNOWRA_SYNC_PUSH_ENABLED = 'false';
    a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '灰度暂停仍保存' });
    await a.engine.sync();
    assert.equal(a.engine.status().error.code, 'SYNC_PUSH_PAUSED');
    assert.equal(a.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '灰度暂停仍保存');
  } finally {
    if (previous === undefined) delete process.env.KNOWRA_SYNC_PUSH_ENABLED;
    else process.env.KNOWRA_SYNC_PUSH_ENABLED = previous;
  }
  await a.engine.sync();
  clean(a);
  assert.equal(a.engine.status().pendingEntities, 0);
});

test('设备时钟相差一天仍按修订冲突，手动合并与副本保留内容', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  await a.connect();
  a.knowledge.noteService.updateNote(cloud.note.id, {
    rawMarkdown: '明天时钟的本地内容',
    updatedAt: new Date(Date.now() + 86400000).toISOString()
  });
  cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '云端独立内容' });
  await a.engine.sync();
  const conflict = a.engine.status().entityConflict;
  assert(conflict);
  await a.engine.resolve({ conflictId: conflict.id, choice: 'copy' });
  clean(a);
  assert(a.store.state.notes.some(note => note.id !== cloud.note.id && note.rawMarkdown === '明天时钟的本地内容'));
  assert.equal(a.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '云端独立内容');
});

test('取消重点（删掉正文标记）不会删除或降级已确认的知识', async t => {
  const cloud = await fixture(t);
  const plain = cloud.note.rawMarkdown;
  const marked = `${markText(plain.slice(0, 2), 'source')}${plain.slice(2)}`;
  const note = cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: marked });
  const annotationId = inlineId(note.id, 'source');
  const { item } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '知识来源',
    canonicalStatement: '原始证据',
    sourceMode: 'selection',
    evidence: [{ sourceType: 'annotation', annotationId }]
  });
  cloud.knowledge.knowledgeItemService.confirmItem(item.id);
  const a = cloud.device('a');
  await a.connect();
  a.knowledge.noteService.updateNote(note.id, { rawMarkdown: plain });
  await a.engine.sync();
  clean(a);
  assert.equal(
    cloud.dataStore.state.contentAnnotations.find(value => value.id === annotationId).lifecycleStatus,
    'deleted'
  );
  assert.equal(cloud.dataStore.state.knowledgeItems.find(value => value.id === item.id).reviewStatus, 'confirmed');
});

test('离线正文改写使设备未知的云端重点证据降级并同步到其他设备', async t => {
  for (const [name, next, expected] of [
    ['改写摘录', markText('改写后的内容', 'source'), 'stale'],
    ['改写重点和标记', '完全不同的正文', 'stale'],
    ['清空正文', '', 'insufficient'],
    ['取消重点', '原始重点内容', 'valid']
  ]) {
    await t.test(name, async t => {
      const cloud = await fixture(t);
      const note = cloud.knowledge.noteService.updateNote(cloud.note.id, {
        rawMarkdown: markText('原始重点内容', 'source')
      });
      const annotationId = inlineId(note.id, 'source');
      const a = cloud.device('a');
      await a.connect();
      clean(a);
      const { item, evidence } = cloud.knowledge.knowledgeItemService.createCandidate({
        title: '云端来源',
        canonicalStatement: '云端创建的来源证据',
        sourceMode: 'selection',
        evidence: [{ sourceType: 'annotation', annotationId }]
      });
      cloud.knowledge.knowledgeItemService.confirmItem(item.id);
      const objective = cloud.knowledge.learningObjectiveService.createCandidate({
        knowledgeItemId: item.id,
        objective: '解释来源内容',
        actionVerb: 'explain',
        cognitiveLevel: 'understand'
      });
      cloud.knowledge.learningObjectiveService.confirmObjective(objective.id);
      const question = cloud.knowledge.questionService.createQuestion({
        stem: '解释来源内容',
        referenceAnswer: '原始重点内容',
        learningObjectiveIds: [objective.id],
        sources: [{ sourceType: 'knowledgeEvidence', sourceId: evidence[0].id }]
      });
      a.knowledge.noteService.updateNote(note.id, { rawMarkdown: next });
      await a.engine.sync();
      clean(a);
      const b = cloud.device('b');
      await b.connect();
      clean(b);
      assert.equal(cloud.dataStore.state.knowledgeEvidence.find(value => value.id === evidence[0].id).status, expected);
      assert.equal(b.store.state.knowledgeEvidence.find(value => value.id === evidence[0].id).status, expected);
      for (const state of [cloud.dataStore.state, b.store.state]) {
        assert.equal(
          state.knowledgeItems.find(value => value.id === item.id).reviewStatus,
          expected === 'valid' ? 'confirmed' : 'needsRevision'
        );
        assert.equal(
          state.questionSources.find(value => value.questionId === question.id).status,
          expected === 'valid' ? 'active' : 'stale'
        );
      }
    });
  }
});

test('重点原文恢复后，各设备恢复对应证据健康但不自动确认知识', async t => {
  const cloud = await fixture(t);
  const note = cloud.knowledge.noteService.updateNote(cloud.note.id, {
    rawMarkdown: markText('原始重点内容', 'restore')
  });
  const { item, evidence } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '跨设备恢复来源',
    canonicalStatement: '原始证据',
    sourceMode: 'annotation',
    evidence: [{ sourceType: 'annotation', annotationId: inlineId(note.id, 'restore') }]
  });
  cloud.knowledge.knowledgeItemService.confirmItem(item.id);
  const question = cloud.knowledge.questionService.createQuestion({
    stem: '解释来源内容',
    referenceAnswer: '原始重点内容',
    sources: [{ sourceType: 'knowledgeEvidence', sourceId: evidence[0].id }]
  });
  const a = cloud.device('restore-writer');
  await a.connect();
  a.knowledge.noteService.updateNote(note.id, { rawMarkdown: markText('改写重点内容', 'restore') });
  await a.engine.sync();
  clean(a);
  assert.equal(cloud.dataStore.state.knowledgeEvidence.find(value => value.id === evidence[0].id).status, 'stale');
  a.knowledge.noteService.updateNote(note.id, { rawMarkdown: markText('原始重点内容', 'restore') });
  await a.engine.sync();
  clean(a);
  const b = cloud.device('restore-reader');
  await b.connect();
  clean(b);
  for (const state of [a.store.state, cloud.dataStore.state, b.store.state]) {
    assert.equal(state.knowledgeEvidence.find(value => value.id === evidence[0].id).status, 'valid');
    assert.equal(state.knowledgeItems.find(value => value.id === item.id).reviewStatus, 'needsRevision');
    assert.equal(state.questionSources.find(value => value.questionId === question.id).status, 'active');
  }
});

test('旧客户端上传重点变更时，云端按原文判断嵌套改写与空标记', async t => {
  for (const [name, before, after, markId, expected, anchorStatus] of [
    [
      '嵌套标记间插入',
      '<mark data-k="outer">甲<mark data-k="inner">乙</mark>丙</mark>尾',
      '甲新增<mark data-k="inner">乙</mark>丙尾',
      'outer',
      'stale',
      'needsReview'
    ],
    ['只剩空标记', markText('原始重点', 'source'), markText('', 'source'), 'source', 'insufficient', 'missing']
  ]) {
    await t.test(name, async t => {
      const cloud = await fixture(t);
      const note = cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: before });
      const id = inlineId(note.id, markId);
      const a = cloud.device('old-writer');
      await a.connect();
      clean(a);
      const { item, evidence } = cloud.knowledge.knowledgeItemService.createCandidate({
        title: '云端来源',
        canonicalStatement: '以原文为依据',
        sourceMode: 'annotation',
        evidence: [{ sourceType: 'annotation', annotationId: id }]
      });
      cloud.knowledge.knowledgeItemService.confirmItem(item.id);
      const question = cloud.knowledge.questionService.createQuestion({
        stem: '解释来源',
        referenceAnswer: '依据正文',
        sources: [{ sourceType: 'knowledgeEvidence', sourceId: evidence[0].id }]
      });
      a.knowledge.noteService.updateNote(note.id, { rawMarkdown: after });
      const { nextEntityUpload } = await import('../src/entity-sync-state.mjs');
      const operation = structuredClone(nextEntityUpload(a.store));
      const uploaded = operation.changes.find(entry => entry.collection === 'contentAnnotations' && entry.id === id);
      assert.ok(uploaded);
      // I4a 客户端尚不会派生来源健康状态。
      uploaded.value.anchorStatus = 'resolved';
      uploaded.value.anchorReason = null;
      uploaded.value.status = uploaded.value.lifecycleStatus === 'deleted' ? 'archived' : 'active';
      assert.equal((await cloud.context.http.sync.pushBatch(operation)).status, 'accepted');
      const b = cloud.device('reader');
      await b.connect();
      clean(b);
      for (const state of [cloud.dataStore.state, b.store.state]) {
        assert.equal(state.contentAnnotations.find(value => value.id === id).anchorStatus, anchorStatus);
        assert.equal(state.knowledgeEvidence.find(value => value.id === evidence[0].id).status, expected);
        assert.equal(state.knowledgeItems.find(value => value.id === item.id).reviewStatus, 'needsRevision');
        assert.equal(state.questionSources.find(value => value.questionId === question.id).status, 'stale');
      }
    });
  }
});

test('旧格式重点新建被同步门禁阻止，冻结请求和本地数据保留', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('legacy-writer');
  await a.connect();
  const note = a.knowledge.noteService.getNote(cloud.note.id);
  const version = a.knowledge.noteVersionService.listVersions({ noteId: note.id })[0];
  const anchor = anchorForBlock(projectMarkdown(note.rawMarkdown), 0);
  const row = new ContentAnnotation({
    id: 'offline-legacy',
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
    anchorFingerprint: 'legacy',
    noteContentHash: calculateContentHash(note.rawMarkdown),
    idempotencyKey: 'legacy'
  });
  a.knowledge.repositories.contentAnnotationRepository.save(row);
  const { nextEntityUpload } = await import('../src/entity-sync-state.mjs');
  const frozen = structuredClone(nextEntityUpload(a.store));
  await a.engine.sync();
  assert.equal(a.engine.status().error?.code, 'SYNC_CLIENT_UPGRADE_REQUIRED');
  assert.ok(a.engine.status().pendingEntities > 0);
  assert.deepEqual(nextEntityUpload(a.store), frozen);
  assert.equal(a.knowledge.contentAnnotationService.getAnnotation(row.id).quoteText, row.quoteText);
  assert.equal(
    cloud.dataStore.state.contentAnnotations.find(value => value.id === row.id),
    undefined
  );
});

test('已有旧重点备注仍可同步，正文改写时云端独有证据降级', async t => {
  const cloud = await fixture(t);
  const note = cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '原文 其他' });
  const version = cloud.knowledge.noteVersionService.listVersions({ noteId: note.id })[0];
  const anchor = anchorForBlock(projectMarkdown(note.rawMarkdown), 0);
  const row = new ContentAnnotation({
    id: 'cloud-legacy',
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
    anchorFingerprint: 'legacy-existing',
    noteContentHash: version.contentHash,
    idempotencyKey: 'legacy-existing'
  });
  cloud.knowledge.repositories.contentAnnotationRepository.save(row);
  const a = cloud.device('legacy-editor');
  await a.connect();
  a.knowledge.contentAnnotationService.updateAnnotation(row.id, {
    comment: '历史备注',
    expectedRevision: row.revision
  });
  await a.engine.sync();
  clean(a);
  assert.equal(cloud.dataStore.state.contentAnnotations.find(value => value.id === row.id).comment, '历史备注');
  const { item, evidence } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '旧重点来源',
    canonicalStatement: '历史来源',
    sourceMode: 'annotation',
    evidence: [{ sourceType: 'annotation', annotationId: row.id }]
  });
  cloud.knowledge.knowledgeItemService.confirmItem(item.id);
  a.knowledge.noteService.updateNote(note.id, { rawMarkdown: '完全改写' });
  await a.engine.sync();
  clean(a);
  const b = cloud.device('legacy-reader');
  await b.connect();
  clean(b);
  for (const state of [cloud.dataStore.state, b.store.state]) {
    assert.equal(state.contentAnnotations.find(value => value.id === row.id).anchorStatus, 'needsReview');
    assert.equal(state.knowledgeEvidence.find(value => value.id === evidence[0].id).status, 'stale');
    assert.equal(state.knowledgeItems.find(value => value.id === item.id).reviewStatus, 'needsRevision');
  }
  const current = a.knowledge.contentAnnotationService.getAnnotation(row.id);
  a.knowledge.contentAnnotationService.deleteAnnotation(row.id, { expectedRevision: current.revision });
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  for (const state of [cloud.dataStore.state, b.store.state]) {
    assert.equal(state.contentAnnotations.find(value => value.id === row.id).lifecycleStatus, 'deleted');
    assert.equal(state.knowledgeEvidence.find(value => value.id === evidence[0].id).status, 'stale');
  }
});

test('旧重点正文离线改写后撤销，保守降级与后续修改仍能同步', async t => {
  for (const [changedText, expectedAnchor, expectedEvidence] of [
    ['完全改写', 'needsReview', 'stale'],
    ['', 'missing', 'insufficient']
  ])
    await t.test(expectedAnchor, async t => {
      const cloud = await fixture(t);
      const note = cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '原文 其他' });
      const row = addLegacyAnnotation(cloud, note, 'legacy-reverted');
      cloud.knowledge.repositories.contentAnnotationRepository.save(row);
      const a = cloud.device('legacy-reverted-writer');
      await a.connect();
      const { item, evidence } = cloud.knowledge.knowledgeItemService.createCandidate({
        title: '旧重点来源',
        canonicalStatement: '历史来源',
        sourceMode: 'annotation',
        evidence: [{ sourceType: 'annotation', annotationId: row.id }]
      });
      cloud.knowledge.knowledgeItemService.confirmItem(item.id);
      a.knowledge.noteService.updateNote(note.id, { rawMarkdown: changedText });
      a.knowledge.noteService.updateNote(note.id, { rawMarkdown: note.rawMarkdown });
      await a.engine.sync();
      clean(a);
      assert.equal(a.engine.status().pendingEntities, 0);
      const b = cloud.device('legacy-reverted-reader');
      await b.connect();
      clean(b);
      for (const state of [a.store.state, cloud.dataStore.state, b.store.state]) {
        assert.equal(state.contentAnnotations.find(value => value.id === row.id).anchorStatus, expectedAnchor);
        assert.equal(state.knowledgeEvidence.find(value => value.id === evidence[0].id).status, expectedEvidence);
        assert.equal(state.knowledgeItems.find(value => value.id === item.id).reviewStatus, 'needsRevision');
      }
      a.knowledge.noteService.updateNote(note.id, { rawMarkdown: '原文 其他，后续修改' });
      await a.engine.sync();
      clean(a);
      assert.equal(cloud.knowledge.noteService.getNote(note.id).rawMarkdown, '原文 其他，后续修改');
      const { prepareBatchState } = await import('../../api/src/modules/sync/batch-domain.ts');
      const current = cloud.dataStore.state.contentAnnotations.find(value => value.id === row.id);
      const forged = { ...current, anchorStatus: 'resolved', anchorReason: null, status: 'active' };
      assert.throws(
        () =>
          prepareBatchState(
            cloud.dataStore.state,
            [{ collection: 'contentAnnotations', id: row.id, value: forged }],
            'demo'
          ),
        { code: 'SYNC_CLIENT_UPGRADE_REQUIRED' }
      );
      assert.throws(
        () =>
          prepareBatchState(
            cloud.dataStore.state,
            [{ collection: 'contentAnnotations', id: row.id, value: { ...current, quoteText: '伪造摘录' } }],
            'demo'
          ),
        { code: 'SYNC_CLIENT_UPGRADE_REQUIRED' }
      );
    });
});

test('云端旧重点之前新增标记后继续同步，无关修改不降级来源', async t => {
  const cloud = await fixture(t);
  const note = cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '前言\n\n旧重点\n\n结尾' });
  const a = cloud.device('legacy-mark-writer');
  await a.connect();
  const row = addLegacyAnnotation(cloud, note, 'legacy-after-mark', 1);
  cloud.knowledge.repositories.contentAnnotationRepository.save(row);
  const { item, evidence } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '旧重点来源',
    canonicalStatement: '旧重点来源',
    sourceMode: 'annotation',
    evidence: [{ sourceType: 'annotation', annotationId: row.id }]
  });
  cloud.knowledge.knowledgeItemService.confirmItem(item.id);
  a.knowledge.noteService.updateNote(note.id, { rawMarkdown: `${markText('前言', 'new')}\n\n旧重点\n\n结尾` });
  await a.engine.sync();
  clean(a);
  a.knowledge.noteService.updateNote(note.id, { rawMarkdown: `${markText('前言', 'new')}\n\n旧重点\n\n结尾修改` });
  await a.engine.sync();
  clean(a);
  const b = cloud.device('legacy-mark-reader');
  await b.connect();
  clean(b);
  for (const device of [a, b]) {
    assert.equal(device.knowledge.annotationScopeService.previewAnnotation(row.id).resolution.status, 'resolved');
    const scope = device.knowledge.annotationScopeService.previewAnalysisScope({
      spaceId: note.spaceId,
      mode: 'marked',
      annotationIds: [row.id]
    });
    assert.equal(scope.segments.map(segment => segment.markdown).join(''), '旧重点');
  }
  for (const state of [a.store.state, cloud.dataStore.state, b.store.state]) {
    assert.equal(state.contentAnnotations.find(value => value.id === row.id).anchorStatus, 'resolved');
    assert.equal(state.knowledgeEvidence.find(value => value.id === evidence[0].id).status, 'valid');
    assert.equal(state.knowledgeItems.find(value => value.id === item.id).reviewStatus, 'confirmed');
  }
});

test('云端旧重点缺少生命周期字段时，离线正文改写仍使来源降级', async t => {
  const cloud = await fixture(t);
  const note = cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '原文 其他' });
  const a = cloud.device('legacy-raw-writer');
  await a.connect();
  const row = addLegacyAnnotation(cloud, note, 'legacy-raw-fields');
  delete row.lifecycleStatus;
  delete row.anchorStatus;
  cloud.knowledge.repositories.contentAnnotationRepository.save(row);
  const { item, evidence } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '旧重点来源',
    canonicalStatement: '历史来源',
    sourceMode: 'annotation',
    evidence: [{ sourceType: 'annotation', annotationId: row.id }]
  });
  cloud.knowledge.knowledgeItemService.confirmItem(item.id);
  a.knowledge.noteService.updateNote(note.id, { rawMarkdown: '完全改写' });
  await a.engine.sync();
  clean(a);
  const b = cloud.device('legacy-raw-reader');
  await b.connect();
  clean(b);
  for (const state of [cloud.dataStore.state, b.store.state]) {
    assert.equal(state.contentAnnotations.find(value => value.id === row.id).anchorStatus, 'needsReview');
    assert.equal(state.knowledgeEvidence.find(value => value.id === evidence[0].id).status, 'stale');
    assert.equal(state.knowledgeItems.find(value => value.id === item.id).reviewStatus, 'needsRevision');
  }
});

test('正文同步未携带派生行时，云端按旧正文判断取消章节和多段重点', async t => {
  for (const [name, before, after] of [
    [
      '章节',
      '# 标题 <!--k source s=section-->\n这里 **粗体**。\n\n# 其他\n末尾',
      '# 标题\n这里 **粗体**。\n\n# 其他\n末尾！'
    ],
    ['多段', '<mark data-k="source">甲</mark>中<mark data-k="source">乙</mark>尾', '甲中乙尾！']
  ]) {
    await t.test(name, async t => {
      const cloud = await fixture(t);
      const note = cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: before });
      const annotationId = inlineId(note.id, 'source');
      const { item, evidence } = cloud.knowledge.knowledgeItemService.createCandidate({
        title: '来源',
        canonicalStatement: '原始证据',
        sourceMode: 'selection',
        evidence: [{ sourceType: 'annotation', annotationId }]
      });
      cloud.knowledge.knowledgeItemService.confirmItem(item.id);
      const a = cloud.device('a');
      await a.connect();
      clean(a);
      a.knowledge.noteService.updateNote(note.id, { rawMarkdown: after });
      const { nextEntityUpload } = await import('../src/entity-sync-state.mjs');
      const operation = nextEntityUpload(a.store);
      assert(operation.changes.some(entry => entry.collection === 'notes'));
      const changes = operation.changes.filter(
        entry => !['contentAnnotations', 'annotationRevisions'].includes(entry.collection)
      );
      const response = await cloud.context.http.sync.pushBatch({ ...operation, changes });
      assert.equal(response.status, 'accepted');
      const b = cloud.device('b');
      await b.connect();
      clean(b);
      for (const state of [cloud.dataStore.state, b.store.state]) {
        assert.equal(state.contentAnnotations.find(value => value.id === annotationId).anchorStatus, 'resolved');
        assert.equal(state.knowledgeEvidence.find(value => value.id === evidence[0].id).status, 'valid');
        assert.equal(state.knowledgeItems.find(value => value.id === item.id).reviewStatus, 'confirmed');
      }
    });
  }
});

test('回执裁剪后旧序号不能重复写入；旧游标重建仍保留本机新修改', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  await a.connect();
  const { nextEntityUpload } = await import('../src/entity-sync-state.mjs');
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '已确认操作' });
  const operation = nextEntityUpload(a.store);
  const accepted = await cloud.context.http.sync.pushBatch(operation);
  assert.equal(accepted.status, 'accepted');
  await a.engine.sync();
  clean(a);
  cloud.dataStore.runSyncTransaction(() => {
    delete cloud.dataStore.getSyncJournal().receipts[JSON.stringify([operation.deviceId, operation.operationId])];
  });
  const head = cloud.dataStore.getSyncJournal().head;
  await assert.rejects(cloud.context.http.sync.pushBatch(operation), error => error.code === 'SYNC_OPERATION_EXPIRED');
  assert.equal(cloud.dataStore.getSyncJournal().head, head);
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '过期游标后的离线修改' });
  cloud.knowledge.noteService.createNote({ title: '促使游标落后', rawMarkdown: '新远端笔记', spaceId: cloud.space.id });
  cloud.dataStore.runSyncTransaction(() => {
    cloud.dataStore.getSyncJournal().floor = cloud.dataStore.getSyncJournal().head;
  });
  await a.engine.sync();
  assert.equal(a.engine.status().error.code, 'CURSOR_EXPIRED');
  await a.engine.sync();
  clean(a);
  assert.equal(cloud.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '过期游标后的离线修改');
});

test('完整协议遇到未知实体或 schema 时不推进本地游标', async t => {
  const cloud = await fixture(t);
  let unknown = false;
  const a = cloud.device('a', async (url, options) => {
    if (unknown && url.includes('/changes?'))
      return new Response(
        JSON.stringify({
          data: {
            groups: [{ items: [{ collection: 'unknownFutureEntity', id: 'x', revision: 1, value: {} }] }],
            cursor: 'invalid',
            datasetEpoch: 'unknown',
            hasMore: false
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    return fetch(url, options);
  });
  await a.connect();
  const { readMeta } = await import('../src/sync-state.mjs');
  const cursor = a.store.readSync(db => readMeta(db, 'cursor'));
  // 云端游标与本地一致时不会拉取，先让云端前进一步才会触发拉取。
  cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '云端新正文' });
  unknown = true;
  await a.engine.sync();
  assert(a.engine.status().error);
  assert.equal(
    a.store.readSync(db => readMeta(db, 'cursor')),
    cursor
  );
  assert.equal(a.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '基线');
});

test('按关联组分批上传大量新笔记，不丢失版本或剩余队列', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  await a.connect();
  a.store.runTransaction(() => {
    for (let i = 0; i < 520; i++)
      a.knowledge.noteService.createNote({ title: `批次 ${i}`, rawMarkdown: `正文 ${i}`, spaceId: cloud.space.id });
  });
  await a.engine.sync();
  clean(a);
  assert.equal(cloud.dataStore.state.notes.length, 521);
  assert.equal(a.engine.status().pendingEntities, 0);
  assert.equal(a.store.getStatus().pendingOperations, 0);
});

test('完整协议仅阻塞冲突关联组；其他笔记继续同步且解决冲突不回退已确认内容', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  const b = cloud.device('b');
  const other = cloud.knowledge.noteService.createNote({
    title: '无关笔记',
    rawMarkdown: '另一个基线',
    spaceId: cloud.space.id
  });
  await a.connect();
  await b.connect();
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '本地冲突正文' });
  a.knowledge.noteService.updateNote(other.id, { rawMarkdown: '无关的新内容' });
  cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '云端冲突正文' });
  await a.engine.sync();
  clean(a);
  assert(a.engine.status().entityConflict);
  assert.equal(cloud.knowledge.noteService.getNote(other.id).rawMarkdown, '无关的新内容');
  await b.engine.sync();
  clean(b);
  assert.equal(b.knowledge.noteService.getNote(other.id).rawMarkdown, '无关的新内容');
  const conflict = a.engine.status().entityConflict;
  assert(!conflict.items.some(item => item.id === other.id));
  await a.engine.resolve({ conflictId: conflict.id, choice: 'remote' });
  clean(a);
  assert.equal(a.knowledge.noteService.getNote(other.id).rawMarkdown, '无关的新内容');
  assert.equal(a.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '云端冲突正文');
});

for (const hasDependencies of [false, true])
  test(`桌面分批容量包含最终 JSON 的操作信封、UTF-8 与${hasDependencies ? '非空依赖' : '空依赖'}`, async t => {
    const { nextEntityUpload, acknowledgeEntityUpload } = await import('../src/entity-sync-state.mjs');
    const { writeMeta } = await import('../src/sync-state.mjs');
    const { SYNC_CLIENT_BATCH_BODY_LIMIT_BYTES: limit } = await import('@study-accelerator/shared/http-limits');
    const workspace = openWorkspace(temporaryDirectory(t));
    t.after(() => workspace.store.close());
    workspace.knowledge.noteService.createNote({ title: '大正文一', rawMarkdown: '', spaceId: workspace.space.id });
    workspace.knowledge.noteService.createNote({ title: '大正文二', rawMarkdown: '', spaceId: workspace.space.id });
    // 本例隔离信封与依赖的容量计量；完整正文版本的原子分批由 long-edit-sync 的 HTTP 用例覆盖。
    workspace.store.syncTransaction((_db, state) => {
      state.noteVersions.length = 0;
      for (const note of state.notes) note.annotationStructure = null;
    });
    if (hasDependencies) {
      const initial = nextEntityUpload(workspace.store);
      acknowledgeEntityUpload(workspace.store, initial, {
        status: 'accepted',
        entries: initial.changes.map(entry => ({ ...entry, revision: 1 }))
      });
      workspace.store.syncTransaction((_db, state) => {
        state.notes[0].rawMarkdown = 'x';
        state.notes[1].rawMarkdown = 'y';
      });
    }
    const small = nextEntityUpload(workspace.store);
    const overhead = Buffer.byteLength(JSON.stringify(small));
    workspace.store.syncTransaction((db, state) => {
      writeMeta(db, 'entityUpload', null);
      state.notes[0].rawMarkdown = '中' + 'a'.repeat(limit / 2 - 3);
      state.notes[1].rawMarkdown = 'b'.repeat(limit / 2 - overhead + 1 + (hasDependencies ? 2 : 0));
    });
    const candidate = {
      ...small,
      changes: small.changes.map(entry =>
        entry.collection === 'notes'
          ? {
              ...entry,
              value: {
                ...entry.value,
                rawMarkdown: workspace.store.state.notes.find(note => note.id === entry.id).rawMarkdown
              }
            }
          : entry
      )
    };
    assert.equal(Buffer.byteLength(JSON.stringify(candidate)), limit + 1);
    // 隔离硬容量边界，避免慢速传输的软目标提前结束本例选择。
    const { selectEntityBatch } = await import('../src/entity-batches.mjs');
    const base = workspace.store.readSync(
      db =>
        new Map(
          db
            .prepare('SELECT * FROM sync_base')
            .all()
            .map(row => [
              JSON.stringify([row.collection, row.id]),
              { collection: row.collection, id: row.id, revision: row.server_revision, value: JSON.parse(row.payload) }
            ])
        )
    );
    const entries = selectEntityBatch(candidate.changes, workspace.store.state, base, {
      targetEntries: Infinity,
      targetBytes: Infinity,
      measureBytes: changes => Buffer.byteLength(JSON.stringify({ ...candidate, changes }))
    });
    const operation = { ...candidate, changes: entries };
    assert.equal(operation.dependencies.length, hasDependencies ? 1 : 0);
    assert(Buffer.byteLength(JSON.stringify(operation)) <= limit);
    assert.equal(
      operation.changes.filter(entry => entry.collection === 'notes').length,
      1,
      '最终信封超限时应分批，不能按记录大小放行'
    );
  });
