import { LearningObjective } from '../domain/learning-objective.ts';
import { buildCreateLearningObjectiveDto, buildUpdateLearningObjectiveDto } from './dto/learning-objective.dto.ts';
import { assertLearningObjectiveConfirmable } from './formal-asset-validation.ts';
import { conflictError, notFoundError, validationError } from './knowledge-errors.ts';

import { assertLearningObjectiveBaseline, nextLearningObjectiveTimestamp } from './learning-objective-concurrency.ts';

import type { LearningObjectiveDependencies } from './service-dependencies.ts';
import type { LearningObjectiveDtoInput } from './dto/learning-objective.dto.ts';
import type { LearningObjectiveConstructorInput } from '../domain/learning-objective.ts';
import type { LearningObjectiveReviewInput } from './learning-objective-concurrency.ts';
import type { LearningObjectiveServiceRecord as ObjectiveRecord } from './service-dependencies.ts';
type ObjectiveInput = LearningObjectiveDtoInput & LearningObjectiveReviewInput;

export function createLearningObjectiveService({
  repository,
  knowledgeItemRepository,
  getTombstone = null,
  onObjectiveInvalidated = null,
  runTransaction = operation => operation()
}: LearningObjectiveDependencies = {}) {
  if (!repository || !knowledgeItemRepository) throw new TypeError('LearningObjective repositories are required');

  function requireObjective(id: string, { includeArchived = false } = {}) {
    const objective = repository!.findById(id) as LearningObjective;
    if (!objective || objective.deletedAt || (!includeArchived && objective.reviewStatus === 'archived')) {
      throw notFoundError('LEARNING_OBJECTIVE_NOT_FOUND', 'LearningObjective not found');
    }
    return objective;
  }

  function requireKnowledgeItem(id: string, { confirmed = false } = {}) {
    const item = knowledgeItemRepository!.findById(id);
    if (!item || item.deletedAt || item.reviewStatus === 'archived') {
      throw notFoundError('KNOWLEDGE_ITEM_NOT_FOUND', 'KnowledgeItem not found');
    }
    if (confirmed && item.reviewStatus !== 'confirmed') {
      throw validationError(
        'KNOWLEDGE_ITEM_NOT_CONFIRMED',
        'LearningObjective confirmation requires a confirmed KnowledgeItem'
      );
    }
    return item;
  }

  function assertConfirmable(
    objective: Pick<ObjectiveRecord, 'knowledgeItemId' | 'objective' | 'actionVerb' | 'cognitiveLevel'>
  ) {
    const item = knowledgeItemRepository!.findById(objective.knowledgeItemId);
    return assertLearningObjectiveConfirmable(objective, item);
  }

  function assertObjectiveIdAvailable(id: string) {
    if (getTombstone?.('learningObjectives', id))
      throw conflictError('LEARNING_OBJECTIVE_ID_DELETED', '已清理的学习目标 ID 不能复用');
    if (repository!.findById(id)) {
      throw conflictError('LEARNING_OBJECTIVE_ID_CONFLICT', 'A LearningObjective with the same id already exists');
    }
  }

  function saveNew(objective: ObjectiveRecord) {
    return repository!.create?.(objective) ?? repository!.save(objective);
  }

  function notifyIfInvalidated(
    previous: Pick<ObjectiveRecord, 'reviewStatus'> | null | undefined,
    next: Pick<ObjectiveRecord, 'id' | 'reviewStatus'>
  ) {
    if (previous?.reviewStatus === 'confirmed' && next?.reviewStatus !== 'confirmed') {
      onObjectiveInvalidated?.(next.id);
    }
  }

  function createCandidate(input: ObjectiveInput = {}) {
    const dto = buildCreateLearningObjectiveDto(input);
    return runTransaction(() => {
      const item = requireKnowledgeItem(dto.knowledgeItemId, { confirmed: Object.hasOwn(input, 'reviewBaseline') });
      assertLearningObjectiveBaseline(null, item, input);
      assertObjectiveIdAvailable(dto.id);
      return saveNew(new LearningObjective({ ...dto, id: dto.id }));
    });
  }

  function updateObjective(id: string, input: ObjectiveInput = {}) {
    const dto = buildUpdateLearningObjectiveDto(input) as Partial<LearningObjectiveConstructorInput>;
    return runTransaction(() => {
      const current = requireObjective(id);
      assertLearningObjectiveBaseline(current, requireKnowledgeItem(current.knowledgeItemId), input);
      const changed = (Object.keys(dto) as (keyof typeof dto)[]).some(field => dto[field] !== current[field]);
      const next = repository!.save(
        new LearningObjective({
          ...current,
          ...dto,
          reviewStatus: current.reviewStatus === 'confirmed' && changed ? 'candidate' : current.reviewStatus,
          updatedAt: nextLearningObjectiveTimestamp(current)
        }),
        { expectedUpdatedAt: current.updatedAt }
      );
      notifyIfInvalidated(current, next);
      return next;
    });
  }

  return {
    createCandidate,
    getObjective: (id: string) => requireObjective(id, { includeArchived: true }),
    listObjectives(options: Parameters<NonNullable<LearningObjectiveDependencies['repository']>['list']>[0] = {}) {
      return repository.list(options);
    },
    updateObjective,
    confirmObjective(id: string, input: ObjectiveInput = {}) {
      return runTransaction(() => {
        const current = requireObjective(id);
        assertLearningObjectiveBaseline(current, requireKnowledgeItem(current.knowledgeItemId), input);
        assertConfirmable(current);
        return repository.save(
          new LearningObjective({
            ...current,
            reviewStatus: 'confirmed',
            reviewNote: null,
            updatedAt: nextLearningObjectiveTimestamp(current)
          }),
          { expectedUpdatedAt: current.updatedAt }
        );
      });
    },
    requestRevision(id: string, reviewNote: string | null = null) {
      const current = requireObjective(id);
      return runTransaction(() => {
        const next = repository.save(
          new LearningObjective({
            ...current,
            reviewStatus: 'candidate',
            reviewNote: reviewNote?.trim?.() || current.reviewNote || null,
            updatedAt: nextLearningObjectiveTimestamp(current)
          })
        );
        notifyIfInvalidated(current, next);
        return next;
      });
    },
    archive(id: string) {
      const current = requireObjective(id);
      return runTransaction(() => {
        const next = repository.save(
          new LearningObjective({
            ...current,
            reviewStatus: 'archived',
            updatedAt: nextLearningObjectiveTimestamp(current)
          })
        );
        notifyIfInvalidated(current, next);
        return next;
      });
    },
    restore(id: string) {
      const current = requireObjective(id, { includeArchived: true });
      if (current.reviewStatus !== 'archived') return current;
      return repository.save(
        new LearningObjective({
          ...current,
          reviewStatus: 'candidate',
          updatedAt: nextLearningObjectiveTimestamp(current)
        })
      );
    },
    invalidateByKnowledgeItemId(knowledgeItemId: string) {
      return runTransaction(() => {
        const changed = [];
        for (const current of repository.list({
          knowledgeItemId,
          includeArchived: true
        })) {
          if (current.deletedAt) continue;
          if (current.reviewStatus !== 'confirmed') continue;
          const next = repository.save(
            new LearningObjective({
              ...current,
              reviewStatus: 'candidate',
              reviewNote: current.reviewNote || 'Parent KnowledgeItem requires review',
              updatedAt: nextLearningObjectiveTimestamp(current)
            })
          );
          changed.push(next);
          notifyIfInvalidated(current, next);
        }
        return changed;
      });
    },
    assertConfirmable
  };
}
