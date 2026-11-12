import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function createConfirmedObjective(knowledge, prefix) {
  const item = knowledge.knowledgeItemService.createCandidate({
    id: `${prefix}-item`,
    title: '正式知识单元',
    canonicalStatement: '这是可确认的知识内容',
    sourceMode: 'manual'
  }).item;
  knowledge.knowledgeItemService.confirmItem(item.id);
  const objective = knowledge.learningObjectiveService.createCandidate({
    id: `${prefix}-objective`,
    knowledgeItemId: item.id,
    objective: '能够解释正式知识内容',
    actionVerb: 'explain',
    cognitiveLevel: 'understand'
  });
  knowledge.learningObjectiveService.confirmObjective(objective.id);
  return { item, objective };
}

function asAsyncRepository(repository) {
  return new Proxy(
    { supportsAsync: true },
    {
      get(target, property) {
        if (Object.hasOwn(target, property)) return target[property];
        const value = repository[property];
        return typeof value === 'function' ? async (...args) => value.apply(repository, args) : value;
      }
    }
  );
}

export const phase3AssessmentTests = [
  {
    name: 'Phase3 LearningObjective confirmation requires a confirmed KnowledgeItem',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const item = knowledge.knowledgeItemService.createCandidate({
        id: 'phase3-item-objective',
        title: '函数复合',
        canonicalStatement: '复合函数由内外函数构成',
        sourceMode: 'manual'
      }).item;
      const objective = knowledge.learningObjectiveService.createCandidate({
        id: 'phase3-objective-confirm',
        knowledgeItemId: item.id,
        objective: '能够解释复合函数的内外层关系',
        actionVerb: 'explain',
        cognitiveLevel: 'understand'
      });

      assert.throws(
        () => knowledge.learningObjectiveService.confirmObjective(objective.id),
        error => error.code === 'KNOWLEDGE_ITEM_NOT_CONFIRMED'
      );
      knowledge.knowledgeItemService.confirmItem(item.id);
      assert.equal(knowledge.learningObjectiveService.confirmObjective(objective.id).reviewStatus, 'confirmed');
      assert.equal(
        knowledge.learningObjectiveService.updateObjective(objective.id, { objective: '能够比较复合函数的内外层关系' })
          .reviewStatus,
        'candidate'
      );
    }
  },
  {
    name: 'Phase3 Question binds objectives and passes structure/source review gates',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const item = knowledge.knowledgeItemService.createCandidate({
        id: 'phase3-item-question',
        title: '导数',
        canonicalStatement: '导数描述变化率',
        sourceMode: 'manual'
      }).item;
      knowledge.knowledgeItemService.confirmItem(item.id);
      const objective = knowledge.learningObjectiveService.createCandidate({
        id: 'phase3-objective-question',
        knowledgeItemId: item.id,
        objective: '能够解释导数的几何意义',
        actionVerb: 'explain',
        cognitiveLevel: 'understand'
      });
      knowledge.learningObjectiveService.confirmObjective(objective.id);
      const draft = knowledge.questionService.createQuestion({
        id: 'phase3-question-basic',
        questionType: 'shortAnswer',
        stem: '请解释导数的几何意义。',
        referenceAnswer: '切线斜率。',
        learningObjectiveIds: [objective.id],
        sources: [{ sourceType: 'learningObjective', sourceId: objective.id, quote: objective.objective }]
      });

      assert.deepEqual(draft.learningObjectiveIds, [objective.id]);
      assert.equal(draft.sources[0].sourceType, 'learningObjective');
      assert.throws(
        () => knowledge.questionService.confirmQuestion(draft.id),
        error => error.code === 'QUESTION_REVIEW_REQUIRED'
      );
      assert.equal(knowledge.questionService.validateQuestion(draft.id).reviewStatus, 'candidate');
      assert.equal(knowledge.questionService.confirmQuestion(draft.id).reviewStatus, 'confirmed');
      assert.equal(knowledge.questionService.updateQuestion(draft.id, { stem: '请说明导数的几何意义。' }).version, 2);
      knowledge.questionService.markSourceStale('learningObjective', objective.id);
      assert.throws(
        () => knowledge.questionService.confirmQuestion(draft.id),
        error => error.code === 'QUESTION_SOURCE_INVALID'
      );
    }
  },
  {
    name: 'Phase3 ExamProfile and ExamFocus keep optional exam context independent',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const item = knowledge.knowledgeItemService.createCandidate({
        id: 'phase3-item-focus',
        title: '概率',
        canonicalStatement: '概率描述随机事件的可能性',
        sourceMode: 'manual'
      }).item;
      knowledge.knowledgeItemService.confirmItem(item.id);
      const objective = knowledge.learningObjectiveService.createCandidate({
        id: 'phase3-objective-focus',
        knowledgeItemId: item.id,
        objective: '能够应用概率公式解决简单问题',
        actionVerb: 'apply',
        cognitiveLevel: 'apply'
      });
      knowledge.learningObjectiveService.confirmObjective(objective.id);
      const profile = knowledge.examProfileService.create({
        id: 'phase3-profile',
        name: '基础数学考试',
        scope: ['高中数学'],
        commonQuestionTypes: ['shortAnswer']
      });
      const focus = knowledge.examFocusService.create({
        id: 'phase3-focus',
        examProfileId: profile.id,
        learningObjectiveId: objective.id,
        priority: 1
      });

      assert.equal(focus.reviewStatus, 'candidate');
      assert.equal(knowledge.examFocusService.confirm(focus.id).reviewStatus, 'confirmed');
      assert.throws(
        () =>
          knowledge.examFocusService.create({
            id: 'phase3-focus-duplicate',
            examProfileId: profile.id,
            learningObjectiveId: objective.id
          }),
        error => error.code === 'EXAM_FOCUS_CONFLICT'
      );
      assert.equal(knowledge.examProfileService.archive(profile.id).archivedAt !== null, true);
      assert.equal(knowledge.examProfileService.list().length, 0);
    }
  },
  {
    name: 'Phase3 note version changes mark dependent QuestionSource stale without deleting the Question',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const note = knowledge.noteService.createNote({
        id: 'phase3-source-note',
        spaceId: 'phase3-source-space',
        title: '来源笔记',
        rawMarkdown: '第一版内容'
      });
      const version = knowledge.noteVersionService.listVersions({ noteId: note.id })[0];
      const item = knowledge.knowledgeItemService.createCandidate({
        id: 'phase3-source-item',
        title: '来源知识',
        canonicalStatement: '来源变化需要复核',
        sourceMode: 'manual'
      }).item;
      knowledge.knowledgeItemService.confirmItem(item.id);
      const objective = knowledge.learningObjectiveService.createCandidate({
        id: 'phase3-source-objective',
        knowledgeItemId: item.id,
        objective: '能够解释来源变化',
        actionVerb: 'explain',
        cognitiveLevel: 'understand'
      });
      knowledge.learningObjectiveService.confirmObjective(objective.id);
      const question = knowledge.questionService.createQuestion({
        id: 'phase3-source-question',
        stem: '来源变化意味着什么？',
        referenceAnswer: '需要复核。',
        learningObjectiveIds: [objective.id],
        sources: [{ sourceType: 'noteVersion', sourceId: version.id }]
      });

      knowledge.noteService.updateNote(note.id, { rawMarkdown: '第二版内容' });
      assert.equal(knowledge.questionService.getQuestion(question.id).sources[0].status, 'stale');
      assert.equal(knowledge.questionService.getQuestion(question.id).id, question.id);
    }
  },
  {
    name: 'Phase3 direct NoteVersion QuestionSource blocks permanent note deletion',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const note = knowledge.noteService.createNote({
        id: 'phase32-question-source-note',
        spaceId: 'space-demo',
        title: '题目来源删除保护',
        rawMarkdown: '不可删除的题目直接来源'
      });
      const version = knowledge.noteVersionService.listVersions({
        noteId: note.id
      })[0];
      const item = knowledge.knowledgeItemService.createCandidate({
        id: 'phase32-question-source-item',
        title: '题目来源保护',
        canonicalStatement: '直接题目来源必须保留历史版本',
        sourceMode: 'manual'
      }).item;
      knowledge.knowledgeItemService.confirmItem(item.id);
      const objective = knowledge.learningObjectiveService.createCandidate({
        id: 'phase32-question-source-objective',
        knowledgeItemId: item.id,
        objective: '能够解释题目来源保护',
        actionVerb: 'explain',
        cognitiveLevel: 'understand'
      });
      knowledge.learningObjectiveService.confirmObjective(objective.id);
      knowledge.questionService.createQuestion({
        id: 'phase32-question-source-question',
        questionType: 'shortAnswer',
        stem: '为什么不能删除直接题目来源？',
        referenceAnswer: '需要保留可审计历史。',
        learningObjectiveIds: [objective.id],
        sources: [
          {
            id: 'phase32-direct-version-source',
            sourceType: 'noteVersion',
            sourceId: version.id
          }
        ]
      });

      knowledge.noteService.deleteNote(note.id);
      assert.throws(
        () => knowledge.noteService.permanentlyDeleteNote(note.id),
        error => error.code === 'NOTE_HAS_QUESTION_SOURCE' && error.statusCode === 409
      );
      assert.equal(knowledge.noteVersionService.listVersions({ noteId: note.id }).length, 1);
    }
  },
  {
    name: 'Phase3 JSON migration preserves objective, focus, question and source relations',
    async run() {
      const { buildJsonMigrationPlan } = await import('../src/infrastructure/migration/json-to-postgres.ts');
      const result = buildJsonMigrationPlan({
        input: {
          spaces: [{ id: 'phase3-space', userId: 'demo', name: 'Phase3' }],
          folders: [],
          tags: [],
          notes: [{ id: 'phase3-note', spaceId: 'phase3-space', title: '阶段3', rawMarkdown: '导数' }],
          knowledgeItems: [
            {
              id: 'phase3-migration-item',
              title: '导数',
              canonicalStatement: '变化率',
              sourceMode: 'manual',
              reviewStatus: 'confirmed'
            }
          ],
          learningObjectives: [
            {
              id: 'phase3-migration-objective',
              knowledgeItemId: 'phase3-migration-item',
              objective: '能够解释变化率',
              actionVerb: 'explain',
              cognitiveLevel: 'understand',
              reviewStatus: 'confirmed'
            }
          ],
          examProfiles: [
            {
              id: 'phase3-migration-profile',
              name: '基础考试',
              scope: [],
              commonQuestionTypes: [],
              difficultyProfile: {}
            }
          ],
          examFocuses: [
            {
              id: 'phase3-migration-focus',
              examProfileId: 'phase3-migration-profile',
              learningObjectiveId: 'phase3-migration-objective'
            }
          ],
          questions: [
            {
              id: 'phase3-migration-question',
              questionType: 'shortAnswer',
              stem: '什么是变化率？',
              referenceAnswer: '单位变化量',
              reviewStatus: 'candidate'
            }
          ],
          questionObjectives: [
            {
              id: 'phase3-migration-link',
              questionId: 'phase3-migration-question',
              learningObjectiveId: 'phase3-migration-objective',
              isPrimary: true
            }
          ],
          questionSources: [
            {
              id: 'phase3-migration-source',
              questionId: 'phase3-migration-question',
              sourceType: 'learningObjective',
              sourceId: 'phase3-migration-objective',
              quote: '能够解释变化率'
            }
          ],
          attachments: [],
          contentAnnotations: []
        }
      });

      assert.equal(result.canApply, true);
      assert.equal(result.plan.learningObjectives[0].knowledgeItemId, 'phase3-migration-item');
      assert.equal(result.plan.examFocuses[0].learningObjectiveId, 'phase3-migration-objective');
      assert.equal(result.plan.questionObjectives[0].isPrimary, true);
      assert.equal(result.plan.questionSources[0].sourceId, 'phase3-migration-objective');
    }
  },
  {
    name: 'Phase3 local JSON repositories flush all assessment relations to schema v5',
    async run() {
      const { createAppContext } = await import('../src/app.factory.js');
      const { createFileDataStore } = await import('../src/infrastructure/file-data-store.js');
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-phase3-local-'));
      const filePath = path.join(tempRoot, 'data', 'knowledge-base.json');
      try {
        const dataStore = createFileDataStore(filePath);
        const app = createAppContext({ dataStore, storageRootDir: tempRoot });
        const item = app.modules.knowledge.knowledgeItemService.createCandidate({
          id: 'phase3-local-item',
          title: '局部极值',
          canonicalStatement: '导数为零可能出现局部极值',
          sourceMode: 'manual'
        }).item;
        app.modules.knowledge.knowledgeItemService.confirmItem(item.id);
        const objective = app.modules.knowledge.learningObjectiveService.createCandidate({
          id: 'phase3-local-objective',
          knowledgeItemId: item.id,
          objective: '能够解释局部极值的判定条件',
          actionVerb: 'explain',
          cognitiveLevel: 'understand'
        });
        app.modules.knowledge.learningObjectiveService.confirmObjective(objective.id);
        app.modules.knowledge.questionService.createQuestion({
          id: 'phase3-local-question',
          stem: '局部极值的判定条件是什么？',
          referenceAnswer: '一阶导数变号。',
          learningObjectiveIds: [objective.id],
          sources: [{ sourceType: 'learningObjective', sourceId: objective.id }]
        });
        const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        assert.equal(persisted.schemaVersion, 8);
        assert.equal(persisted.learningObjectives.length, 1);
        assert.equal(persisted.questions.length, 1);
        assert.equal(persisted.questionObjectives.length, 1);
        assert.equal(persisted.questionSources.length, 1);
        assert.equal(createFileDataStore(filePath).state.questions[0].id, 'phase3-local-question');
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'Phase3 create 拒绝重复 LearningObjective、Question 与考试资产 ID',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const { item, objective } = createConfirmedObjective(knowledge, 'phase32-duplicate');

      assert.throws(
        () =>
          knowledge.learningObjectiveService.createCandidate({
            id: objective.id,
            knowledgeItemId: item.id,
            objective: '能够覆盖原目标',
            actionVerb: 'explain',
            cognitiveLevel: 'understand'
          }),
        error => error.code === 'LEARNING_OBJECTIVE_ID_CONFLICT' && error.statusCode === 409
      );

      const questionInput = {
        id: 'phase32-duplicate-question',
        stem: '什么是正式知识内容？',
        referenceAnswer: '可被解释的内容。',
        learningObjectiveIds: [objective.id],
        sources: [
          {
            sourceType: 'learningObjective',
            sourceId: objective.id
          }
        ]
      };
      knowledge.questionService.createQuestion(questionInput);
      assert.throws(
        () =>
          knowledge.questionService.createQuestion({
            ...questionInput,
            stem: '覆盖题干'
          }),
        error => error.code === 'QUESTION_ID_CONFLICT' && error.statusCode === 409
      );
      assert.equal(knowledge.questionService.getQuestion(questionInput.id).stem, questionInput.stem);

      knowledge.examProfileService.create({
        id: 'phase32-duplicate-profile',
        name: '原考试'
      });
      assert.throws(
        () =>
          knowledge.examProfileService.create({
            id: 'phase32-duplicate-profile',
            name: '覆盖考试'
          }),
        error => error.code === 'EXAM_PROFILE_ID_CONFLICT' && error.statusCode === 409
      );
    }
  },
  {
    name: 'Phase3 LearningObjective 确认拒绝模糊动词和认知层级冲突',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const item = knowledge.knowledgeItemService.createCandidate({
        id: 'phase32-objective-gate-item',
        title: '目标门禁',
        canonicalStatement: '目标必须可观察',
        sourceMode: 'manual'
      }).item;
      knowledge.knowledgeItemService.confirmItem(item.id);

      const vague = knowledge.learningObjectiveService.createCandidate({
        id: 'phase32-objective-vague',
        knowledgeItemId: item.id,
        objective: '掌握流水线',
        actionVerb: 'identify',
        cognitiveLevel: 'remember'
      });
      assert.throws(
        () => knowledge.learningObjectiveService.confirmObjective(vague.id),
        error => error.code === 'LEARNING_OBJECTIVE_VAGUE_VERB'
      );

      const mismatch = knowledge.learningObjectiveService.createCandidate({
        id: 'phase32-objective-mismatch',
        knowledgeItemId: item.id,
        objective: '能够应用流水线规则解决问题',
        actionVerb: 'apply',
        cognitiveLevel: 'remember'
      });
      assert.throws(
        () => knowledge.learningObjectiveService.confirmObjective(mismatch.id),
        error => error.code === 'LEARNING_OBJECTIVE_COGNITIVE_LEVEL_MISMATCH'
      );
    }
  },
  {
    name: 'Phase3 QuestionSource 状态由真实引用推导且全部目标必须 confirmed',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const { item, objective } = createConfirmedObjective(knowledge, 'phase32-source-health');
      const candidateObjective = knowledge.learningObjectiveService.createCandidate({
        id: 'phase32-source-health-candidate',
        knowledgeItemId: item.id,
        objective: '能够识别候选目标',
        actionVerb: 'identify',
        cognitiveLevel: 'remember'
      });
      const question = knowledge.questionService.createQuestion({
        id: 'phase32-source-health-question',
        stem: '请解释正式知识内容。',
        referenceAnswer: '正式知识内容。',
        learningObjectiveIds: [objective.id, candidateObjective.id],
        sources: [
          {
            sourceType: 'manual',
            status: 'reanchored'
          }
        ]
      });

      assert.equal(question.sources[0].status, 'stale');
      assert.throws(
        () => knowledge.questionService.validateQuestion(question.id),
        error => error.code === 'LEARNING_OBJECTIVE_NOT_CONFIRMED'
      );

      knowledge.questionService.updateQuestion(question.id, {
        learningObjectiveIds: [objective.id]
      });
      assert.throws(
        () => knowledge.questionService.validateQuestion(question.id),
        error => error.code === 'QUESTION_SOURCE_INVALID'
      );
    }
  },
  {
    name: 'Phase3 choice Question 确认门禁拒绝重复 optionId',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const { objective } = createConfirmedObjective(knowledge, 'phase32-choice-option');
      const question = knowledge.questionService.createQuestion({
        id: 'phase32-choice-option-question',
        questionType: 'singleChoice',
        stem: '请选择正确答案。',
        options: [
          { id: 'same-option', text: '答案 A' },
          { id: 'same-option', text: '答案 B' }
        ],
        referenceAnswer: 'same-option',
        learningObjectiveIds: [objective.id],
        sources: [
          {
            sourceType: 'learningObjective',
            sourceId: objective.id
          }
        ]
      });

      assert.throws(
        () => knowledge.questionService.validateQuestion(question.id),
        error => error.code === 'QUESTION_INVALID_STRUCTURE' && error.message.includes('QUESTION_OPTION_IDS_DUPLICATE')
      );
    }
  },
  {
    name: 'Phase3 上游正式资产失效会把 confirmed Question 退回 candidate',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const { item, objective } = createConfirmedObjective(knowledge, 'phase32-dependency');
      const question = knowledge.questionService.createQuestion({
        id: 'phase32-dependency-question',
        stem: '请解释正式知识内容。',
        referenceAnswer: '正式知识内容。',
        learningObjectiveIds: [objective.id],
        sources: [
          {
            sourceType: 'learningObjective',
            sourceId: objective.id
          }
        ]
      });
      knowledge.questionService.validateQuestion(question.id);
      knowledge.questionService.confirmQuestion(question.id);

      knowledge.knowledgeItemService.updateItem(item.id, {
        canonicalStatement: '上游知识内容已修改'
      });

      assert.equal(knowledge.learningObjectiveService.getObjective(objective.id).reviewStatus, 'candidate');
      const changedQuestion = knowledge.questionService.getQuestion(question.id);
      assert.equal(changedQuestion.reviewStatus, 'candidate');
      assert.equal(changedQuestion.sources[0].status, 'stale');
    }
  },
  {
    name: 'Phase3 local snapshot/import 复用正式资产确认门禁并重算来源健康',
    async run() {
      const { LOCAL_DATA_SCHEMA_VERSION, LOCAL_SNAPSHOT_VERSION, createEmptyLocalState, validateLocalSnapshot } =
        await import('../src/infrastructure/local-data-schema.js');
      const state = createEmptyLocalState();
      state.knowledgeItems.push({
        id: 'phase32-snapshot-item',
        title: '快照知识',
        canonicalStatement: '快照正式内容',
        sourceMode: 'manual',
        reviewStatus: 'confirmed'
      });
      state.learningObjectives.push({
        id: 'phase32-snapshot-objective',
        knowledgeItemId: 'phase32-snapshot-item',
        objective: '能够解释快照正式内容',
        actionVerb: 'explain',
        cognitiveLevel: 'understand',
        reviewStatus: 'confirmed',
        order: 0
      });
      state.questions.push({
        id: 'phase32-snapshot-question',
        questionType: 'shortAnswer',
        stem: '请解释快照正式内容。',
        referenceAnswer: '快照正式内容。',
        sourceMode: 'manual',
        reviewStatus: 'confirmed',
        version: 1
      });
      state.questionObjectives.push({
        id: 'phase32-snapshot-link',
        questionId: 'phase32-snapshot-question',
        learningObjectiveId: 'phase32-snapshot-objective',
        order: 0
      });
      state.questionSources.push({
        id: 'phase32-snapshot-source',
        questionId: 'phase32-snapshot-question',
        sourceType: 'learningObjective',
        sourceId: 'phase32-snapshot-objective',
        status: 'active'
      });
      const snapshot = {
        version: LOCAL_SNAPSHOT_VERSION,
        schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
        data: state
      };

      assert.equal(validateLocalSnapshot(snapshot).data.questions[0].reviewStatus, 'confirmed');

      const invalidItem = structuredClone(snapshot);
      invalidItem.data.knowledgeItems[0].canonicalStatement = '';
      assert.throws(
        () => validateLocalSnapshot(invalidItem),
        error => error.code === 'STORAGE_SNAPSHOT_INVALID' && error.message.includes('KNOWLEDGE_ITEM_CONTENT_REQUIRED')
      );

      const invalidObjective = structuredClone(snapshot);
      invalidObjective.data.learningObjectives[0].objective = '掌握快照内容';
      assert.throws(
        () => validateLocalSnapshot(invalidObjective),
        error => error.code === 'STORAGE_SNAPSHOT_INVALID' && error.message.includes('LEARNING_OBJECTIVE_VAGUE_VERB')
      );

      const forgedSource = structuredClone(snapshot);
      forgedSource.data.knowledgeItems.push({
        id: 'phase32-snapshot-candidate-source',
        title: '候选来源',
        canonicalStatement: '尚未确认',
        sourceMode: 'manual',
        reviewStatus: 'candidate'
      });
      forgedSource.data.questionSources[0].sourceType = 'knowledgeItem';
      forgedSource.data.questionSources[0].sourceId = 'phase32-snapshot-candidate-source';
      forgedSource.data.questionSources[0].status = 'reanchored';
      assert.throws(
        () => validateLocalSnapshot(forgedSource),
        error => error.code === 'STORAGE_SNAPSHOT_INVALID' && error.message.includes('QUESTION_SOURCE_INVALID')
      );

      const invalidQuestion = structuredClone(snapshot);
      invalidQuestion.data.questions[0].stem = '';
      assert.throws(
        () => validateLocalSnapshot(invalidQuestion),
        error => error.code === 'STORAGE_SNAPSHOT_INVALID' && error.message.includes('QUESTION_INVALID_STRUCTURE')
      );
    }
  },
  {
    name: 'Phase3 PostgreSQL async Question service 保持来源推导、重复 ID 与依赖降级语义',
    async run() {
      const { createAsyncQuestionService } =
        await import('../src/modules/knowledge/application/postgres-async/question-service.ts');
      const {
        createInMemoryLearningObjectiveRepository,
        createInMemoryQuestionObjectiveRepository,
        createInMemoryQuestionRepository,
        createInMemoryQuestionSourceRepository
      } = await import('../src/modules/knowledge/infrastructure/assessment-repository.ts');
      const objective = {
        id: 'phase32-async-objective',
        knowledgeItemId: 'phase32-async-item',
        objective: '能够解释异步门禁',
        actionVerb: 'explain',
        cognitiveLevel: 'understand',
        reviewStatus: 'confirmed',
        order: 0
      };
      const questionRepository = asAsyncRepository(createInMemoryQuestionRepository());
      const questionObjectiveRepository = asAsyncRepository(createInMemoryQuestionObjectiveRepository());
      const questionSourceRepository = asAsyncRepository(createInMemoryQuestionSourceRepository());
      const service = createAsyncQuestionService({
        repository: questionRepository,
        questionObjectiveRepository,
        questionSourceRepository,
        learningObjectiveRepository: asAsyncRepository(
          createInMemoryLearningObjectiveRepository({
            records: [objective]
          })
        ),
        knowledgeItemRepository: {
          async findById() {
            return { id: 'phase32-async-item', reviewStatus: 'confirmed' };
          }
        },
        noteVersionRepository: {
          async findById() {
            return null;
          }
        },
        knowledgeEvidenceRepository: {
          async findById() {
            return null;
          }
        }
      });
      const input = {
        id: 'phase32-async-question',
        stem: '什么是异步门禁？',
        referenceAnswer: '异步路径也必须执行相同门禁。',
        learningObjectiveIds: [objective.id],
        sources: [
          {
            sourceType: 'learningObjective',
            sourceId: objective.id,
            status: 'stale'
          }
        ]
      };
      const created = await service.createQuestion(input);
      assert.equal(created.sources[0].status, 'active');
      await service.validateQuestion(created.id);
      await service.confirmQuestion(created.id);

      await assert.rejects(
        () =>
          service.createQuestion({
            ...input,
            stem: '不应覆盖原题'
          }),
        error => error.code === 'QUESTION_ID_CONFLICT' && error.statusCode === 409
      );
      await service.invalidateByObjectiveId(objective.id);
      assert.equal((await service.getQuestion(created.id)).reviewStatus, 'candidate');
      assert.equal((await service.getQuestion(created.id)).sources[0].status, 'stale');
    }
  },
  {
    name: 'Phase3 PostgreSQL create repository 将并发重复 ID 映射为 409',
    async run() {
      const { createPostgresQuestionRepository } =
        await import('../src/modules/knowledge/infrastructure/postgres/question-repository.ts');
      const repository = createPostgresQuestionRepository({
        db: {
          question: {
            async create() {
              const error = new Error('duplicate');
              error.code = 'P2002';
              throw error;
            }
          }
        }
      });

      await assert.rejects(
        () =>
          repository.create({
            id: 'phase32-postgres-duplicate',
            questionType: 'shortAnswer',
            stem: '',
            options: null,
            referenceAnswer: null,
            rubric: null,
            explanation: '',
            difficulty: null,
            reviewStatus: 'draft',
            sourceMode: 'manual',
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }),
        error => error.code === 'DATABASE_CONFLICT' && error.statusCode === 409
      );
    }
  }
];
