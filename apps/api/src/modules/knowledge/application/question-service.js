import { sameKnowraText } from '@study-accelerator/shared/knowra-marks';
import { Question } from '../domain/question.js';
import { QuestionSource } from '../domain/question-source.js';
import { buildCreateQuestionDto, buildUpdateQuestionDto } from './dto/assessment.dto.js';
import { assertQuestionConfirmable, deriveQuestionSourceStatus } from './formal-asset-validation.js';
import { conflictError, notFoundError, validationError } from './knowledge-errors.js';

const now = () => new Date().toISOString();
const supportedSourceTypes = new Set([
  'manual',
  'knowledgeItem',
  'learningObjective',
  'noteVersion',
  'knowledgeEvidence'
]);

/** @param {import('./service-dependencies.ts').QuestionDependencies} dependencies */
export function createQuestionService({
  repository,
  questionObjectiveRepository,
  questionSourceRepository,
  learningObjectiveRepository,
  examFocusRepository,
  knowledgeItemRepository,
  noteRepository,
  noteVersionRepository,
  knowledgeEvidenceRepository,
  getTombstone = null,
  runTransaction = operation => operation()
} = {}) {
  if (!repository || !questionObjectiveRepository || !questionSourceRepository || !learningObjectiveRepository)
    throw new TypeError('Question repositories are required');

  function requireQuestion(id, { includeArchived = false } = {}) {
    const question = repository.findById(id);
    if (!question || question.deletedAt || (!includeArchived && question.reviewStatus === 'archived'))
      throw notFoundError('QUESTION_NOT_FOUND', 'Question not found');
    return question;
  }

  function assertQuestionIdAvailable(id) {
    if (getTombstone?.('questions', id)) throw conflictError('QUESTION_ID_DELETED', '已清理的题目 ID 不能复用');
    if (repository.findById(id)) {
      throw conflictError('QUESTION_ID_CONFLICT', 'A Question with the same id already exists');
    }
  }

  function requireObjectives(ids, { confirmed = false } = {}) {
    const uniqueIds = [...new Set(ids)];
    const objectives = uniqueIds.map(id => {
      const objective = learningObjectiveRepository.findById(id);
      if (!objective || objective.deletedAt || objective.reviewStatus === 'archived')
        throw notFoundError('LEARNING_OBJECTIVE_NOT_FOUND', 'LearningObjective not found');
      if (confirmed && objective.reviewStatus !== 'confirmed')
        throw validationError('LEARNING_OBJECTIVE_NOT_CONFIRMED', 'Question requires confirmed LearningObjectives');
      return objective;
    });
    return objectives;
  }

  function resolveSourceReference(source, { preserveStale = false } = {}) {
    if (!supportedSourceTypes.has(source.sourceType))
      throw validationError('QUESTION_SOURCE_TYPE_UNSUPPORTED', 'QuestionSource type is not supported in Phase3.0');
    if (source.sourceType === 'manual') {
      return {
        ...source,
        status: preserveStale && source.status === 'stale' ? 'stale' : deriveQuestionSourceStatus(source)
      };
    }
    if (!source.sourceId)
      throw validationError('QUESTION_SOURCE_ID_REQUIRED', 'QuestionSource sourceId is required for this source type');
    const repositories = {
      knowledgeItem: knowledgeItemRepository,
      learningObjective: learningObjectiveRepository,
      noteVersion: noteVersionRepository,
      knowledgeEvidence: knowledgeEvidenceRepository
    };
    const sourceRepository = repositories[source.sourceType];
    let reference = sourceRepository?.findById(source.sourceId);
    if (!reference || reference.deletedAt)
      throw notFoundError('QUESTION_SOURCE_NOT_FOUND', 'QuestionSource reference not found');
    if (source.sourceType === 'noteVersion' && noteRepository) {
      const note = noteRepository.findById(reference.noteId);
      reference = {
        ...reference,
        isCurrent: Boolean(note && !note.deleted && sameKnowraText(note.rawMarkdown, reference.content))
      };
    }
    const derivedStatus = deriveQuestionSourceStatus(source, reference);
    return {
      ...source,
      status: preserveStale && source.status === 'stale' ? 'stale' : derivedStatus
    };
  }

  function resolveSources(sources = [], options = {}) {
    return sources.map(source => resolveSourceReference(source, options));
  }

  function assertSourceIdsAvailable(sources, questionId) {
    const sourceIds = new Set();
    for (const source of sources) {
      if (sourceIds.has(source.id)) {
        throw conflictError('QUESTION_SOURCE_ID_CONFLICT', 'QuestionSource ids must be unique');
      }
      sourceIds.add(source.id);
      const existing = questionSourceRepository.findById(source.id);
      if (!existing && getTombstone?.('questionSources', source.id))
        throw conflictError('QUESTION_SOURCE_ID_DELETED', '已清理的题目来源 ID 不能复用');
      if (existing && existing.questionId !== questionId) {
        throw conflictError('QUESTION_SOURCE_ID_CONFLICT', 'A QuestionSource with the same id already exists');
      }
    }
  }

  function hydrate(
    question,
    links = questionObjectiveRepository.listByQuestionIds([question.id]),
    sources = questionSourceRepository.listByQuestionIds([question.id])
  ) {
    return {
      ...question,
      learningObjectiveIds: links
        .filter(link => link.questionId === question.id)
        .sort((a, b) => /** @type {number} */ (a.order) - /** @type {number} */ (b.order))
        .map(link => link.learningObjectiveId),
      sources: sources.filter(source => source.questionId === question.id)
    };
  }

  function assertReady(question, { forConfirmation = false } = {}) {
    const links = questionObjectiveRepository.listByQuestionIds([question.id]);
    const objectives = requireObjectives(links.map(link => link.learningObjectiveId));
    const persistedSources = questionSourceRepository.listByQuestionIds([question.id]);
    const sources = resolveSources(persistedSources, { preserveStale: true });
    if (sources.some((source, index) => source.status !== persistedSources[index]?.status)) {
      questionSourceRepository.replaceForQuestion(
        question.id,
        sources.map(
          source =>
            new QuestionSource({
              ...source,
              questionId: question.id,
              updatedAt: now()
            })
        )
      );
    }
    assertQuestionConfirmable(question, { objectives, sources });
    if (forConfirmation && !['candidate', 'confirmed'].includes(question.reviewStatus))
      throw conflictError('QUESTION_REVIEW_REQUIRED', 'Question must be a candidate before confirmation');
  }
  function validateQuestion(id) {
    const current = requireQuestion(id);
    assertReady(current);
    const next =
      current.reviewStatus === 'confirmed'
        ? current
        : new Question({ ...current, reviewStatus: 'candidate', updatedAt: now() });
    if (next !== current) repository.save(next);
    return hydrate(next);
  }

  function replaceRelations(questionId, objectiveIds, sources) {
    questionObjectiveRepository.replaceForQuestion(questionId, objectiveIds);
    if (sources !== undefined) {
      assertSourceIdsAvailable(sources, questionId);
      questionSourceRepository.replaceForQuestion(
        questionId,
        sources.map(
          source =>
            new QuestionSource({ ...source, questionId, createdAt: source.createdAt ?? now(), updatedAt: now() })
        )
      );
    }
  }

  function saveNew(question) {
    return repository.create?.(question) ?? repository.save(question);
  }

  function downgradeConfirmedQuestions(questionIds) {
    const changed = [];
    for (const questionId of new Set(questionIds)) {
      const current = repository.findById(questionId);
      if (!current || current.reviewStatus !== 'confirmed') continue;
      const next = repository.save(
        new Question({
          ...current,
          reviewStatus: 'candidate',
          updatedAt: now()
        })
      );
      changed.push(next);
    }
    return changed;
  }

  function markSourcesStale(sourceType, sourceIds = []) {
    return runTransaction(() => {
      const changedSources = questionSourceRepository.markBySourceIds(sourceType, sourceIds, 'stale');
      downgradeConfirmedQuestions(changedSources.map(source => source.questionId));
      return changedSources;
    });
  }

  return {
    createQuestion(input = {}) {
      const dto = buildCreateQuestionDto(input);
      assertQuestionIdAvailable(dto.id);
      requireObjectives(dto.learningObjectiveIds);
      const sources = resolveSources(dto.sources);
      assertSourceIdsAvailable(sources, dto.id);
      const question = new Question(dto);
      return runTransaction(() => {
        saveNew(question);
        replaceRelations(question.id, dto.learningObjectiveIds, sources);
        return hydrate(question);
      });
    },
    getQuestion(id) {
      return hydrate(requireQuestion(id, { includeArchived: true }));
    },
    listQuestions(options = {}) {
      const questions = repository.list(options);
      const ids = questions.map(question => question.id);
      const links = questionObjectiveRepository.listByQuestionIds(ids);
      const sources = questionSourceRepository.listByQuestionIds(ids);
      let filtered = questions;
      if (options.learningObjectiveId)
        filtered = filtered.filter(question =>
          links.some(
            link => link.questionId === question.id && link.learningObjectiveId === options.learningObjectiveId
          )
        );
      if (options.examFocusId) {
        const focus = examFocusRepository?.findById(options.examFocusId);
        if (!focus || focus.deletedAt || focus.reviewStatus === 'archived')
          throw notFoundError('EXAM_FOCUS_NOT_FOUND', 'ExamFocus not found');
        filtered = filtered.filter(question =>
          links.some(link => link.questionId === question.id && link.learningObjectiveId === focus.learningObjectiveId)
        );
      }
      return filtered.map(question => hydrate(question, links, sources));
    },
    updateQuestion(id, input = {}) {
      const current = requireQuestion(id);
      const dto = buildUpdateQuestionDto(input);
      const objectiveIds =
        dto.learningObjectiveIds ??
        questionObjectiveRepository.listByQuestionIds([id]).map(link => link.learningObjectiveId);
      const sources = dto.sources === undefined ? undefined : resolveSources(dto.sources);
      requireObjectives(objectiveIds);
      if (sources) assertSourceIdsAvailable(sources, id);
      const changed = Object.keys(dto).length > 0;
      const next = new Question({
        ...current,
        ...dto,
        version: changed ? current.version + 1 : current.version,
        reviewStatus: current.reviewStatus === 'confirmed' && changed ? 'candidate' : current.reviewStatus,
        updatedAt: now()
      });
      return runTransaction(() => {
        repository.save(next);
        replaceRelations(id, objectiveIds, sources);
        return hydrate(next);
      });
    },
    validateQuestion,
    submitForReview(id) {
      return validateQuestion(id);
    },
    confirmQuestion(id) {
      const current = requireQuestion(id);
      assertReady(current, { forConfirmation: true });
      return repository.save(new Question({ ...current, reviewStatus: 'confirmed', updatedAt: now() }));
    },
    archiveQuestion(id) {
      return repository.save(new Question({ ...requireQuestion(id), reviewStatus: 'archived', updatedAt: now() }));
    },
    restoreQuestion(id) {
      const current = requireQuestion(id, { includeArchived: true });
      if (current.reviewStatus !== 'archived') return current;
      return repository.save(new Question({ ...current, reviewStatus: 'draft', updatedAt: now() }));
    },
    markSourceStale(sourceType, sourceId) {
      return markSourcesStale(sourceType, [sourceId]);
    },
    markSourcesStale,
    invalidateByObjectiveId(learningObjectiveId) {
      return runTransaction(() => {
        const changedSources = questionSourceRepository.markBySourceIds(
          'learningObjective',
          [learningObjectiveId],
          'stale'
        );
        const links = questionObjectiveRepository.listByObjectiveId(learningObjectiveId);
        const questions = downgradeConfirmedQuestions([
          ...changedSources.map(source => source.questionId),
          ...links.map(link => link.questionId)
        ]);
        return { sources: changedSources, questions };
      });
    }
  };
}
