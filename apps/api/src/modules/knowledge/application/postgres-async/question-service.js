import { sameKnowraText } from '@study-accelerator/shared/knowra-marks';
import { Question } from '../../domain/question.ts';
import { QuestionSource } from '../../domain/question-source.ts';
import { buildCreateQuestionDto, buildUpdateQuestionDto } from '../dto/assessment.dto.ts';
import { assertQuestionConfirmable, deriveQuestionSourceStatus } from '../formal-asset-validation.ts';
import { conflictError, notFoundError, validationError } from '../knowledge-errors.js';

const now = () => new Date().toISOString();
const supportedSourceTypes = new Set([
  'manual',
  'knowledgeItem',
  'learningObjective',
  'noteVersion',
  'knowledgeEvidence'
]);

/** @param {import('./service-dependencies.ts').QuestionDependencies} dependencies */
export function createAsyncQuestionService({
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
    throw new TypeError('Async Question repositories are required');

  async function requireQuestion(id, { includeArchived = false } = {}) {
    const question = await repository.findById(id);
    if (!question || question.deletedAt || (!includeArchived && question.reviewStatus === 'archived'))
      throw notFoundError('QUESTION_NOT_FOUND', 'Question not found');
    return question;
  }
  async function assertQuestionIdAvailable(id) {
    if (await getTombstone?.('questions', id)) throw conflictError('QUESTION_ID_DELETED', '已清理的题目 ID 不能复用');
    if (await repository.findById(id)) {
      throw conflictError('QUESTION_ID_CONFLICT', 'A Question with the same id already exists');
    }
  }
  async function requireObjectives(ids, { confirmed = false } = {}) {
    return Promise.all(
      [...new Set(ids)].map(async id => {
        const objective = await learningObjectiveRepository.findById(id);
        if (!objective || objective.deletedAt || objective.reviewStatus === 'archived')
          throw notFoundError('LEARNING_OBJECTIVE_NOT_FOUND', 'LearningObjective not found');
        if (confirmed && objective.reviewStatus !== 'confirmed')
          throw validationError('LEARNING_OBJECTIVE_NOT_CONFIRMED', 'Question requires confirmed LearningObjectives');
        return objective;
      })
    );
  }
  async function resolveSourceReference(source, { preserveStale = false } = {}) {
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
    let reference = await repositories[source.sourceType]?.findById(source.sourceId);
    if (!reference || reference.deletedAt)
      throw notFoundError('QUESTION_SOURCE_NOT_FOUND', 'QuestionSource reference not found');
    if (source.sourceType === 'noteVersion' && noteRepository) {
      const note = await noteRepository.findById(reference.noteId);
      reference = {
        ...reference,
        isCurrent: Boolean(note && !note.deleted && sameKnowraText(note.rawMarkdown, reference.content))
      };
    }
    return {
      ...source,
      status: preserveStale && source.status === 'stale' ? 'stale' : deriveQuestionSourceStatus(source, reference)
    };
  }
  /**
   * @overload
   * @param {import('../../infrastructure/assessment-repository.ts').QuestionSourceRecord[]} sources
   * @param {{preserveStale?: boolean}} [options]
   * @returns {Promise<Awaited<ReturnType<typeof resolveSourceReference>>[]>}
   */
  /** @overload @param {unknown} sources @param {{preserveStale?: boolean}} [options] @returns {Promise<unknown[]>} */
  /** @param {unknown} sources @param {{preserveStale?: boolean}} [options] */
  function resolveSources(sources = [], options = {}) {
    return Promise.all(
      /** @type {Iterable<unknown>} */ (
        /** @type {{map(callback: (source: unknown) => Promise<object>): unknown}} */ (sources).map(source =>
          resolveSourceReference(source, options)
        )
      )
    );
  }
  async function assertSourceIdsAvailable(sources, questionId) {
    const sourceIds = new Set();
    for (const source of sources) {
      if (sourceIds.has(source.id)) {
        throw conflictError('QUESTION_SOURCE_ID_CONFLICT', 'QuestionSource ids must be unique');
      }
      sourceIds.add(source.id);
      const existing = await questionSourceRepository.findById(source.id);
      if (!existing && (await getTombstone?.('questionSources', source.id)))
        throw conflictError('QUESTION_SOURCE_ID_DELETED', '已清理的题目来源 ID 不能复用');
      if (existing && existing.questionId !== questionId) {
        throw conflictError('QUESTION_SOURCE_ID_CONFLICT', 'A QuestionSource with the same id already exists');
      }
    }
  }
  async function hydrate(question, links = null, sources = null) {
    const [resolvedLinks, resolvedSources] = await Promise.all([
      links ?? questionObjectiveRepository.listByQuestionIds([question.id]),
      sources ?? questionSourceRepository.listByQuestionIds([question.id])
    ]);
    return {
      ...question,
      learningObjectiveIds: resolvedLinks
        .filter(link => link.questionId === question.id)
        .sort((a, b) => a.order - b.order)
        .map(link => link.learningObjectiveId),
      sources: resolvedSources.filter(source => source.questionId === question.id)
    };
  }
  async function assertReady(question, { forConfirmation = false } = {}) {
    const links = await questionObjectiveRepository.listByQuestionIds([question.id]);
    const [objectives, persistedSources] = await Promise.all([
      requireObjectives(links.map(link => link.learningObjectiveId)),
      questionSourceRepository.listByQuestionIds([question.id])
    ]);
    const sources = await resolveSources(
      /** @type {import('../../infrastructure/assessment-repository.ts').QuestionSourceRecord[]} */ (persistedSources),
      { preserveStale: true }
    );
    if (sources.some((source, index) => source.status !== persistedSources[index]?.status)) {
      await questionSourceRepository.replaceForQuestion(
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
  async function validateQuestion(id) {
    const current = await requireQuestion(id);
    await assertReady(current);
    const next =
      current.reviewStatus === 'confirmed'
        ? current
        : new Question({ ...current, reviewStatus: 'candidate', updatedAt: now() });
    if (next !== current) await repository.save(next);
    return hydrate(next);
  }
  async function replaceRelations(questionId, objectiveIds, sources, repositories = {}) {
    const linkRepository = repositories.questionObjectiveRepository ?? questionObjectiveRepository;
    const sourceRepository = repositories.questionSourceRepository ?? questionSourceRepository;
    await linkRepository.replaceForQuestion(questionId, objectiveIds);
    if (sources !== undefined) {
      await assertSourceIdsAvailable(sources, questionId);
      await sourceRepository.replaceForQuestion(
        questionId,
        sources.map(
          source =>
            new QuestionSource({ ...source, questionId, createdAt: source.createdAt ?? now(), updatedAt: now() })
        )
      );
    }
  }
  /**
   * @template {import('../../domain/question.ts').Question<unknown, unknown, unknown, unknown>} Record
   * @template Result
   * @param {import('../service-dependencies.ts').AssessmentWritePort<NoInfer<Record>, Result>} targetRepository
   * @param {Record} question
   */
  async function saveNew(targetRepository, question) {
    return targetRepository.create ? targetRepository.create(question) : targetRepository.save(question);
  }
  async function downgradeConfirmedQuestions(questionIds) {
    const changed = [];
    for (const questionId of new Set(questionIds)) {
      const current = await repository.findById(questionId);
      if (!current || current.reviewStatus !== 'confirmed') continue;
      const next = await repository.save(
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
  async function markSourcesStale(sourceType, sourceIds = []) {
    const changedSources = await questionSourceRepository.markBySourceIds(sourceType, sourceIds, 'stale');
    await downgradeConfirmedQuestions(changedSources.map(source => source.questionId));
    return changedSources;
  }

  return {
    async createQuestion(input = {}) {
      const dto = buildCreateQuestionDto(input);
      await assertQuestionIdAvailable(dto.id);
      await requireObjectives(dto.learningObjectiveIds);
      const sources = await resolveSources(dto.sources);
      await assertSourceIdsAvailable(sources, dto.id);
      const question = new Question(dto);
      const saved = await runTransaction(async (repositories = {}) => {
        const questionRepository = repositories.questionRepository ?? repository;
        await saveNew(questionRepository, question);
        await replaceRelations(question.id, dto.learningObjectiveIds, sources, repositories);
        return question;
      });
      return hydrate(saved);
    },
    getQuestion: id => requireQuestion(id, { includeArchived: true }).then(question => hydrate(question)),
    async listQuestions(options = {}) {
      const questions = await repository.list(options);
      const ids = questions.map(question => question.id);
      const [links, sources] = await Promise.all([
        questionObjectiveRepository.listByQuestionIds(ids),
        questionSourceRepository.listByQuestionIds(ids)
      ]);
      let filtered = questions;
      if (options.learningObjectiveId)
        filtered = filtered.filter(question =>
          links.some(
            link => link.questionId === question.id && link.learningObjectiveId === options.learningObjectiveId
          )
        );
      if (options.examFocusId) {
        const focus = await examFocusRepository?.findById(options.examFocusId);
        if (!focus) throw notFoundError('EXAM_FOCUS_NOT_FOUND', 'ExamFocus not found');
        filtered = filtered.filter(question =>
          links.some(link => link.questionId === question.id && link.learningObjectiveId === focus.learningObjectiveId)
        );
      }
      return Promise.all(filtered.map(question => hydrate(question, links, sources)));
    },
    async updateQuestion(id, input = {}) {
      const current = await requireQuestion(id);
      const dto = buildUpdateQuestionDto(input);
      const existingLinks = await questionObjectiveRepository.listByQuestionIds([id]);
      const objectiveIds = dto.learningObjectiveIds ?? existingLinks.map(link => link.learningObjectiveId);
      await requireObjectives(objectiveIds);
      const sources = dto.sources === undefined ? undefined : await resolveSources(dto.sources);
      if (sources) await assertSourceIdsAvailable(sources, id);
      const changed = Object.keys(dto).length > 0;
      const next = new Question({
        ...current,
        ...dto,
        version: changed ? current.version + 1 : current.version,
        reviewStatus: current.reviewStatus === 'confirmed' && changed ? 'candidate' : current.reviewStatus,
        updatedAt: now()
      });
      const saved = await runTransaction(async (repositories = {}) => {
        const questionRepository = repositories.questionRepository ?? repository;
        await questionRepository.save(next);
        await replaceRelations(id, objectiveIds, sources, repositories);
        return next;
      });
      return hydrate(saved);
    },
    validateQuestion,
    submitForReview(id) {
      return validateQuestion(id);
    },
    async confirmQuestion(id) {
      const current = await requireQuestion(id);
      await assertReady(current, { forConfirmation: true });
      return repository.save(new Question({ ...current, reviewStatus: 'confirmed', updatedAt: now() }));
    },
    async archiveQuestion(id) {
      return repository.save(
        new Question({ ...(await requireQuestion(id)), reviewStatus: 'archived', updatedAt: now() })
      );
    },
    async restoreQuestion(id) {
      const current = await requireQuestion(id, { includeArchived: true });
      return current.reviewStatus !== 'archived'
        ? current
        : repository.save(new Question({ ...current, reviewStatus: 'draft', updatedAt: now() }));
    },
    markSourceStale(sourceType, sourceId) {
      return markSourcesStale(sourceType, [sourceId]);
    },
    markSourcesStale,
    async invalidateByObjectiveId(learningObjectiveId) {
      const [changedSources, links] = await Promise.all([
        questionSourceRepository.markBySourceIds('learningObjective', [learningObjectiveId], 'stale'),
        questionObjectiveRepository.listByObjectiveId(learningObjectiveId)
      ]);
      const questions = await downgradeConfirmedQuestions([
        ...changedSources.map(source => source.questionId),
        ...links.map(link => link.questionId)
      ]);
      return { sources: changedSources, questions };
    }
  };
}
