import { ExamProfile } from '../domain/exam-profile.js';
import { ExamFocus } from '../domain/exam-focus.js';
import {
  buildCreateExamFocusDto,
  buildCreateExamProfileDto,
  buildUpdateExamFocusDto,
  buildUpdateExamProfileDto
} from './dto/assessment.dto.js';
import { conflictError, notFoundError, validationError } from './knowledge-errors.js';

const now = () => new Date().toISOString();

/** @param {import('./service-dependencies.ts').AssessmentContextDependencies} dependencies */
export function createAssessmentContextService({
  examProfileRepository,
  examFocusRepository,
  learningObjectiveRepository,
  getTombstone = null,
  runTransaction = operation => operation()
} = {}) {
  if (!examProfileRepository || !examFocusRepository || !learningObjectiveRepository)
    throw new TypeError('Assessment context repositories are required');

  function requireProfile(id, { includeArchived = false } = {}) {
    const profile = examProfileRepository.findById(id);
    if (!profile || profile.deletedAt || (!includeArchived && profile.archivedAt))
      throw notFoundError('EXAM_PROFILE_NOT_FOUND', 'ExamProfile not found');
    return profile;
  }
  function requireObjective(id, { confirmed = false } = {}) {
    const objective = learningObjectiveRepository.findById(id);
    if (!objective || objective.deletedAt || objective.reviewStatus === 'archived')
      throw notFoundError('LEARNING_OBJECTIVE_NOT_FOUND', 'LearningObjective not found');
    if (confirmed && objective.reviewStatus !== 'confirmed')
      throw validationError('LEARNING_OBJECTIVE_NOT_CONFIRMED', 'ExamFocus requires a confirmed LearningObjective');
    return objective;
  }
  function requireFocus(id, { includeArchived = false } = {}) {
    const focus = examFocusRepository.findById(id);
    if (!focus || focus.deletedAt || (!includeArchived && focus.reviewStatus === 'archived'))
      throw notFoundError('EXAM_FOCUS_NOT_FOUND', 'ExamFocus not found');
    return focus;
  }
  function assertIdAvailable(repository, id, code, entityName, collection) {
    if (getTombstone?.(collection, id))
      throw conflictError('TRAINING_ASSET_ID_DELETED', '已清理的考试资产 ID 不能复用');
    if (repository.findById(id)) {
      throw conflictError(code, `A ${entityName} with the same id already exists`);
    }
  }
  function saveNew(repository, record) {
    return repository.create?.(record) ?? repository.save(record);
  }

  const profileService = {
    create(input = {}) {
      const dto = buildCreateExamProfileDto(input);
      assertIdAvailable(examProfileRepository, dto.id, 'EXAM_PROFILE_ID_CONFLICT', 'ExamProfile', 'examProfiles');
      return runTransaction(() => saveNew(examProfileRepository, new ExamProfile(dto)));
    },
    get(id) {
      return requireProfile(id, { includeArchived: true });
    },
    list(options = {}) {
      return examProfileRepository.list(options);
    },
    update(id, input = {}) {
      return examProfileRepository.save(
        new ExamProfile({ ...requireProfile(id), ...buildUpdateExamProfileDto(input), updatedAt: now() })
      );
    },
    archive(id) {
      return examProfileRepository.save(
        new ExamProfile({ ...requireProfile(id), archivedAt: now(), updatedAt: now() })
      );
    },
    restore(id) {
      const current = requireProfile(id, { includeArchived: true });
      if (!current.archivedAt) return current;
      return examProfileRepository.save(new ExamProfile({ ...current, archivedAt: null, updatedAt: now() }));
    }
  };

  const focusService = {
    create(input = {}) {
      const dto = buildCreateExamFocusDto(input);
      assertIdAvailable(examFocusRepository, dto.id, 'EXAM_FOCUS_ID_CONFLICT', 'ExamFocus', 'examFocuses');
      requireProfile(dto.examProfileId);
      requireObjective(dto.learningObjectiveId);
      const duplicate = examFocusRepository.list({
        examProfileId: dto.examProfileId,
        learningObjectiveId: dto.learningObjectiveId,
        includeArchived: true,
        includeDeleted: true
      })[0];
      if (duplicate)
        throw conflictError('EXAM_FOCUS_CONFLICT', 'ExamProfile already focuses on this LearningObjective');
      return runTransaction(() => saveNew(examFocusRepository, new ExamFocus(dto)));
    },
    get(id) {
      return requireFocus(id, { includeArchived: true });
    },
    list(options = {}) {
      return examFocusRepository.list(options);
    },
    update(id, input = {}) {
      return examFocusRepository.save(
        new ExamFocus({ ...requireFocus(id), ...buildUpdateExamFocusDto(input), updatedAt: now() })
      );
    },
    confirm(id) {
      const current = requireFocus(id);
      requireProfile(current.examProfileId);
      requireObjective(current.learningObjectiveId, { confirmed: true });
      return examFocusRepository.save(new ExamFocus({ ...current, reviewStatus: 'confirmed', updatedAt: now() }));
    },
    archive(id) {
      return examFocusRepository.save(
        new ExamFocus({ ...requireFocus(id), reviewStatus: 'archived', updatedAt: now() })
      );
    },
    restore(id) {
      const current = requireFocus(id, { includeArchived: true });
      if (current.reviewStatus !== 'archived') return current;
      return examFocusRepository.save(new ExamFocus({ ...current, reviewStatus: 'candidate', updatedAt: now() }));
    }
  };

  return { profileService, focusService };
}
