import type {
  TrainingAssetKind,
  TrainingRepositories,
  TrainingAssetDependencies,
  LocalTrainingAssetDependencies,
  TrainingPurgeInput,
  TrainingReference,
  TrainingPreflight
} from './training-asset-lifecycle-types.ts';
import {
  taskCoverage,
  asyncTaskCoverage,
  supplementPurgePreview,
  assertPurgeDatasetEpoch,
  assertManualPurgeScope
} from './asset-purge-guard.ts';
import type { AppErrorOptions } from '../../../errors/app-error.ts';
import { createAppError } from '../../../errors/app-error.ts';

const TYPES = Object.freeze({
  learningObjective: { collection: 'learningObjectives', repository: 'learningObjectiveRepository' as const },
  examProfile: { collection: 'examProfiles', repository: 'examProfileRepository' as const },
  examFocus: { collection: 'examFocuses', repository: 'examFocusRepository' as const },
  question: { collection: 'questions', repository: 'questionRepository' as const }
});

function includesExactId(value: unknown, id: string, seen = new Set<object>()): boolean {
  if (value === id) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some(child => includesExactId(child, id, seen));
}

function fail(code: string, message: string, details?: AppErrorOptions): never {
  throw createAppError(code, message, 409, details);
}

function nextTimestamp(previous: unknown) {
  return new Date(Math.max(Date.now(), Date.parse((previous ?? 0) as string) + 1)).toISOString();
}

export function createTrainingAssetLifecycle({
  repositories,
  runTransaction = operation => operation(repositories),
  getTombstone = null,
  readPurgeTaskState = null,
  getPurgeDatasetEpoch = null
}: TrainingAssetDependencies) {
  async function inspect(
    type: TrainingAssetKind,
    id: string,
    source: TrainingRepositories<true> | null = null
  ): Promise<ReturnType<typeof supplementPurgePreview<TrainingPreflight>>> {
    if (!source) return runTransaction(transaction => inspect(type, id, transaction));
    const config = TYPES[type];
    if (!config) throw new TypeError(`Unknown training asset: ${type}`);
    const asset = await source[config.repository].findById(id);
    if (!asset) throw createAppError('TRAINING_ASSET_NOT_FOUND', '训练资产不存在。', 404);
    const references: TrainingReference[] = [];
    if (type === 'learningObjective') {
      const [focuses, links, sources] = await Promise.all([
        source.examFocusRepository.list({ learningObjectiveId: id, includeArchived: true, includeDeleted: true }),
        source.questionObjectiveRepository.listByObjectiveId(id),
        source.questionSourceRepository.list()
      ]);
      references.push(
        ...focuses.map(record => ({
          collection: 'examFocuses',
          id: record.id,
          action: 'rebind-or-purge-focus',
          relatedAsset: { kind: 'examFocus', id: record.id }
        }))
      );
      references.push(
        ...links.map(record => ({
          collection: 'questionObjectives',
          id: record.id,
          action: 'rebind-question-objective',
          relatedAsset: { kind: 'question', id: record.questionId }
        }))
      );
      references.push(
        ...sources
          .filter(record => record.sourceType === 'learningObjective' && record.sourceId === id)
          .map(record => ({
            collection: 'questionSources',
            id: record.id,
            action: 'replace-question-source',
            relatedAsset: { kind: 'question', id: record.questionId }
          }))
      );
    }
    if (type === 'examProfile') {
      const focuses = await source.examFocusRepository.list({
        examProfileId: id,
        includeArchived: true,
        includeDeleted: true
      });
      references.push(
        ...focuses.map(record => ({
          collection: 'examFocuses',
          id: record.id,
          action: 'rebind-or-purge-focus',
          relatedAsset: { kind: 'examFocus', id: record.id }
        }))
      );
    }
    const scopes = (await source.analysisScopeRepository?.list?.({ includeDeleted: true })) ?? [];
    references.push(
      ...scopes
        .filter(record => includesExactId(record, id))
        .map(record => ({ collection: 'analysisScopeSnapshots', id: record.id, action: 'retain-or-resolve-history' }))
    );
    const epoch = await getPurgeDatasetEpoch?.();
    const coverage = await asyncTaskCoverage(readPurgeTaskState);
    return supplementPurgePreview<TrainingPreflight>(
      {
        asset: { type, id },
        operation: 'permanent-delete',
        expectedUpdatedAt: asset.updatedAt,
        decision: !asset.deletedAt
          ? 'move-to-recycle-bin-first'
          : references.length
            ? 'requires-dependency-action'
            : 'can-purge-no-history',
        references,
        exclusiveRecords:
          type === 'question'
            ? {
                questionObjectives: (await source.questionObjectiveRepository.listByQuestionIds([id])).map(
                  record => record.id
                ),
                questionSources: (await source.questionSourceRepository.listByQuestionIds([id])).map(
                  record => record.id
                )
              }
            : {},
        coverage: {
          persistedCurrentAndHistory: true,
          runningTasks: 'unverified',
          offlineDevices: 'pending-sync',
          backups: 'retention-managed'
        }
      },
      coverage,
      epoch
    );
  }

  async function trash(type: TrainingAssetKind, id: string) {
    const config = TYPES[type];
    if (!config) throw new TypeError(`Unknown training asset: ${type}`);
    return runTransaction(async source => {
      const repository = source[config.repository];
      const current = await repository.findById(id);
      if (!current) throw createAppError('TRAINING_ASSET_NOT_FOUND', '训练资产不存在。', 404);
      if (current.deletedAt) return current;
      const timestamp = nextTimestamp(current.updatedAt);
      const next = await repository.save({ ...current, deletedAt: timestamp, updatedAt: timestamp });
      if (type === 'learningObjective') {
        const links = await source.questionObjectiveRepository.listByObjectiveId(id);
        const changedSources = await source.questionSourceRepository.markBySourceIds(
          'learningObjective',
          [id],
          'stale'
        );
        for (const questionId of new Set([
          ...links.map(link => link.questionId),
          ...changedSources.map(item => item.questionId)
        ])) {
          const question = await source.questionRepository.findById(questionId);
          if (question?.reviewStatus === 'confirmed')
            await source.questionRepository.save({
              ...question,
              reviewStatus: 'candidate',
              updatedAt: nextTimestamp(question.updatedAt)
            });
        }
      }
      return next;
    });
  }

  async function restore(type: TrainingAssetKind, id: string) {
    const config = TYPES[type];
    if (!config) throw new TypeError(`Unknown training asset: ${type}`);
    return runTransaction(async source => {
      const repository = source[config.repository];
      const current = await repository.findById(id);
      if (!current) throw createAppError('TRAINING_ASSET_NOT_FOUND', '训练资产不存在。', 404);
      if (!current.deletedAt) return current;
      if (type === 'learningObjective') {
        const parent = await source.knowledgeItemRepository.findById(current.knowledgeItemId);
        if (!parent || parent.deletedAt) fail('TRAINING_ASSET_RESTORE_BLOCKED', '所属知识点已删除，请先恢复知识点。');
      }
      if (type === 'examFocus') {
        const [profile, objective] = await Promise.all([
          source.examProfileRepository.findById(current.examProfileId),
          source.learningObjectiveRepository.findById(current.learningObjectiveId)
        ]);
        if (!profile || profile.deletedAt || !objective || objective.deletedAt)
          fail('TRAINING_ASSET_RESTORE_BLOCKED', '请先恢复考试配置和学习目标。');
      }
      if (type === 'question') {
        const links = await source.questionObjectiveRepository.listByQuestionIds([id]);
        const objectives = await Promise.all(
          links.map(link => source.learningObjectiveRepository.findById(link.learningObjectiveId))
        );
        if (objectives.some(objective => !objective || objective.deletedAt))
          fail('TRAINING_ASSET_RESTORE_BLOCKED', '请先恢复题目关联的学习目标。');
      }
      const updated = { ...current, deletedAt: null, updatedAt: nextTimestamp(current.updatedAt) };
      if (type === 'learningObjective' || type === 'examFocus') {
        if (updated.reviewStatus === 'confirmed') updated.reviewStatus = 'candidate';
      }
      if (type === 'question' && ['candidate', 'confirmed'].includes(updated.reviewStatus as string))
        updated.reviewStatus = 'draft';
      return repository.save(updated);
    });
  }

  async function purge(
    type: TrainingAssetKind,
    id: string,
    expectedUpdatedAt: unknown,
    input: TrainingPurgeInput = {}
  ) {
    const config = TYPES[type];
    if (!config) throw new TypeError(`Unknown training asset: ${type}`);
    return runTransaction(async source => {
      assertPurgeDatasetEpoch(input, await getPurgeDatasetEpoch?.());
      if (!(await source[config.repository].findById(id))) {
        const tombstone = await getTombstone?.(config.collection, id);
        if (expectedUpdatedAt && tombstone?.previousUpdatedAt === expectedUpdatedAt)
          return {
            status: 'already-purged',
            asset: { type, id },
            exclusiveRecordsDeleted: {},
            offlineDevices: 'pending-sync',
            backups: 'retention-managed'
          };
        throw createAppError('TRAINING_ASSET_NOT_FOUND', '训练资产不存在。', 404);
      }
      const preflight = await inspect(type, id, source);
      if (!expectedUpdatedAt || expectedUpdatedAt !== preflight.expectedUpdatedAt)
        fail('TRAINING_ASSET_UPDATE_CONFLICT', '资产已变化，请重新预检。', { preflight });
      if (preflight.decision !== 'can-purge-no-history')
        fail(
          'TRAINING_ASSET_PURGE_BLOCKED',
          preflight.references.find(reference => reference.reasonCode === 'TASK_REFERENCE_COVERAGE_UNAVAILABLE')
            ?.message ?? '请先处理关联引用。',
          { preflight }
        );
      assertManualPurgeScope(type, (await source[config.repository].findById(id))!, input);
      if (type === 'question') {
        await source.questionObjectiveRepository.deleteByQuestionId(id);
        await source.questionSourceRepository.deleteByQuestionId(id);
      }
      await source[config.repository].delete(id);
      return {
        status: 'subject-purged',
        asset: preflight.asset,
        exclusiveRecordsDeleted: preflight.exclusiveRecords,
        offlineDevices: 'pending-sync',
        backups: 'retention-managed'
      };
    });
  }

  return { inspect, trash, restore, purge };
}

// The local JSON store deliberately rejects Promise-returning transactions.
export function createLocalTrainingAssetLifecycle({
  repositories,
  runTransaction = operation => operation(),
  getTombstone = null,
  readPurgeTaskState = null,
  getPurgeDatasetEpoch = null
}: LocalTrainingAssetDependencies) {
  function inspect(type: TrainingAssetKind, id: string) {
    const config = TYPES[type];
    if (!config) throw new TypeError(`Unknown training asset: ${type}`);
    const asset = repositories[config.repository].findById(id);
    if (!asset) throw createAppError('TRAINING_ASSET_NOT_FOUND', '训练资产不存在。', 404);
    const references: TrainingReference[] = [];
    if (type === 'learningObjective') {
      references.push(
        ...repositories.examFocusRepository
          .list({ learningObjectiveId: id, includeArchived: true, includeDeleted: true })
          .map(record => ({
            collection: 'examFocuses',
            id: record.id,
            action: 'rebind-or-purge-focus',
            relatedAsset: { kind: 'examFocus', id: record.id }
          }))
      );
      references.push(
        ...repositories.questionObjectiveRepository.listByObjectiveId(id).map(record => ({
          collection: 'questionObjectives',
          id: record.id,
          action: 'rebind-question-objective',
          relatedAsset: { kind: 'question', id: record.questionId }
        }))
      );
      references.push(
        ...repositories.questionSourceRepository
          .list()
          .filter(record => record.sourceType === 'learningObjective' && record.sourceId === id)
          .map(record => ({
            collection: 'questionSources',
            id: record.id,
            action: 'replace-question-source',
            relatedAsset: { kind: 'question', id: record.questionId }
          }))
      );
    }
    if (type === 'examProfile')
      references.push(
        ...repositories.examFocusRepository
          .list({ examProfileId: id, includeArchived: true, includeDeleted: true })
          .map(record => ({
            collection: 'examFocuses',
            id: record.id,
            action: 'rebind-or-purge-focus',
            relatedAsset: { kind: 'examFocus', id: record.id }
          }))
      );
    references.push(
      ...(repositories.analysisScopeRepository?.list?.({ includeDeleted: true }) ?? [])
        .filter(record => includesExactId(record, id))
        .map(record => ({ collection: 'analysisScopeSnapshots', id: record.id, action: 'retain-or-resolve-history' }))
    );
    return supplementPurgePreview<TrainingPreflight>(
      {
        asset: { type, id },
        operation: 'permanent-delete',
        expectedUpdatedAt: asset.updatedAt,
        decision: !asset.deletedAt
          ? 'move-to-recycle-bin-first'
          : references.length
            ? 'requires-dependency-action'
            : 'can-purge-no-history',
        references,
        exclusiveRecords:
          type === 'question'
            ? {
                questionObjectives: repositories.questionObjectiveRepository
                  .listByQuestionIds([id])
                  .map(record => record.id),
                questionSources: repositories.questionSourceRepository.listByQuestionIds([id]).map(record => record.id)
              }
            : {},
        coverage: {
          persistedCurrentAndHistory: true,
          runningTasks: 'unverified',
          offlineDevices: 'pending-sync',
          backups: 'retention-managed'
        }
      },
      taskCoverage(readPurgeTaskState),
      getPurgeDatasetEpoch?.()
    );
  }
  function trash(type: TrainingAssetKind, id: string) {
    return runTransaction(() => {
      const repository = repositories[TYPES[type]?.repository];
      if (!repository) throw new TypeError(`Unknown training asset: ${type}`);
      const current = repository.findById(id);
      if (!current) throw createAppError('TRAINING_ASSET_NOT_FOUND', '训练资产不存在。', 404);
      if (current.deletedAt) return current;
      const timestamp = nextTimestamp(current.updatedAt);
      const next = repository.save({ ...current, deletedAt: timestamp, updatedAt: timestamp });
      if (type === 'learningObjective') {
        const links = repositories.questionObjectiveRepository.listByObjectiveId(id);
        const changedSources = repositories.questionSourceRepository.markBySourceIds(
          'learningObjective',
          [id],
          'stale'
        );
        for (const questionId of new Set([
          ...links.map(link => link.questionId),
          ...changedSources.map(item => item.questionId)
        ])) {
          const question = repositories.questionRepository.findById(questionId);
          if (question?.reviewStatus === 'confirmed')
            repositories.questionRepository.save({
              ...question,
              reviewStatus: 'candidate',
              updatedAt: nextTimestamp(question.updatedAt)
            });
        }
      }
      return next;
    });
  }
  function restore(type: TrainingAssetKind, id: string) {
    return runTransaction(() => {
      const repository = repositories[TYPES[type]?.repository];
      if (!repository) throw new TypeError(`Unknown training asset: ${type}`);
      const current = repository.findById(id);
      if (!current) throw createAppError('TRAINING_ASSET_NOT_FOUND', '训练资产不存在。', 404);
      if (!current.deletedAt) return current;
      if (type === 'learningObjective') {
        const parent = repositories.knowledgeItemRepository.findById(current.knowledgeItemId);
        if (!parent || parent.deletedAt) fail('TRAINING_ASSET_RESTORE_BLOCKED', '所属知识点已删除，请先恢复知识点。');
      }
      if (type === 'examFocus') {
        const profile = repositories.examProfileRepository.findById(current.examProfileId);
        const objective = repositories.learningObjectiveRepository.findById(current.learningObjectiveId);
        if (!profile || profile.deletedAt || !objective || objective.deletedAt)
          fail('TRAINING_ASSET_RESTORE_BLOCKED', '请先恢复考试配置和学习目标。');
      }
      if (type === 'question') {
        const links = repositories.questionObjectiveRepository.listByQuestionIds([id]);
        if (
          links.some(link => {
            const objective = repositories.learningObjectiveRepository.findById(link.learningObjectiveId);
            return !objective || objective.deletedAt;
          })
        )
          fail('TRAINING_ASSET_RESTORE_BLOCKED', '请先恢复题目关联的学习目标。');
      }
      const updated = { ...current, deletedAt: null, updatedAt: nextTimestamp(current.updatedAt) };
      if (['learningObjective', 'examFocus'].includes(type) && updated.reviewStatus === 'confirmed')
        updated.reviewStatus = 'candidate';
      if (type === 'question' && ['candidate', 'confirmed'].includes(updated.reviewStatus as string))
        updated.reviewStatus = 'draft';
      return repository.save(updated);
    });
  }
  function purge(type: TrainingAssetKind, id: string, expectedUpdatedAt: unknown, input: TrainingPurgeInput = {}) {
    return runTransaction(() => {
      assertPurgeDatasetEpoch(input, getPurgeDatasetEpoch?.());
      const config = TYPES[type];
      if (!config) throw new TypeError(`Unknown training asset: ${type}`);
      if (!repositories[config.repository].findById(id)) {
        const tombstone = getTombstone?.(config.collection, id);
        if (expectedUpdatedAt && tombstone?.previousUpdatedAt === expectedUpdatedAt)
          return {
            status: 'already-purged',
            asset: { type, id },
            exclusiveRecordsDeleted: {},
            offlineDevices: 'pending-sync',
            backups: 'retention-managed'
          };
        throw createAppError('TRAINING_ASSET_NOT_FOUND', '训练资产不存在。', 404);
      }
      const preflight = inspect(type, id);
      if (!expectedUpdatedAt || expectedUpdatedAt !== preflight.expectedUpdatedAt)
        fail('TRAINING_ASSET_UPDATE_CONFLICT', '资产已变化，请重新预检。', { preflight });
      if (preflight.decision !== 'can-purge-no-history')
        fail(
          'TRAINING_ASSET_PURGE_BLOCKED',
          preflight.references.find(reference => reference.reasonCode === 'TASK_REFERENCE_COVERAGE_UNAVAILABLE')
            ?.message ?? '请先处理关联引用。',
          { preflight }
        );
      assertManualPurgeScope(type, repositories[config.repository].findById(id)!, input);
      if (type === 'question') {
        repositories.questionObjectiveRepository.deleteByQuestionId(id);
        repositories.questionSourceRepository.deleteByQuestionId(id);
      }
      repositories[TYPES[type].repository].delete(id);
      return {
        status: 'subject-purged',
        asset: preflight.asset,
        exclusiveRecordsDeleted: preflight.exclusiveRecords,
        offlineDevices: 'pending-sync',
        backups: 'retention-managed'
      };
    });
  }
  return { inspect, trash, restore, purge };
}
