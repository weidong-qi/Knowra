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
import { knowraCheck } from '@study-accelerator/shared/knowra-marks';

for (const driver of ['sqlite', 'json'])
  test(`${driver}：取消重点后恢复不同历史摘录，来源降级并在重启后保留`, t => {
    const root = temporaryDirectory(t);
    const file = path.join(root, driver === 'sqlite' ? 'local.sqlite' : 'cloud.json');
    const open = () => (driver === 'sqlite' ? createSqliteDataStore(file) : createFileDataStore(file));
    let store = open();
    const context = () =>
      createAppContext({ dataStore: store, uploadsDir: path.join(root, 'uploads'), storageRootDir: root });
    let knowledge = context().modules.knowledge;
    const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    let note = knowledge.noteService.createNote({
      title: '历史来源',
      rawMarkdown: markText('原文甲', 'history'),
      spaceId: space.id
    });
    const original = knowledge.noteVersionService.listVersions({ noteId: note.id })[0].content;
    note = knowledge.noteService.updateNote(note.id, { rawMarkdown: markText('改写乙', 'history') });
    const { item, evidence } = knowledge.knowledgeItemService.createCandidate({
      title: '改写来源',
      canonicalStatement: '改写来源',
      sourceMode: 'annotation',
      evidence: [{ sourceType: 'annotation', annotationId: inlineId(note.id, 'history') }]
    });
    knowledge.knowledgeItemService.confirmItem(item.id);
    const question = knowledge.questionService.createQuestion({
      stem: '检查来源',
      referenceAnswer: '改写乙',
      sources: [{ sourceType: 'knowledgeEvidence', sourceId: evidence[0].id }]
    });
    note = knowledge.noteService.updateNote(note.id, { rawMarkdown: '改写乙' });
    knowledge.noteService.updateNote(note.id, { rawMarkdown: original });
    const check = () => {
      assert.equal(knowledge.noteService.getNote(note.id).rawMarkdown, original);
      assert.equal(
        knowledge.repositories.contentAnnotationRepository.findById(inlineId(note.id, 'history')).quoteText,
        '原文甲'
      );
      assert.equal(knowledge.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status, 'stale');
      assert.equal(knowledge.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'needsRevision');
      assert.equal(
        knowledge.repositories.questionSourceRepository.list({ questionId: question.id })[0].status,
        'stale'
      );
    };
    check();
    store.close?.();
    store = open();
    knowledge = context().modules.knowledge;
    check();
    store.close?.();
  });

for (const driver of ['sqlite', 'json'])
  test(`${driver}：跨文字和代码重点的代码校验失效仍可保存并降级`, t => {
    const root = temporaryDirectory(t);
    const file = path.join(root, driver === 'sqlite' ? 'local.sqlite' : 'cloud.json');
    const open = () => (driver === 'sqlite' ? createSqliteDataStore(file) : createFileDataStore(file));
    let store = open();
    const context = () =>
      createAppContext({ dataStore: store, uploadsDir: path.join(root, 'uploads'), storageRootDir: root });
    let knowledge = context().modules.knowledge;
    const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    const marker = `<!--k combined s=code r=0-1 h=${knowraCheck(' ')}-->`;
    const original = `<mark data-k="combined">文字重点</mark>\n\n${marker}\n\`\`\`\n \n\`\`\``;
    let note = knowledge.noteService.createNote({ title: '代码来源', rawMarkdown: original, spaceId: space.id });
    const annotationId = inlineId(note.id, 'combined');
    const { item, evidence } = knowledge.knowledgeItemService.createCandidate({
      title: '代码来源',
      canonicalStatement: '代码来源',
      sourceMode: 'annotation',
      evidence: [{ sourceType: 'annotation', annotationId }]
    });
    knowledge.knowledgeItemService.confirmItem(item.id);
    const changed = original.replace('\n \n', '\nX\n');
    note = knowledge.noteService.updateNote(note.id, { rawMarkdown: changed });
    const check = () => {
      assert.equal(knowledge.noteService.getNote(note.id).rawMarkdown, changed);
      const annotation = knowledge.repositories.contentAnnotationRepository.findById(annotationId);
      assert.equal(annotation.quoteText, '文字重点');
      assert.equal(annotation.anchorStatus, 'needsReview');
      assert.equal(knowledge.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status, 'stale');
      assert.equal(knowledge.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'needsRevision');
    };
    check();
    store.close?.();
    store = open();
    knowledge = context().modules.knowledge;
    check();
    knowledge.noteService.updateNote(note.id, { rawMarkdown: original });
    assert.equal(knowledge.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status, 'valid');
    assert.equal(knowledge.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'needsRevision');
    store.close?.();
  });

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
