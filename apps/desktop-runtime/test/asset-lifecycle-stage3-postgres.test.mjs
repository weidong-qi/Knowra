import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createPostgresAppContext } from '../../api/src/postgres-app.factory.ts';
import { temporaryDirectory } from './helpers.mjs';

import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';

const enabled = Boolean(process.env.KNOWRA_SYNC_TEST_DATABASE_URL);

test('阶段3 真实 PostgreSQL：训练资产回收、引用阻断、清理与墓碑', { skip: !enabled, timeout: 60000 }, async t => {
  const database = await createPostgresTestDatabase();
  t.after(() => database.close());
  const { databaseUrl } = database;
  const url = new URL(databaseUrl);
  assert(['127.0.0.1', 'localhost'].includes(url.hostname), '只能使用回环测试数据库');
  assert.equal(process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES, '1', '需要显式允许临时库测试写入');
  const root = temporaryDirectory(t);
  const app = await createPostgresAppContext({
    databaseUrl,
    storageRootDir: root,
    uploadsDir: path.join(root, 'uploads')
  });
  t.after(() => app.close());
  const knowledge = app.modules.knowledge;
  await knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const token = randomUUID();
  const created = await knowledge.knowledgeItemService.createCandidate({
    id: `stage3-item-${token}`,
    title: '导数',
    canonicalStatement: '导数表示变化率',
    sourceMode: 'manual'
  });
  await knowledge.knowledgeItemService.confirmItem(created.item.id);
  const objective = await knowledge.learningObjectiveService.createCandidate({
    id: `stage3-objective-${token}`,
    knowledgeItemId: created.item.id,
    objective: '能够解释导数的含义',
    actionVerb: 'explain',
    cognitiveLevel: 'understand'
  });
  await knowledge.learningObjectiveService.confirmObjective(objective.id);
  const profile = await knowledge.examProfileService.create({ id: `stage3-profile-${token}`, name: '数学考试' });
  const focus = await knowledge.examFocusService.create({
    id: `stage3-focus-${token}`,
    examProfileId: profile.id,
    learningObjectiveId: objective.id
  });
  const question = await knowledge.questionService.createQuestion({
    id: `stage3-question-${token}`,
    questionType: 'shortAnswer',
    stem: '解释导数',
    learningObjectiveIds: [objective.id],
    sources: [{ sourceType: 'manual', quote: '人工编题' }]
  });

  const deletedProfile = await knowledge.trainingAssetLifecycle.trash('examProfile', profile.id);
  assert.equal((await knowledge.examProfileService.list()).length, 0);
  assert.equal(
    (await knowledge.trainingAssetLifecycle.inspect('examProfile', profile.id)).decision,
    'requires-dependency-action'
  );
  await assert.rejects(
    () => knowledge.trainingAssetLifecycle.purge('examProfile', profile.id, deletedProfile.updatedAt),
    { code: 'TRAINING_ASSET_PURGE_BLOCKED' }
  );
  const deletedFocus = await knowledge.trainingAssetLifecycle.trash('examFocus', focus.id);
  await knowledge.trainingAssetLifecycle.purge('examFocus', focus.id, deletedFocus.updatedAt);
  await knowledge.trainingAssetLifecycle.purge('examProfile', profile.id, deletedProfile.updatedAt);

  const deletedObjective = await knowledge.trainingAssetLifecycle.trash('learningObjective', objective.id);
  assert.equal(
    (await knowledge.trainingAssetLifecycle.inspect('learningObjective', objective.id)).decision,
    'requires-dependency-action'
  );
  assert.equal((await knowledge.questionService.getQuestion(question.id)).reviewStatus, 'draft');
  const deletedQuestion = await knowledge.trainingAssetLifecycle.trash('question', question.id);
  await assert.rejects(() => knowledge.trainingAssetLifecycle.restore('question', question.id), {
    code: 'TRAINING_ASSET_RESTORE_BLOCKED'
  });
  const preview = await knowledge.trainingAssetLifecycle.inspect('question', question.id);
  assert.equal(preview.decision, 'can-purge-no-history');
  await knowledge.trainingAssetLifecycle.purge('question', question.id, deletedQuestion.updatedAt);
  assert.equal(
    (await knowledge.trainingAssetLifecycle.purge('question', question.id, deletedQuestion.updatedAt)).status,
    'already-purged'
  );
  await knowledge.trainingAssetLifecycle.purge('learningObjective', objective.id, deletedObjective.updatedAt);
  await assert.rejects(() => knowledge.questionService.createQuestion({ id: question.id, stem: '迟到的旧题' }), {
    code: 'QUESTION_ID_DELETED'
  });
  const journal = await app.prisma.syncJournal.findUnique({ where: { ownerId: 'demo' } });
  assert(journal.payload.tombstones[JSON.stringify(['questions', question.id])]);
  assert(journal.payload.tombstones[JSON.stringify(['learningObjectives', objective.id])]);
});
