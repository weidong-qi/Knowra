import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { anchorForBlock, projectMarkdown } from '@study-accelerator/content-anchor';
import { ContentAnnotation } from '../../api/src/modules/knowledge/domain/content-annotation.ts';
import { NoteVersion } from '../../api/src/modules/knowledge/domain/note-version.ts';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { temporaryDirectory, markText, inlineId } from './helpers.mjs';

for (const sqlite of [false, true])
  for (const schemaVersion of [1, 2])
    test(`${sqlite ? 'SQLite' : 'JSON'}：普通保存与重启保全到期 v${schemaVersion} 旧重点及其历史`, t => {
      const root = temporaryDirectory(t);
      const file = path.join(root, sqlite ? 'local.sqlite' : 'cloud.json');
      const open = () => (sqlite ? createSqliteDataStore(file) : createFileDataStore(file));
      let store = open();
      t.after(() => store.close?.());
      const knowledge = createAppContext({ dataStore: store, storageRootDir: root }).modules.knowledge;
      const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
      const note = knowledge.noteService.createNote({ spaceId: space.id, title: '到期保全', rawMarkdown: '当前正文' });
      const version = new NoteVersion({
        id: 'old-version',
        noteId: note.id,
        content: '旧正文',
        createdAt: '2026-01-01T00:00:00Z'
      });
      knowledge.repositories.noteVersionRepository.save(version);
      const anchor = { ...anchorForBlock(projectMarkdown(version.content), 0), noteVersionId: version.id };
      const annotation = new ContentAnnotation({
        id: `legacy-${schemaVersion}`,
        noteId: note.id,
        spaceId: space.id,
        noteVersionId: version.id,
        schemaVersion,
        scopeType: 'blocks',
        anchor,
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
        anchorFingerprint: 'legacy-retention',
        noteContentHash: version.contentHash,
        idempotencyKey: 'legacy-retention',
        revision: 13,
        lifecycleStatus: 'deleted',
        deletedAt: '2026-01-02T00:00:00Z'
      });
      knowledge.repositories.contentAnnotationRepository.save(annotation);
      for (let revision = 1; revision <= 13; revision++)
        knowledge.repositories.annotationRevisionRepository.save({
          id: `annotation-revision-${revision}`,
          annotationId: annotation.id,
          revision,
          operation: 'metadataUpdated',
          oldAnchor: null,
          newAnchor: anchor,
          rangeSummary: { scopeType: 'blocks', quoteText: anchor.quoteText },
          reason: null,
          createdAt: '2026-01-02T00:00:00Z'
        });
      const before = structuredClone({
        annotations: store.state.contentAnnotations,
        revisions: store.state.annotationRevisions,
        versions: store.state.noteVersions
      });
      knowledge.noteService.updateNote(note.id, {
        title: '到期后仍可正常保存',
        updatedAt: new Date(Date.now() + 1000).toISOString()
      });
      for (let restart = 0; restart < 2; restart++) {
        assert.deepEqual(structuredClone(store.state.contentAnnotations), before.annotations);
        assert.deepEqual(structuredClone(store.state.annotationRevisions), before.revisions);
        assert.deepEqual(structuredClone(store.state.noteVersions), before.versions);
        assert.equal(store.deletionFacts?.has('contentAnnotations', annotation.id) ?? false, false);
        store.close?.();
        store = open();
      }
    });

for (const sqlite of [false, true])
  test(`${sqlite ? 'SQLite 离线' : 'JSON 在线'}：连续编辑不产生重点自动修订，人工修改备注正常保存`, t => {
    // updatedAt 模拟连续编辑，修订 createdAt 仍取系统时钟；固定在采样桶内，避免运行跨桶改变恢复点数量。
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T12:05:00.000Z') });
    const root = temporaryDirectory(t);
    const store = sqlite
      ? createSqliteDataStore(path.join(root, 'local.sqlite'))
      : createFileDataStore(path.join(root, 'cloud.json'));
    t.after(() => store.close?.());
    const knowledge = createAppContext({ dataStore: store, storageRootDir: root }).modules.knowledge;
    const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    const markdown = `# 标题\n\n${markText('重点内容', 'history')}\n\n其它 0`;
    const note = knowledge.noteService.createNote({ spaceId: space.id, title: '长时间编辑', rawMarkdown: markdown });
    const annotation = { id: inlineId(note.id, 'history') },
      start = Date.parse(note.updatedAt);
    for (let i = 1; i <= 100; i++)
      knowledge.noteService.updateNote(note.id, {
        rawMarkdown: markdown.replace('其它 0', `其它 ${i}`),
        updatedAt: new Date(start + i * 1000).toISOString()
      });
    const current = knowledge.contentAnnotationService.getAnnotation(annotation.id);
    // 位置在正文标记里：编辑别处既不推进重点修订号，也不产生自动修订。
    assert.equal(current.revision, 1);
    assert.equal(current.anchorStatus, 'resolved');
    assert.equal(current.quoteText, '重点内容');
    assert.ok(
      store.state.annotationRevisions.some(
        record => record.annotationId === current.id && record.revision === current.revision
      ),
      '当前修订始终有来源见证'
    );
    assert.equal(store.state.annotationRevisions.filter(record => record.operation === 'sourceReconciled').length, 0);
    assert.ok(
      store.state.noteVersions.length <= 6,
      `连续编辑只保留少量恢复点和必要锚点：${store.state.noteVersions.length}`
    );
    knowledge.noteService.updateNote(note.id, {
      rawMarkdown: markdown,
      updatedAt: new Date(start + 101000).toISOString()
    });
    assert.equal(knowledge.contentAnnotationService.getAnnotation(annotation.id).anchorStatus, 'resolved');
    for (let i = 0; i < 30; i++) {
      const previous = knowledge.contentAnnotationService.getAnnotation(annotation.id);
      knowledge.contentAnnotationService.updateAnnotation(annotation.id, {
        expectedRevision: previous.revision,
        comment: `批注 ${i}`
      });
    }
    assert.equal(knowledge.contentAnnotationService.getAnnotation(annotation.id).comment, '批注 29');
    assert.ok(store.state.annotationRevisions.length <= 11, '十条普通恢复点加当前修订，不无限保留人工过程');
  });

test('SQLite 离线：取消超过 7 天的内联重点保留确定性 ID，不因同步状态永久删除', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T12:00:00.000Z') });
  const root = temporaryDirectory(t);
  const store = createSqliteDataStore(path.join(root, 'local.sqlite'));
  t.after(() => store.close?.());
  const knowledge = createAppContext({ dataStore: store, storageRootDir: root }).modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  let note = knowledge.noteService.createNote({
    spaceId: space.id,
    title: '内联回收',
    rawMarkdown: '甲<mark data-k="m1" data-t="key">乙</mark>丙<mark data-k="m2" data-t="key">丁</mark>'
  });
  note = knowledge.noteService.updateNote(note.id, { rawMarkdown: '甲乙丙丁', expectedUpdatedAt: note.updatedAt });
  const [first, second] = ['m1', 'm2'].map(markId =>
    store.state.contentAnnotations.find(item => item.anchor?.markId === markId)
  );
  assert.equal(first.lifecycleStatus, 'deleted');
  // m2 已同步过：两种同步状态都不能让可恢复的确定性 ID 进入永久删除。
  store.metadataTransaction(db =>
    db
      .prepare('INSERT INTO sync_base VALUES (?, ?, ?, ?)')
      .run('contentAnnotations', second.id, 1, JSON.stringify(second))
  );
  t.mock.timers.setTime(Date.parse('2026-10-22T12:00:00.000Z'));
  knowledge.noteService.updateNote(note.id, {
    rawMarkdown: '甲乙丙丁戊',
    expectedUpdatedAt: knowledge.noteService.getNote(note.id).updatedAt
  });
  assert.equal(
    store.state.contentAnnotations.some(item => item.id === first.id),
    true,
    '从未上传的已取消内联重点也可恢复'
  );
  assert.equal(
    store.state.contentAnnotations.some(item => item.id === second.id),
    true,
    '已同步的重点保留'
  );
  assert.equal(
    store.state.annotationRevisions.some(item => item.annotationId === first.id && item.revision === first.revision),
    true
  );
});
