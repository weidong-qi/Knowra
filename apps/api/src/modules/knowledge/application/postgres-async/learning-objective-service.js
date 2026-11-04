import { LearningObjective } from '../../domain/learning-objective.ts';
import { buildCreateLearningObjectiveDto, buildUpdateLearningObjectiveDto } from '../dto/learning-objective.dto.ts';
import { assertLearningObjectiveConfirmable } from '../formal-asset-validation.js';
import { conflictError, notFoundError, validationError } from '../knowledge-errors.js';

import {
  assertLearningObjectiveBaseline,
  nextLearningObjectiveTimestamp,
  withLearningObjectiveReviewErrors
} from '../learning-objective-concurrency.js';

/** @param {import('./service-dependencies.ts').LearningObjectiveDependencies} dependencies */
export function createAsyncLearningObjectiveService({
  repository,
  knowledgeItemRepository,
  getTombstone = null,
  onObjectiveInvalidated = null,
  runTransaction = operation => operation()
} = {}) {
  if (!repository || !knowledgeItemRepository) throw new TypeError('Async LearningObjective repositories are required');

  async function requireObjective(id, { includeArchived = false, lock = false } = {}) {
    if (lock) {
      const initial = await repository.findById(id);
      if (initial) {
        // 所有审阅写入按父知识→目标加锁，与父知识失效传播顺序一致。
        await knowledgeItemRepository.lockById?.(initial.knowledgeItemId);
        await repository.lockById?.(id);
      }
    }
    const objective = await repository.findById(id);
    if (!objective || objective.deletedAt || (!includeArchived && objective.reviewStatus === 'archived'))
      throw notFoundError('LEARNING_OBJECTIVE_NOT_FOUND', 'LearningObjective not found');
    return objective;
  }

  async function requireKnowledgeItem(id, { confirmed = false } = {}) {
    const item = await knowledgeItemRepository.findById(id);
    if (!item || item.deletedAt || item.reviewStatus === 'archived')
      throw notFoundError('KNOWLEDGE_ITEM_NOT_FOUND', 'KnowledgeItem not found');
    if (confirmed && item.reviewStatus !== 'confirmed')
      throw validationError(
        'KNOWLEDGE_ITEM_NOT_CONFIRMED',
        'LearningObjective confirmation requires a confirmed KnowledgeItem'
      );
    return item;
  }

  async function assertConfirmable(objective) {
    const item = await knowledgeItemRepository.findById(objective.knowledgeItemId);
    return assertLearningObjectiveConfirmable(objective, item);
  }

  async function assertObjectiveIdAvailable(id) {
    if (await getTombstone?.('learningObjectives', id))
      throw conflictError('LEARNING_OBJECTIVE_ID_DELETED', '已清理的学习目标 ID 不能复用');
    if (await repository.findById(id)) {
      throw conflictError('LEARNING_OBJECTIVE_ID_CONFLICT', 'A LearningObjective with the same id already exists');
    }
  }

  async function saveNew(targetRepository, objective) {
    return targetRepository.create ? targetRepository.create(objective) : targetRepository.save(objective);
  }

  async function notifyIfInvalidated(previous, next) {
    if (previous?.reviewStatus === 'confirmed' && next?.reviewStatus !== 'confirmed') {
      await onObjectiveInvalidated?.(next.id);
    }
  }

  const service = {
    async createCandidate(input = {}) {
      const dto = buildCreateLearningObjectiveDto(input);
      await knowledgeItemRepository.lockById?.(dto.knowledgeItemId);
      const item = await requireKnowledgeItem(dto.knowledgeItemId, {
        confirmed: Object.hasOwn(input, 'reviewBaseline')
      });
      assertLearningObjectiveBaseline(null, item, input);
      await assertObjectiveIdAvailable(dto.id);
      return runTransaction(async ({ learningObjectiveRepository = repository } = {}) =>
        saveNew(learningObjectiveRepository, new LearningObjective({ ...dto, id: dto.id }))
      );
    },
    getObjective: id => requireObjective(id, { includeArchived: true }),
    listObjectives: (options = {}) => repository.list(options),
    async updateObjective(id, input = {}) {
      const current = await requireObjective(id, { lock: true });
      assertLearningObjectiveBaseline(current, await requireKnowledgeItem(current.knowledgeItemId), input);
      const dto = buildUpdateLearningObjectiveDto(input);
      const changed = Object.keys(dto).some(field => dto[field] !== current[field]);
      const next = await repository.save(
        new LearningObjective({
          ...current,
          ...dto,
          reviewStatus: current.reviewStatus === 'confirmed' && changed ? 'candidate' : current.reviewStatus,
          updatedAt: nextLearningObjectiveTimestamp(current)
        }),
        { expectedUpdatedAt: current.updatedAt }
      );
      await notifyIfInvalidated(current, next);
      return next;
    },
    async confirmObjective(id, input = {}) {
      const current = await requireObjective(id, { lock: true });
      assertLearningObjectiveBaseline(current, await requireKnowledgeItem(current.knowledgeItemId), input);
      await assertConfirmable(current);
      return repository.save(
        new LearningObjective({
          ...current,
          reviewStatus: 'confirmed',
          reviewNote: null,
          updatedAt: nextLearningObjectiveTimestamp(current)
        }),
        { expectedUpdatedAt: current.updatedAt }
      );
    },
    async requestRevision(id, reviewNote = null) {
      const current = await requireObjective(id, { lock: true });
      const next = await repository.save(
        new LearningObjective({
          ...current,
          reviewStatus: 'candidate',
          reviewNote: reviewNote?.trim?.() || current.reviewNote || null,
          updatedAt: nextLearningObjectiveTimestamp(current)
        }),
        { expectedUpdatedAt: current.updatedAt }
      );
      await notifyIfInvalidated(current, next);
      return next;
    },
    async archive(id) {
      const current = await requireObjective(id, { lock: true });
      const next = await repository.save(
        new LearningObjective({
          ...current,
          reviewStatus: 'archived',
          updatedAt: nextLearningObjectiveTimestamp(current)
        }),
        { expectedUpdatedAt: current.updatedAt }
      );
      await notifyIfInvalidated(current, next);
      return next;
    },
    async restore(id) {
      const current = await requireObjective(id, { includeArchived: true, lock: true });
      if (current.reviewStatus !== 'archived') return current;
      return repository.save(
        new LearningObjective({
          ...current,
          reviewStatus: 'candidate',
          updatedAt: nextLearningObjectiveTimestamp(current)
        }),
        { expectedUpdatedAt: current.updatedAt }
      );
    },
    async invalidateByKnowledgeItemId(knowledgeItemId) {
      await knowledgeItemRepository.lockById?.(knowledgeItemId);
      const objectives = await repository.list({
        knowledgeItemId,
        includeArchived: true
      });
      const changed = [];
      for (const objective of objectives) {
        const current = await requireObjective(objective.id, { includeArchived: true, lock: true });
        if (current.reviewStatus !== 'confirmed') continue;
        const next = await repository.save(
          new LearningObjective({
            ...current,
            reviewStatus: 'candidate',
            reviewNote: current.reviewNote || 'Parent KnowledgeItem requires review',
            updatedAt: nextLearningObjectiveTimestamp(current)
          }),
          { expectedUpdatedAt: current.updatedAt }
        );
        changed.push(next);
        await notifyIfInvalidated(current, next);
      }
      return changed;
    },
    assertConfirmable
  };
  for (const method of ['createCandidate', 'updateObjective', 'confirmObjective']) {
    const operation = service[method];
    service[method] = (...args) =>
      withLearningObjectiveReviewErrors(method === 'createCandidate' ? args[0] : args[1], () => operation(...args), {
        hasObjective: method !== 'createCandidate'
      });
  }
  return service;
}
