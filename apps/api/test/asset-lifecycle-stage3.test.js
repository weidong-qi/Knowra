import assert from 'node:assert/strict';
import { createKnowledgeModule } from '../src/modules/knowledge/index.ts';
import { createAppContext } from '../src/app.factory.ts';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from '../src/server.ts';

function createObjective(knowledge, prefix) {
  const item = knowledge.knowledgeItemService.createCandidate({
    id: `${prefix}-item`,
    title: '导数',
    canonicalStatement: '导数表示变化率',
    sourceMode: 'manual'
  }).item;
  knowledge.knowledgeItemService.confirmItem(item.id);
  const objective = knowledge.learningObjectiveService.createCandidate({
    id: `${prefix}-objective`,
    knowledgeItemId: item.id,
    objective: '能够解释导数的含义',
    actionVerb: 'explain',
    cognitiveLevel: 'understand'
  });
  knowledge.learningObjectiveService.confirmObjective(objective.id);
  return objective;
}

export const assetLifecycleStage3Tests = [
  {
    name: '阶段3 学习目标回收后停止新出题并降级现有正式题，恢复需要重新确认',
    run() {
      const knowledge = createKnowledgeModule();
      const objective = createObjective(knowledge, 'lc15');
      const question = knowledge.questionService.createQuestion({
        id: 'lc15-question',
        stem: '请解释导数。',
        questionType: 'shortAnswer',
        referenceAnswer: '变化率',
        learningObjectiveIds: [objective.id],
        sources: [{ sourceType: 'learningObjective', sourceId: objective.id, quote: objective.objective }]
      });
      knowledge.questionService.validateQuestion(question.id);
      knowledge.questionService.confirmQuestion(question.id);
      const trashed = knowledge.trainingAssetLifecycle.trash('learningObjective', objective.id);
      assert(trashed.deletedAt);
      assert.equal(knowledge.learningObjectiveService.listObjectives().length, 0);
      assert.equal(knowledge.questionService.getQuestion(question.id).reviewStatus, 'candidate');
      assert.equal(knowledge.questionService.getQuestion(question.id).sources[0].status, 'stale');
      assert.throws(
        () =>
          knowledge.questionService.createQuestion({
            id: 'lc15-new',
            stem: '新题',
            learningObjectiveIds: [objective.id]
          }),
        { code: 'LEARNING_OBJECTIVE_NOT_FOUND' }
      );
      const preview = knowledge.trainingAssetLifecycle.inspect('learningObjective', objective.id);
      assert.equal(preview.decision, 'requires-dependency-action');
      assert(preview.references.some(ref => ref.collection === 'questionObjectives'));
      assert.throws(
        () => knowledge.trainingAssetLifecycle.purge('learningObjective', objective.id, trashed.updatedAt),
        { code: 'TRAINING_ASSET_PURGE_BLOCKED' }
      );
      knowledge.trainingAssetLifecycle.trash('question', question.id);
      assert.throws(() => knowledge.trainingAssetLifecycle.restore('question', question.id), {
        code: 'TRAINING_ASSET_RESTORE_BLOCKED'
      });
      const restored = knowledge.trainingAssetLifecycle.restore('learningObjective', objective.id);
      assert.equal(restored.reviewStatus, 'candidate');
      assert.equal(restored.deletedAt, null);
      assert.equal(knowledge.trainingAssetLifecycle.restore('question', question.id).reviewStatus, 'draft');
    }
  },
  {
    name: '阶段3 考试配置删除不级联考点，必需引用阻断清理',
    run() {
      const knowledge = createKnowledgeModule();
      const objective = createObjective(knowledge, 'lc16');
      const profile = knowledge.examProfileService.create({ id: 'lc16-profile', name: '数学考试' });
      const focus = knowledge.examFocusService.create({
        id: 'lc16-focus',
        examProfileId: profile.id,
        learningObjectiveId: objective.id
      });
      const trashed = knowledge.trainingAssetLifecycle.trash('examProfile', profile.id);
      assert.equal(knowledge.examProfileService.list().length, 0);
      assert(knowledge.repositories.examFocusRepository.findById(focus.id));
      assert.equal(
        knowledge.trainingAssetLifecycle.inspect('examProfile', profile.id).decision,
        'requires-dependency-action'
      );
      assert.throws(() => knowledge.trainingAssetLifecycle.purge('examProfile', profile.id, trashed.updatedAt), {
        code: 'TRAINING_ASSET_PURGE_BLOCKED'
      });
      const deletedFocus = knowledge.trainingAssetLifecycle.trash('examFocus', focus.id);
      knowledge.trainingAssetLifecycle.purge('examFocus', focus.id, deletedFocus.updatedAt);
      assert.equal(
        knowledge.trainingAssetLifecycle.inspect('examProfile', profile.id).decision,
        'can-purge-no-history'
      );
      assert.equal(
        knowledge.trainingAssetLifecycle.purge('examProfile', profile.id, trashed.updatedAt).status,
        'subject-purged'
      );
    }
  },
  {
    name: '阶段3 原题回收与清理保护预检版本并仅清除专属关系',
    run() {
      const knowledge = createKnowledgeModule();
      const objective = createObjective(knowledge, 'lc13');
      const question = knowledge.questionService.createQuestion({
        id: 'lc13-question',
        stem: '草稿题',
        questionType: 'shortAnswer',
        learningObjectiveIds: [objective.id],
        sources: [{ sourceType: 'manual', quote: '人工编写' }]
      });
      const before = knowledge.trainingAssetLifecycle.inspect('question', question.id);
      assert.equal(before.decision, 'move-to-recycle-bin-first');
      const trashed = knowledge.trainingAssetLifecycle.trash('question', question.id);
      assert.equal(knowledge.questionService.listQuestions().length, 0);
      const preview = knowledge.trainingAssetLifecycle.inspect('question', question.id);
      assert.equal(preview.decision, 'can-purge-no-history');
      assert.equal(preview.exclusiveRecords.questionObjectives.length, 1);
      assert.throws(() => knowledge.trainingAssetLifecycle.purge('question', question.id, before.expectedUpdatedAt), {
        code: 'TRAINING_ASSET_UPDATE_CONFLICT'
      });
      const result = knowledge.trainingAssetLifecycle.purge('question', question.id, trashed.updatedAt);
      assert.equal(result.status, 'subject-purged');
      assert.deepEqual(knowledge.repositories.questionObjectiveRepository.listByQuestionIds([question.id]), []);
      assert.deepEqual(knowledge.repositories.questionSourceRepository.listByQuestionIds([question.id]), []);
      assert(knowledge.repositories.learningObjectiveRepository.findById(objective.id));
    }
  },
  {
    name: '阶段3 本地训练资产清理留下墓碑，旧备份和迟到创建不能复活原题',
    run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-stage3-tombstone-'));
      try {
        const store = createFileDataStore(path.join(root, 'data.json'));
        const app = createAppContext({
          dataStore: store,
          storageRootDir: root,
          uploadsDir: path.join(root, 'uploads')
        });
        const knowledge = app.modules.knowledge;
        const objective = createObjective(knowledge, 'lc14');
        const question = knowledge.questionService.createQuestion({
          id: 'lc14-question',
          stem: '待清理草稿',
          questionType: 'shortAnswer',
          learningObjectiveIds: [objective.id],
          sources: [{ sourceType: 'manual', quote: '人工编题' }]
        });
        const oldBackup = store.exportSnapshot();
        const trashed = knowledge.trainingAssetLifecycle.trash('question', question.id);
        knowledge.trainingAssetLifecycle.purge('question', question.id, trashed.updatedAt);
        assert.equal(
          knowledge.trainingAssetLifecycle.purge('question', question.id, trashed.updatedAt).status,
          'already-purged'
        );
        assert.throws(() => store.importSnapshot(oldBackup), { code: 'IMPORT_DELETED_ID' });
        assert.throws(
          () =>
            knowledge.questionService.createQuestion({
              id: question.id,
              stem: '旧设备重放',
              learningObjectiveIds: [objective.id]
            }),
          { code: 'QUESTION_ID_DELETED' }
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: '阶段3 HTTP 考试配置生命周期列表、预检与执行保持同一契约',
    async run() {
      const app = createAppContext();
      const server = createServer({ appContext: app, logger: { error() {} } });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const root = `http://127.0.0.1:${server.address().port}/api/knowledge/exam-profiles`;
      try {
        const created = await (
          await fetch(root, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'http-stage3-profile', name: '测试考试' })
          })
        ).json();
        assert.equal(created.data.id, 'http-stage3-profile');
        const trashed = await (await fetch(`${root}/http-stage3-profile/trash`, { method: 'POST' })).json();
        assert(trashed.data.deletedAt);
        const list = await (await fetch(`${root}?includeDeleted=true`)).json();
        assert(list.data.some(record => record.id === 'http-stage3-profile'));
        const preview = await (await fetch(`${root}/http-stage3-profile/purge-preview`)).json();
        assert.equal(preview.data.decision, 'can-purge-no-history');
        const result = await (
          await fetch(`${root}/http-stage3-profile/purge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expectedUpdatedAt: preview.data.expectedUpdatedAt })
          })
        ).json();
        assert.equal(result.data.status, 'subject-purged');
      } finally {
        await new Promise(resolve => server.close(resolve));
      }
    }
  }
];
