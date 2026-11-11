import { ExamProfile } from '../../domain/exam-profile.ts';
import { ExamFocus } from '../../domain/exam-focus.ts';
import {
  buildCreateExamFocusDto,
  buildCreateExamProfileDto,
  buildUpdateExamFocusDto,
  buildUpdateExamProfileDto
} from '../dto/assessment.dto.ts';
import { conflictError, notFoundError, validationError } from '../knowledge-errors.ts';

import type { AssessmentContextDependencies } from './service-dependencies.ts';
import type { AssessmentDtoInput } from '../dto/assessment.dto.ts';
import type { AssessmentRecord } from '../../infrastructure/assessment-repository.ts';
import type { AssessmentWritePort } from '../service-dependencies.ts';

const now = () => new Date().toISOString();

export function createAsyncAssessmentContextService({
  examProfileRepository,
  examFocusRepository,
  learningObjectiveRepository,
  getTombstone = null,
  runTransaction = operation => operation()
}: AssessmentContextDependencies = {}) {
  if (!examProfileRepository || !examFocusRepository || !learningObjectiveRepository)
    throw new TypeError('Async assessment context repositories are required');

  async function requireProfile(id: string, { includeArchived = false } = {}) {
    const profile = await examProfileRepository!.findById(id);
    if (!profile || profile.deletedAt || (!includeArchived && profile.archivedAt))
      throw notFoundError('EXAM_PROFILE_NOT_FOUND', 'ExamProfile not found');
    return profile;
  }
  async function requireObjective(id: string, { confirmed = false } = {}) {
    const objective = await learningObjectiveRepository!.findById(id);
    if (!objective || objective.deletedAt || objective.reviewStatus === 'archived')
      throw notFoundError('LEARNING_OBJECTIVE_NOT_FOUND', 'LearningObjective not found');
    if (confirmed && objective.reviewStatus !== 'confirmed')
      throw validationError('LEARNING_OBJECTIVE_NOT_CONFIRMED', 'ExamFocus requires a confirmed LearningObjective');
    return objective;
  }
  async function requireFocus(id: string, { includeArchived = false } = {}) {
    const focus = await examFocusRepository!.findById(id);
    if (!focus || focus.deletedAt || (!includeArchived && focus.reviewStatus === 'archived'))
      throw notFoundError('EXAM_FOCUS_NOT_FOUND', 'ExamFocus not found');
    return focus;
  }
  async function assertIdAvailable(
    repository: { findById: (id: string) => object | null | undefined | PromiseLike<object | null | undefined> },
    id: string,
    code: string,
    entityName: string,
    collection: string
  ) {
    if (await getTombstone?.(collection, id))
      throw conflictError('TRAINING_ASSET_ID_DELETED', '已清理的考试资产 ID 不能复用');
    if (await repository.findById(id)) {
      throw conflictError(code, `A ${entityName} with the same id already exists`);
    }
  }
  async function saveNew<Record extends AssessmentRecord, Result>(
    repository: AssessmentWritePort<NoInfer<Record>, Result>,
    record: Record
  ) {
    return repository.create ? repository.create(record) : repository.save(record);
  }

  const profileService = {
    async create(input: AssessmentDtoInput = {}) {
      const dto = buildCreateExamProfileDto(input);
      await assertIdAvailable(examProfileRepository, dto.id, 'EXAM_PROFILE_ID_CONFLICT', 'ExamProfile', 'examProfiles');
      return runTransaction(async ({ examProfileRepository: repository = examProfileRepository } = {}) =>
        saveNew(repository, new ExamProfile(dto))
      );
    },
    get: (id: string) => requireProfile(id, { includeArchived: true }),
    list: (options: Parameters<NonNullable<AssessmentContextDependencies['examProfileRepository']>['list']>[0] = {}) =>
      examProfileRepository.list(options),
    async update(id: string, input: AssessmentDtoInput = {}) {
      return examProfileRepository.save(
        new ExamProfile({ ...(await requireProfile(id)), ...buildUpdateExamProfileDto(input), updatedAt: now() })
      );
    },
    async archive(id: string) {
      const current = await requireProfile(id);
      return examProfileRepository.save(new ExamProfile({ ...current, archivedAt: now(), updatedAt: now() }));
    },
    async restore(id: string) {
      const current = await requireProfile(id, { includeArchived: true });
      return !current.archivedAt
        ? current
        : examProfileRepository.save(new ExamProfile({ ...current, archivedAt: null, updatedAt: now() }));
    }
  };

  const focusService = {
    async create(input: AssessmentDtoInput = {}) {
      const dto = buildCreateExamFocusDto(input);
      await assertIdAvailable(examFocusRepository, dto.id, 'EXAM_FOCUS_ID_CONFLICT', 'ExamFocus', 'examFocuses');
      await requireProfile(dto.examProfileId);
      await requireObjective(dto.learningObjectiveId);
      if (await examFocusRepository.findByProfileAndObjective(dto.examProfileId, dto.learningObjectiveId))
        throw conflictError('EXAM_FOCUS_CONFLICT', 'ExamProfile already focuses on this LearningObjective');
      return runTransaction(async ({ examFocusRepository: repository = examFocusRepository } = {}) =>
        saveNew(repository, new ExamFocus(dto))
      );
    },
    get: (id: string) => requireFocus(id, { includeArchived: true }),
    list: (options: Parameters<NonNullable<AssessmentContextDependencies['examFocusRepository']>['list']>[0] = {}) =>
      examFocusRepository.list(options),
    async update(id: string, input: AssessmentDtoInput = {}) {
      return examFocusRepository.save(
        new ExamFocus({ ...(await requireFocus(id)), ...buildUpdateExamFocusDto(input), updatedAt: now() })
      );
    },
    async confirm(id: string) {
      const current = await requireFocus(id);
      await requireProfile(current.examProfileId);
      await requireObjective(current.learningObjectiveId, { confirmed: true });
      return examFocusRepository.save(new ExamFocus({ ...current, reviewStatus: 'confirmed', updatedAt: now() }));
    },
    async archive(id: string) {
      return examFocusRepository.save(
        new ExamFocus({ ...(await requireFocus(id)), reviewStatus: 'archived', updatedAt: now() })
      );
    },
    async restore(id: string) {
      const current = await requireFocus(id, { includeArchived: true });
      return current.reviewStatus !== 'archived'
        ? current
        : examFocusRepository.save(new ExamFocus({ ...current, reviewStatus: 'candidate', updatedAt: now() }));
    }
  };

  return { profileService, focusService };
}
