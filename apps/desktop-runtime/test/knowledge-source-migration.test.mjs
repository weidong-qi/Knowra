import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.js';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createAppContext } from '../../api/src/app.factory.js';
import { validateLocalSnapshot } from '../../api/src/infrastructure/local-data-schema.js';
import { temporaryDirectory, markText, inlineId } from './helpers.mjs';

for (const driver of ['sqlite', 'json'])
  test(`${driver}：升级修复旧重选标注遗漏的知识降级，落盘并保留同步记录`, t => {
    const root = temporaryDirectory(t);
    const file = path.join(root, driver === 'sqlite' ? 'local.sqlite' : 'cloud.json');
    const open = () => (driver === 'sqlite' ? createSqliteDataStore(file) : createFileDataStore(file));
    let store = open();
    const knowledge = createAppContext({
      dataStore: store,
      uploadsDir: path.join(root, 'uploads'),
      storageRootDir: root
    }).modules.knowledge;
    const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    const note = knowledge.noteService.createNote({
      title: '旧来源',
      rawMarkdown: `${markText('旧版确认知识后', 'legacy')}重新选择了其他文字`,
      spaceId: space.id
    });
    const annotation = knowledge.contentAnnotationService.getAnnotation(inlineId(note.id, 'legacy'));
    const { item, evidence } = knowledge.knowledgeItemService.createCandidate({
      title: '已确认知识',
      canonicalStatement: '历史陈述仍应保留',
      sourceMode: 'annotation',
      evidence: [{ sourceType: 'annotation', annotationId: annotation.id }]
    });
    const confirmed = knowledge.knowledgeItemService.confirmItem(item.id);
    const oldRecord = { ...evidence[0], quoteText: '旧版', status: 'valid' };
    const count = driver === 'sqlite' ? store.readOutbox().length : store.getSyncJournal().head;
    const invalidSnapshot = store.exportSnapshot();
    invalidSnapshot.data.knowledgeEvidence[0] = oldRecord;
    assert.throws(() => validateLocalSnapshot(invalidSnapshot), /not confirmable/);
    if (driver === 'sqlite') {
      store.close();
      const db = new DatabaseSync(file);
      db.prepare("UPDATE entities SET payload = ? WHERE collection = 'knowledgeEvidence' AND id = ?").run(
        JSON.stringify(oldRecord),
        evidence[0].id
      );
      db.close();
    } else {
      const document = JSON.parse(fs.readFileSync(file, 'utf8'));
      document.knowledgeEvidence[0] = oldRecord;
      fs.writeFileSync(file, JSON.stringify(document));
    }
    store = open();
    assert.equal(store.state.knowledgeEvidence[0].quoteText, '旧版');
    assert.equal(store.state.knowledgeEvidence[0].status, 'stale');
    assert.equal(store.state.knowledgeItems[0].reviewStatus, 'needsRevision');
    const repairedTimestamp = store.state.knowledgeItems[0].updatedAt;
    assert(Date.parse(repairedTimestamp) > Date.parse(confirmed.updatedAt));
    assert.equal(driver === 'sqlite' ? store.readOutbox().length : store.getSyncJournal().head, count + 1);
    store.close?.();
    store = open();
    assert.equal(store.state.knowledgeItems[0].updatedAt, repairedTimestamp);
    assert.equal(driver === 'sqlite' ? store.readOutbox().length : store.getSyncJournal().head, count + 1);
    store.close?.();
  });

for (const driver of ['sqlite', 'json'])
  test(`${driver}：重点摘录恢复时逐条重算证据，撤回与审核状态不自动恢复`, t => {
    const root = temporaryDirectory(t);
    const file = path.join(root, driver === 'sqlite' ? 'local.sqlite' : 'cloud.json');
    const open = () => (driver === 'sqlite' ? createSqliteDataStore(file) : createFileDataStore(file));
    let store = open();
    const context = () =>
      createAppContext({ dataStore: store, uploadsDir: path.join(root, 'uploads'), storageRootDir: root });
    let knowledge = context().modules.knowledge;
    const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    let note = knowledge.noteService.createNote({
      title: '重点来源',
      rawMarkdown: markText('原文', 'restore'),
      spaceId: space.id
    });
    const annotationId = inlineId(note.id, 'restore');
    const candidate = title =>
      knowledge.knowledgeItemService.createCandidate({
        title,
        canonicalStatement: title,
        sourceMode: 'annotation',
        evidence: [{ sourceType: 'annotation', annotationId }]
      });
    const original = candidate('原文来源');
    knowledge.knowledgeItemService.confirmItem(original.item.id);
    const withdrawn = candidate('已撤回来源');
    knowledge.knowledgeItemService.retireEvidence(withdrawn.item.id, withdrawn.evidence[0].id);
    const question = knowledge.questionService.createQuestion({
      stem: '检查来源',
      referenceAnswer: '原文',
      sources: [{ sourceType: 'knowledgeEvidence', sourceId: original.evidence[0].id }]
    });
    note = knowledge.noteService.updateNote(note.id, { rawMarkdown: markText('改写', 'restore') });
    assert.equal(knowledge.repositories.knowledgeEvidenceRepository.findById(original.evidence[0].id).status, 'stale');
    const changed = candidate('改写来源');
    knowledge.knowledgeItemService.confirmItem(changed.item.id);
    knowledge.noteService.updateNote(note.id, { rawMarkdown: markText('原文', 'restore') });
    const check = () => {
      assert.equal(
        knowledge.repositories.knowledgeEvidenceRepository.findById(original.evidence[0].id).status,
        'valid'
      );
      assert.equal(knowledge.repositories.knowledgeEvidenceRepository.findById(changed.evidence[0].id).status, 'stale');
      assert.equal(
        knowledge.repositories.knowledgeEvidenceRepository.findById(withdrawn.evidence[0].id).applicabilityStatus,
        'withdrawn'
      );
      assert.equal(
        knowledge.repositories.knowledgeItemRepository.findById(original.item.id).reviewStatus,
        'needsRevision'
      );
      assert.equal(
        knowledge.repositories.knowledgeItemRepository.findById(changed.item.id).reviewStatus,
        'needsRevision'
      );
      assert.equal(
        knowledge.repositories.questionSourceRepository.list({ questionId: question.id })[0].status,
        'active'
      );
    };
    check();
    store.close?.();
    store = open();
    knowledge = context().modules.knowledge;
    check();
    store.close?.();
  });
