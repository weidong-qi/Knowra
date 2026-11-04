import { ExamProfile } from '../../domain/exam-profile.ts';
import { ExamFocus } from '../../domain/exam-focus.ts';
import {
  buildCreateExamFocusDto,
  buildCreateExamProfileDto,
  buildUpdateExamFocusDto,
  buildUpdateExamProfileDto
} from '../dto/assessment.dto.ts';
import { conflictError, notFoundError, validationError } from '../knowledge-errors.js';

const now = () => new Date().toISOString();

/** @param {import('./service-dependencies.ts').AssessmentContextDependencies} dependencies */
export function createAsyncAssessmentContextService({
  examProfileRepository,
  examFocusRepository,
  learningObjectiveRepository,
  getTombstone = null,
  runTransaction = operation => operation()
} = {}) {
  if (!examProfileRepository || !examFocusRepository || !learningObjectiveRepository)
    throw new TypeError('Async assessment context repositories are required');

  async function requireProfile(id, { includeArchived = false } = {}) {
    const profile = await examProfileRepository.findById(id);
    if (!profile || profile.deletedAt || (!includeArchived && profile.archivedAt))
      throw notFoundError('EXAM_PROFILE_NOT_FOUND', 'ExamProfile not found');
    return profile;
  }
  async function requireObjective(id, { confirmed = false } = {}) {
    const objective = await learningObjectiveRepository.findById(id);
    if (!objective || objective.deletedAt || objective.reviewStatus === 'archived')
      throw notFoundError('LEARNING_OBJECTIVE_NOT_FOUND', 'LearningObjective not found');
    if (confirmed && objective.reviewStatus !== 'confirmed')
      throw validationError('LEARNING_OBJECTIVE_NOT_CONFIRMED', 'ExamFocus requires a confirmed LearningObjective');
    return objective;
  }
  async function requireFocus(id, { includeArchived = false } = {}) {
    const focus = await examFocusRepository.findById(id);
    if (!focus || focus.deletedAt || (!includeArchived && focus.reviewStatus === 'archived'))
      throw notFoundError('EXAM_FOCUS_NOT_FOUND', 'ExamFocus not found');
    return focus;
  }
  async function assertIdAvailable(repository, id, code, entityName, collection) {
    if (await getTombstone?.(collection, id))
      throw conflictError('TRAINING_ASSET_ID_DELETED', '已清理的考试资产 ID 不能复用');
    if (await repository.findById(id)) {
      throw conflictError(code, `A ${entityName} with the same id already exists`);
    }
  }
  /**
   * @template {import('../../infrastructure/assessment-repository.ts').AssessmentRecord} Record
   * @template Result
   * @param {import('../service-dependencies.ts').AssessmentWritePort<NoInfer<Record>, Result>} repository
   * @param {Record} record
   */
  async function saveNew(repository, record) {
    return repository.create ? repository.create(record) : repository.save(record);
  }

  const profileService = {
    async create(input = {}) {
      const dto = buildCreateExamProfileDto(input);
      await assertIdAvailable(examProfileRepository, dto.id, 'EXAM_PROFILE_ID_CONFLICT', 'ExamProfile', 'examProfiles');
      return runTransaction(async ({ examProfileRepository: repository = examProfileRepository } = {}) =>
        saveNew(repository, new ExamProfile(dto))
      );
    },
    get: id => requireProfile(id, { includeArchived: true }),
    list: (options = {}) => examProfileRepository.list(options),
    async update(id, input = {}) {
      return examProfileRepository.save(
        new ExamProfile({ ...(await requireProfile(id)), ...buildUpdateExamProfileDto(input), updatedAt: now() })
      );
    },
    async archive(id) {
      const current = await requireProfile(id);
      return examProfileRepository.save(new ExamProfile({ ...current, archivedAt: now(), updatedAt: now() }));
    },
    async restore(id) {
      const current = await requireProfile(id, { includeArchived: true });
      return !current.archivedAt
        ? current
        : examProfileRepository.save(new ExamProfile({ ...current, archivedAt: null, updatedAt: now() }));
    }
  };

  const focusService = {
    async create(input = {}) {
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
    get: id => requireFocus(id, { includeArchived: true }),
    list: (options = {}) => examFocusRepository.list(options),
    async update(id, input = {}) {
      return examFocusRepository.save(
        new ExamFocus({ ...(await requireFocus(id)), ...buildUpdateExamFocusDto(input), updatedAt: now() })
      );
    },
    async confirm(id) {
      const current = await requireFocus(id);
      await requireProfile(current.examProfileId);
      await requireObjective(current.learningObjectiveId, { confirmed: true });
      return examFocusRepository.save(new ExamFocus({ ...current, reviewStatus: 'confirmed', updatedAt: now() }));
    },
    async archive(id) {
      return examFocusRepository.save(
        new ExamFocus({ ...(await requireFocus(id)), reviewStatus: 'archived', updatedAt: now() })
      );
    },
    async restore(id) {
      const current = await requireFocus(id, { includeArchived: true });
      return current.reviewStatus !== 'archived'
        ? current
        : examFocusRepository.save(new ExamFocus({ ...current, reviewStatus: 'candidate', updatedAt: now() }));
    }
  };

  return { profileService, focusService };
}
