import type {
  SyncCollection,
  SyncStoredState,
  SyncStoredEntity,
  SyncWorkingRecord,
  SyncEntity,
  SyncEntityMap,
  SyncChange,
  SyncWorkingState,
  SyncWorkingEntity,
  SyncWorkingMutation
} from './domain-types.ts';
import { LearningObjective } from '../knowledge/domain/learning-objective.ts';
import { ExamProfile } from '../knowledge/domain/exam-profile.ts';
import { ExamFocus } from '../knowledge/domain/exam-focus.ts';
import { Question } from '../knowledge/domain/question.ts';
import { QuestionSource } from '../knowledge/domain/question-source.ts';
import {
  assertLearningObjectiveConfirmable,
  assertQuestionConfirmable
} from '../knowledge/application/formal-asset-validation.js';
import { buildCreateExamProfileDto, buildUpdateExamFocusDto } from '../knowledge/application/dto/assessment.dto.ts';
import { TRAINING_COLLECTIONS, sameEntity } from './entity-contract.ts';
import { syncError } from './journal.ts';

const subjects = new Set(['learningObjectives', 'examProfiles', 'examFocuses', 'questions']);
type ConstructedCollection = 'learningObjectives' | 'examProfiles' | 'examFocuses' | 'questions' | 'questionSources';
type TrainingConstructorInput =
  | ConstructorParameters<typeof LearningObjective>[0]
  | ConstructorParameters<typeof ExamProfile>[0]
  | ConstructorParameters<typeof ExamFocus>[0]
  | ConstructorParameters<typeof Question>[0]
  | ConstructorParameters<typeof QuestionSource>[0];
const constructors: {
  [Collection in ConstructedCollection]: new (input: SyncEntity<Collection>) => SyncEntityMap[Collection];
} = {
  learningObjectives: LearningObjective,
  examProfiles: ExamProfile,
  examFocuses: ExamFocus,
  questions: Question,
  questionSources: QuestionSource
};
const find = <Collection extends SyncCollection>(
  state: SyncWorkingState,
  collection: Collection,
  id: string | null | undefined
): SyncWorkingRecord<Collection> | undefined => state[collection].find(item => item.id === id);
const fail = (code: string, message: string): never => {
  throw syncError(code, message, 422);
};

export function normalizeTrainingChange<Collection extends SyncCollection>(
  change: SyncWorkingMutation<Collection>,
  previous: SyncStoredEntity<Collection> | undefined,
  changes: SyncChange[]
): SyncWorkingEntity<Collection> | null;
export function normalizeTrainingChange(
  change: SyncWorkingMutation,
  previous: SyncStoredEntity | undefined,
  changes: SyncChange[]
): SyncWorkingEntity | null {
  const { collection, value, lifecycleAction } = change;
  if (!TRAINING_COLLECTIONS.includes(collection)) return value;
  if (subjects.has(collection) && !value)
    fail('SYNC_TRAINING_DELETE_UNSUPPORTED', '训练资产永久清理必须通过联网权威入口执行。');
  if (subjects.has(collection) && previous && value) {
    const action =
      !previous.deletedAt && value.deletedAt ? 'trash' : previous.deletedAt && !value.deletedAt ? 'restore' : null;
    if (action !== (lifecycleAction ?? null))
      fail('SYNC_LIFECYCLE_ACTION_REQUIRED', '训练回收站操作需要显式动作和版本基线。');
  }
  const parentFields =
    (
      {
        learningObjectives: ['knowledgeItemId'],
        examFocuses: ['examProfileId', 'learningObjectiveId'],
        questionObjectives: ['questionId', 'learningObjectiveId'],
        questionSources: ['questionId']
      } as Partial<
        Record<SyncCollection, ('knowledgeItemId' | 'examProfileId' | 'learningObjectiveId' | 'questionId')[]>
      >
    )[collection] ?? [];
  if (value && previous && parentFields.some(field => value[field] !== previous[field]))
    fail('SYNC_IDENTITY_CHANGED', '不能更改训练实体所属对象，请解除旧关系并创建新关系。');
  if (['questionObjectives', 'questionSources'].includes(collection)) {
    const questionId = value?.questionId ?? previous?.questionId;
    if (!changes.some(entry => entry.collection === 'questions' && entry.id === questionId && entry.value))
      fail('SYNC_TRAINING_QUESTION_REQUIRED', '题目关联和来源修改必须与所属题目一起提交。');
  }
  if (!value) return value;
  if (
    collection === 'examFocuses' &&
    value.sourceType !== 'manual' &&
    (!previous || previous.sourceType !== value.sourceType)
  )
    fail('EXAM_FOCUS_SOURCE_TYPE_UNSUPPORTED', '当前只支持人工考点来源。');
  if (
    collection === 'questions' &&
    value.sourceMode !== 'manual' &&
    (!previous || previous.sourceMode !== value.sourceMode)
  )
    fail('QUESTION_SOURCE_MODE_UNSUPPORTED', '当前只支持人工创建试题。');
  if (collection === 'questions' && previous) {
    if (value.version! < previous.version!) fail('QUESTION_VERSION_CONFLICT', '试题版本不能倒退。');
    const content = (question: SyncWorkingRecord) =>
      Object.fromEntries(
        Object.entries(question).filter(
          ([field]) => !['reviewStatus', 'deletedAt', 'createdAt', 'updatedAt', 'version'].includes(field)
        )
      );
    if (!sameEntity(collection, content(value), content(previous)) && value.version! <= previous.version!)
      fail('QUESTION_VERSION_CONFLICT', '试题正文修改需要递增版本。');
  }
  if (
    collection === 'questionSources' &&
    !['manual', 'knowledgeItem', 'learningObjective', 'noteVersion', 'knowledgeEvidence'].includes(value.sourceType!)
  )
    fail('QUESTION_SOURCE_TYPE_UNSUPPORTED', '当前试题来源类型不支持写入。');
  if (collection === 'questionObjectives') {
    if (
      !value.id?.trim() ||
      !value.questionId?.trim() ||
      !value.learningObjectiveId?.trim() ||
      !Number.isInteger(value.order) ||
      value.order! < 0 ||
      typeof value.isPrimary !== 'boolean'
    )
      fail('SYNC_ENTITY_INVALID', '试题目标关系字段无效。');
    return {
      id: value.id,
      questionId: value.questionId!,
      learningObjectiveId: value.learningObjectiveId!,
      order: value.order!,
      isPrimary: value.isPrimary!,
      createdAt: value.createdAt!
    };
  }
  const fields =
    collection === 'examProfiles'
      ? buildCreateExamProfileDto(value)
      : collection === 'examFocuses'
        ? buildUpdateExamFocusDto(value)
        : {};
  return {
    ...new (
      constructors[collection as ConstructedCollection] as new (
        input: TrainingConstructorInput
      ) => SyncEntityMap[ConstructedCollection]
    )({ ...(value as SyncEntity<ConstructedCollection>), ...fields })
  };
}

/** 未在本机出现的已确认下游也必须随内容变化失效；显式提交的最终确认可包含离线重新核对。 */
export function reconcileTrainingChanges(
  before: SyncStoredState,
  state: SyncWorkingState,
  changes: SyncChange[]
): SyncWorkingState {
  const submitted = (collection: SyncCollection, id: string) =>
    changes.some(entry => entry.collection === collection && entry.id === id && entry.value);
  const changedKnowledge = new Set(
    changes
      .filter(
        entry =>
          entry.collection === 'knowledgeItems' &&
          entry.value &&
          !sameEntity('knowledgeItems', find(before, 'knowledgeItems', entry.id), entry.value)
      )
      .map(entry => entry.id)
  );
  const affected = new Set<string>();
  const downgrade = (value: SyncWorkingRecord<'learningObjectives' | 'questions'>) => {
    if (value.reviewStatus === 'confirmed') {
      value.reviewStatus = 'candidate';
      value.updatedAt = new Date(Math.max(Date.now(), Date.parse(value.updatedAt) + 1 || 0)).toISOString();
    }
  };
  for (const objective of state.learningObjectives) {
    if (changedKnowledge.has(objective.knowledgeItemId)) {
      affected.add(objective.id);
      if (!submitted('learningObjectives', objective.id)) downgrade(objective);
    }
    const previous = find(before, 'learningObjectives', objective.id);
    if (previous && !sameEntity('learningObjectives', previous, objective)) affected.add(objective.id);
  }
  for (const question of state.questions)
    if (
      !submitted('questions', question.id) &&
      state.questionObjectives.some(link => link.questionId === question.id && affected.has(link.learningObjectiveId))
    )
      downgrade(question);
  // 考点父对象失效沿用 Web 行为：禁止新绑定/确认，不自动改写既有考点状态。
  return state;
}

export function validateTrainingBatch(before: SyncStoredState, state: SyncWorkingState, changes: SyncChange[]): void {
  for (const change of changes.filter(entry => TRAINING_COLLECTIONS.includes(entry.collection) && entry.value)) {
    const value = find(state, change.collection, change.id)!;
    const previous = find(before, change.collection, change.id);
    if (
      change.collection === 'questions' &&
      previous &&
      changes.some(
        entry =>
          ['questionObjectives', 'questionSources'].includes(entry.collection) &&
          (entry.value?.questionId ?? find(before, entry.collection, entry.id)?.questionId) === value.id
      ) &&
      value.version! <= previous.version!
    )
      fail('QUESTION_VERSION_CONFLICT', '试题关联修改需要递增版本。');
    if (change.collection === 'learningObjectives') {
      const parent = find(state, 'knowledgeItems', value.knowledgeItemId);
      if (
        (!previous || (previous.deletedAt && !value.deletedAt)) &&
        (!parent || parent.deletedAt || (!previous && parent.reviewStatus === 'archived'))
      )
        fail('KNOWLEDGE_ITEM_NOT_ACTIVE', '学习目标创建和恢复需要可用所属知识。');
      if (change.value!.reviewStatus === 'confirmed' && !value.deletedAt)
        assertLearningObjectiveConfirmable(value, parent);
    }
    if (change.collection === 'examFocuses') {
      const profile = find(state, 'examProfiles', value.examProfileId);
      const objective = find(state, 'learningObjectives', value.learningObjectiveId);
      const confirming =
        change.value!.reviewStatus === 'confirmed' && (!previous || previous.reviewStatus !== 'confirmed');
      if (!previous || (!value.deletedAt && previous.deletedAt) || confirming) {
        if (!profile || profile.deletedAt || ((!previous || confirming) && profile.archivedAt))
          fail('EXAM_PROFILE_NOT_ACTIVE', '考点需要可用考试配置。');
        if (!objective || objective.deletedAt || ((!previous || confirming) && objective!.reviewStatus === 'archived'))
          fail('LEARNING_OBJECTIVE_NOT_ACTIVE', '考点需要可用学习目标。');
        if (change.value!.reviewStatus === 'confirmed' && objective!.reviewStatus !== 'confirmed')
          fail('LEARNING_OBJECTIVE_NOT_CONFIRMED', '考点确认需要已确认学习目标。');
      }
    }
    if (change.collection === 'questionObjectives' && !previous) {
      const objective = find(state, 'learningObjectives', value.learningObjectiveId);
      if (!objective || objective.deletedAt || objective.reviewStatus === 'archived')
        fail('LEARNING_OBJECTIVE_NOT_ACTIVE', '不能绑定已删除或归档学习目标。');
    }
    if (
      change.collection === 'questionSources' &&
      (!previous || previous.sourceId !== value.sourceId || previous.sourceType !== value.sourceType)
    ) {
      const collection = (
        {
          knowledgeItem: 'knowledgeItems',
          learningObjective: 'learningObjectives',
          noteVersion: 'noteVersions',
          knowledgeEvidence: 'knowledgeEvidence'
        } as Partial<Record<string, SyncCollection>>
      )[value.sourceType!];
      if (collection) {
        const source = find(state, collection, value.sourceId);
        if (
          !source ||
          source.deletedAt ||
          (collection === 'noteVersions' && find(state, 'notes', source.noteId)?.deleted)
        )
          fail('QUESTION_SOURCE_NOT_ACTIVE', '不能绑定已删除的试题来源。');
      }
    }
    if (
      change.collection === 'questions' &&
      previous?.deletedAt &&
      !value.deletedAt &&
      state.questionObjectives.some(
        link => link.questionId === value.id && find(state, 'learningObjectives', link.learningObjectiveId)?.deletedAt
      )
    )
      fail('TRAINING_ASSET_RESTORE_BLOCKED', '请先恢复题目关联的学习目标。');
    if (change.collection === 'questions' && change.value!.reviewStatus === 'confirmed' && !value.deletedAt)
      assertQuestionConfirmable(value, {
        objectives: state.questionObjectives
          .filter(link => link.questionId === value.id)
          .map(link => find(state, 'learningObjectives', link.learningObjectiveId)),
        sources: state.questionSources.filter(source => source.questionId === value.id)
      });
  }
}
