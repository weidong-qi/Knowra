import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { temporaryDirectory } from './helpers.mjs';

for (const sqlite of [false, true])
  test(`${sqlite ? 'SQLite 离线' : 'JSON 云端'}：取消内联重点超过七天后仍可恢复历史正文`, t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T12:00:00.000Z') });
    const root = temporaryDirectory(t);
    const store = sqlite
      ? createSqliteDataStore(path.join(root, 'local.sqlite'))
      : createFileDataStore(path.join(root, 'cloud.json'));
    t.after(() => store.close?.());
    const knowledge = createAppContext({ dataStore: store, storageRootDir: root }).modules.knowledge;
    const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    let note = knowledge.noteService.createNote({
      spaceId: space.id,
      title: '恢复重点',
      rawMarkdown: '甲<mark data-k="m1" data-t="key">乙</mark>丙'
    });
    const previousVersion = knowledge.noteVersionService.listVersions({ noteId: note.id })[0];
    const original = store.state.contentAnnotations.find(item => item.anchor?.markId === 'm1');
    knowledge.contentAnnotationService.updateAnnotation(original.id, {
      expectedRevision: original.revision,
      comment: '历史备注'
    });
    note = knowledge.noteService.updateNote(note.id, { rawMarkdown: '甲乙丙', expectedUpdatedAt: note.updatedAt });
    const removed = store.state.contentAnnotations.find(item => item.id === original.id);
    assert.equal(removed.lifecycleStatus, 'deleted');
    t.mock.timers.setTime(Date.parse('2026-10-22T12:00:00.000Z'));
    note = knowledge.noteService.updateNote(note.id, { rawMarkdown: '甲乙丙丁', expectedUpdatedAt: note.updatedAt });
    assert.ok(
      store.state.contentAnnotations.some(item => item.id === original.id),
      '可恢复的确定性重点 ID 不进入不可逆回收'
    );
    if (sqlite)
      assert.equal(
        store.deletionFacts
          .list()
          .some(fact => fact.collection === 'contentAnnotations' && fact.entityId === original.id),
        false
      );
    const historical = knowledge.noteVersionService.getVersion(previousVersion.id, note.id);
    note = knowledge.noteService.updateNote(note.id, {
      rawMarkdown: historical.content,
      expectedUpdatedAt: note.updatedAt
    });
    const restored = knowledge.contentAnnotationService.getAnnotation(original.id);
    assert.equal(note.rawMarkdown, historical.content);
    assert.equal(restored.lifecycleStatus, 'active');
    assert.equal(restored.revision, removed.revision + 1);
    assert.equal(restored.comment, '历史备注');
    assert.equal(
      store.state.annotationRevisions.find(
        item => item.annotationId === original.id && item.revision === restored.revision
      ).operation,
      'restored'
    );
  });
