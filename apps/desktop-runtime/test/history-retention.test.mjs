import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.js';
import { createAppContext } from '../../api/src/app.factory.js';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { temporaryDirectory, markText, inlineId } from './helpers.mjs';

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
