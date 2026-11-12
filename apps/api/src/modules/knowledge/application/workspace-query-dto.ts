import { summarizeEvidenceStatus, summarizeSourceStatus } from './workspace-query-utils.ts';

import type { WorkspaceStatusRecords } from './workspace-query-utils.ts';

/** 工作区仅投影字段；历史数据、动态 getter 和自定义集合没有通过领域验证。 */
export interface WorkspaceKnowledgeItemRecord {
  id?: unknown;
  title?: unknown;
  canonicalStatement?: unknown;
  userExplanation?: unknown;
  knowledgeType?: unknown;
  importance?: unknown;
  reviewStatus?: unknown;
  sourceMode?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WorkspaceLearningObjectiveRecord {
  id?: unknown;
  knowledgeItemId?: unknown;
  objective?: unknown;
  actionVerb?: unknown;
  cognitiveLevel?: unknown;
  difficultyHint?: unknown;
  reviewStatus?: unknown;
  reviewNote?: unknown;
  order?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WorkspaceQuestionRecord {
  id?: unknown;
  questionType?: unknown;
  stem?: unknown;
  options?: unknown;
  referenceAnswer?: unknown;
  rubric?: unknown;
  explanation?: unknown;
  difficulty?: unknown;
  reviewStatus?: unknown;
  sourceMode?: unknown;
  version?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WorkspaceExamProfileRecord {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  scope?: unknown;
  language?: unknown;
  commonQuestionTypes?: unknown;
  difficultyProfile?: unknown;
  archivedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WorkspaceExamFocusRecord {
  id?: unknown;
  examProfileId?: unknown;
  learningObjectiveId?: unknown;
  description?: unknown;
  priority?: unknown;
  difficultyHint?: unknown;
  questionTypeSuggestions?: unknown;
  sourceType?: unknown;
  reviewStatus?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WorkspaceEvidenceRecord {
  id?: unknown;
  sourceType?: unknown;
  sourceId?: unknown;
  noteId?: unknown;
  noteVersionId?: unknown;
  annotationId?: unknown;
  quoteText?: unknown;
  headingPath?: unknown;
  status?: unknown;
}

export interface WorkspaceQuestionSourceRecord {
  id?: unknown;
  sourceType?: unknown;
  sourceId?: unknown;
  quote?: unknown;
  locator?: unknown;
  contentHash?: unknown;
  status?: unknown;
}

export interface WorkspaceObjectiveLinkRecord {
  learningObjectiveId?: unknown;
  isPrimary?: unknown;
  order?: unknown;
  objective?: unknown;
  actionVerb?: unknown;
  cognitiveLevel?: unknown;
  reviewStatus?: unknown;
  knowledgeItemId?: unknown;
  knowledgeItemTitle?: unknown;
}

export interface WorkspaceKnowledgeSummaryRecord {
  id?: unknown;
  title?: unknown;
  reviewStatus?: unknown;
  evidenceStatus?: unknown;
}

/** map/filter 的返回值不保证是数组，length 也不保证是数字。 */
export interface WorkspaceProjectionMap<Record> {
  map: (project: (record: Record) => unknown) => unknown;
  length?: unknown;
}
export interface WorkspaceProjectionFilter<Record> {
  filter: (predicate: (record: Record) => boolean) => unknown;
  length?: unknown;
}
/** 只要求存在 get；具体键域可更窄，调用可能像原 JS 一样抛出。 */
export interface WorkspaceProjectionLookup {
  get: (key: never) => unknown;
}
export interface WorkspaceObjectiveLinks extends Iterable<WorkspaceObjectiveLinkRecord> {
  find: (predicate: (record: WorkspaceObjectiveLinkRecord) => unknown) => unknown;
  0?: unknown;
}
export interface KnowledgeItemWorkspaceOptions {
  evidence?: WorkspaceProjectionMap<WorkspaceEvidenceRecord>;
  objectives?: WorkspaceProjectionFilter<{ reviewStatus?: unknown }>;
  questions?: { length?: unknown };
  noteById?: WorkspaceProjectionLookup;
}
export interface LearningObjectiveWorkspaceOptions {
  knowledgeItem?: WorkspaceKnowledgeSummaryRecord | null;
  questions?: WorkspaceProjectionMap<{ id?: unknown }>;
}
export interface QuestionWorkspaceOptions {
  objectives?: WorkspaceObjectiveLinks;
  sources?: WorkspaceProjectionMap<WorkspaceQuestionSourceRecord>;
  sourceLabels?: WorkspaceProjectionLookup;
}
export interface ExamProfileWorkspaceOptions {
  focuses?: WorkspaceProjectionMap<WorkspaceExamFocusRecord> & WorkspaceProjectionFilter<WorkspaceExamFocusRecord>;
  objectiveById?: WorkspaceProjectionLookup;
}

type NativeGet = (key: unknown) => unknown;
type NativeFilteredValues = { filter: (predicate: typeof Boolean) => Iterable<unknown> | null | undefined };
type NativeLength = { length?: unknown };
// 以下视图只允许执行原生属性读取/方法调用，不验证数据，也不把公开结果收窄为字符串或数组。
// stateful map/get、Symbol/BigInt/对象减法、原型方法与迭代器仍可返回任意值或抛出原异常。

export interface KnowledgeItemWorkspaceDto<Record extends WorkspaceKnowledgeItemRecord = WorkspaceKnowledgeItemRecord> {
  id: Record['id'];
  title: Record['title'];
  canonicalStatement: Record['canonicalStatement'];
  userExplanation: Record['userExplanation'];
  knowledgeType: Record['knowledgeType'];
  importance: Record['importance'];
  reviewStatus: Record['reviewStatus'];
  sourceMode: Record['sourceMode'];
  createdAt: Record['createdAt'];
  updatedAt: Record['updatedAt'];
  evidenceStatus: ReturnType<typeof summarizeEvidenceStatus>;
  sourceHealth: ReturnType<typeof summarizeEvidenceStatus>;
  evidenceCount: unknown;
  evidenceSummary: unknown;
  objectiveCount: unknown;
  confirmedObjectiveCount: unknown;
  questionCount: unknown;
  noteIds: unknown[];
}

export interface LearningObjectiveWorkspaceDto<
  Record extends WorkspaceLearningObjectiveRecord = WorkspaceLearningObjectiveRecord
> {
  id: Record['id'];
  knowledgeItemId: Record['knowledgeItemId'];
  objective: Record['objective'];
  actionVerb: Record['actionVerb'];
  cognitiveLevel: Record['cognitiveLevel'];
  difficultyHint: Record['difficultyHint'];
  reviewStatus: Record['reviewStatus'];
  reviewNote: Record['reviewNote'];
  order: Record['order'];
  createdAt: Record['createdAt'];
  updatedAt: Record['updatedAt'];
  knowledgeItem: { id: unknown; title: unknown; reviewStatus: unknown; evidenceStatus: unknown } | null;
  questionCount: unknown;
  questionIds: unknown;
}

export interface QuestionWorkspaceDto<Record extends WorkspaceQuestionRecord = WorkspaceQuestionRecord> {
  id: Record['id'];
  questionType: Record['questionType'];
  stem: Record['stem'];
  options: Record['options'];
  referenceAnswer: Record['referenceAnswer'];
  rubric: Record['rubric'];
  explanation: Record['explanation'];
  difficulty: Record['difficulty'];
  reviewStatus: Record['reviewStatus'];
  sourceMode: Record['sourceMode'];
  version: Record['version'];
  createdAt: Record['createdAt'];
  updatedAt: Record['updatedAt'];
  sourceStatus: ReturnType<typeof summarizeSourceStatus>;
  sourceHealth: ReturnType<typeof summarizeSourceStatus>;
  learningObjectiveIds: unknown;
  objectives: unknown;
  primaryObjective: { id: unknown; objective: unknown; knowledgeItemId: unknown; knowledgeItemTitle: unknown } | null;
  sources: unknown;
}

export interface ExamProfileWorkspaceDto<Record extends WorkspaceExamProfileRecord = WorkspaceExamProfileRecord> {
  id: Record['id'];
  name: Record['name'];
  description: Record['description'];
  scope: Record['scope'];
  language: Record['language'];
  commonQuestionTypes: Record['commonQuestionTypes'];
  difficultyProfile: Record['difficultyProfile'];
  archivedAt: Record['archivedAt'];
  createdAt: Record['createdAt'];
  updatedAt: Record['updatedAt'];
  focusCount: unknown;
  confirmedFocusCount: unknown;
  focuses: unknown;
}

export interface ExamFocusSummary<Record extends WorkspaceExamFocusRecord = WorkspaceExamFocusRecord> {
  id: Record['id'];
  examProfileId: Record['examProfileId'];
  learningObjectiveId: Record['learningObjectiveId'];
  description: Record['description'];
  priority: Record['priority'];
  difficultyHint: Record['difficultyHint'];
  questionTypeSuggestions: Record['questionTypeSuggestions'];
  sourceType: Record['sourceType'];
  reviewStatus: Record['reviewStatus'];
  createdAt: Record['createdAt'];
  updatedAt: Record['updatedAt'];
  learningObjective: { id: unknown; objective: unknown; reviewStatus: unknown; knowledgeItemId: unknown } | null;
}

export function toKnowledgeItemWorkspaceDto<Item extends WorkspaceKnowledgeItemRecord = WorkspaceKnowledgeItemRecord>(
  item: Item,
  { evidence = [], objectives = [], questions = [], noteById = new Map() }: KnowledgeItemWorkspaceOptions = {}
): KnowledgeItemWorkspaceDto<Item> {
  const evidenceStatus = summarizeEvidenceStatus(evidence as WorkspaceStatusRecords);
  return {
    id: item.id,
    title: item.title,
    canonicalStatement: item.canonicalStatement,
    userExplanation: item.userExplanation,
    knowledgeType: item.knowledgeType,
    importance: item.importance,
    reviewStatus: item.reviewStatus,
    sourceMode: item.sourceMode,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    evidenceStatus,
    sourceHealth: evidenceStatus,
    evidenceCount: evidence.length,
    evidenceSummary: evidence.map(record => toEvidenceSummary(record, noteById)),
    objectiveCount: objectives.length,
    confirmedObjectiveCount: (objectives.filter(objective => objective.reviewStatus === 'confirmed') as NativeLength)
      .length,
    questionCount: questions.length,
    noteIds: [...new Set((evidence.map(record => record.noteId) as NativeFilteredValues).filter(Boolean))]
  };
}

export function toLearningObjectiveWorkspaceDto<
  Objective extends WorkspaceLearningObjectiveRecord = WorkspaceLearningObjectiveRecord
>(
  objective: Objective,
  { knowledgeItem = null, questions = [] }: LearningObjectiveWorkspaceOptions = {}
): LearningObjectiveWorkspaceDto<Objective> {
  return {
    id: objective.id,
    knowledgeItemId: objective.knowledgeItemId,
    objective: objective.objective,
    actionVerb: objective.actionVerb,
    cognitiveLevel: objective.cognitiveLevel,
    difficultyHint: objective.difficultyHint,
    reviewStatus: objective.reviewStatus,
    reviewNote: objective.reviewNote,
    order: objective.order,
    createdAt: objective.createdAt,
    updatedAt: objective.updatedAt,
    knowledgeItem: knowledgeItem
      ? {
          id: knowledgeItem.id,
          title: knowledgeItem.title,
          reviewStatus: knowledgeItem.reviewStatus,
          evidenceStatus: knowledgeItem.evidenceStatus
        }
      : null,
    questionCount: questions.length,
    questionIds: questions.map(question => question.id)
  };
}

export function toQuestionWorkspaceDto<Question extends WorkspaceQuestionRecord = WorkspaceQuestionRecord>(
  question: Question,
  { objectives = [], sources = [], sourceLabels = new Map() }: QuestionWorkspaceOptions = {}
): QuestionWorkspaceDto<Question> {
  const sourceStatus = summarizeSourceStatus(sources as WorkspaceStatusRecords);
  const primaryObjective = objectives.find(objective => objective.isPrimary) ?? objectives[0] ?? null;
  const orderedObjectives: WorkspaceProjectionMap<WorkspaceObjectiveLinkRecord> = [...objectives].sort(
    (left, right) => (left.order as number) - (right.order as number)
  );
  return {
    id: question.id,
    questionType: question.questionType,
    stem: question.stem,
    options: question.options,
    referenceAnswer: question.referenceAnswer,
    rubric: question.rubric,
    explanation: question.explanation,
    difficulty: question.difficulty,
    reviewStatus: question.reviewStatus,
    sourceMode: question.sourceMode,
    version: question.version,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
    sourceStatus,
    sourceHealth: sourceStatus,
    learningObjectiveIds: orderedObjectives.map(objective => objective.learningObjectiveId),
    objectives: orderedObjectives.map(link => ({
      id: link.learningObjectiveId,
      isPrimary: Boolean(link.isPrimary),
      order: link.order,
      objective: link.objective ?? '',
      actionVerb: link.actionVerb ?? '',
      cognitiveLevel: link.cognitiveLevel ?? '',
      reviewStatus: link.reviewStatus ?? null,
      knowledgeItemId: link.knowledgeItemId ?? null,
      knowledgeItemTitle: link.knowledgeItemTitle ?? ''
    })),
    primaryObjective: primaryObjective
      ? {
          id: (primaryObjective as WorkspaceObjectiveLinkRecord).learningObjectiveId,
          objective: (primaryObjective as WorkspaceObjectiveLinkRecord).objective ?? '',
          knowledgeItemId: (primaryObjective as WorkspaceObjectiveLinkRecord).knowledgeItemId ?? null,
          knowledgeItemTitle: (primaryObjective as WorkspaceObjectiveLinkRecord).knowledgeItemTitle ?? ''
        }
      : null,
    sources: sources.map(source => toQuestionSourceSummary(source, sourceLabels))
  };
}

export function toExamProfileWorkspaceDto<Profile extends WorkspaceExamProfileRecord = WorkspaceExamProfileRecord>(
  profile: Profile,
  { focuses = [], objectiveById = new Map() }: ExamProfileWorkspaceOptions = {}
): ExamProfileWorkspaceDto<Profile> {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    scope: profile.scope,
    language: profile.language,
    commonQuestionTypes: profile.commonQuestionTypes,
    difficultyProfile: profile.difficultyProfile,
    archivedAt: profile.archivedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    focusCount: focuses.length,
    confirmedFocusCount: (focuses.filter(focus => focus.reviewStatus === 'confirmed') as NativeLength).length,
    focuses: focuses.map(focus =>
      toExamFocusSummary(focus, (objectiveById.get as NativeGet)(focus.learningObjectiveId))
    )
  };
}

export function toExamFocusSummary<Focus extends WorkspaceExamFocusRecord = WorkspaceExamFocusRecord>(
  focus: Focus,
  objective: unknown = null
): ExamFocusSummary<Focus> {
  return {
    id: focus.id,
    examProfileId: focus.examProfileId,
    learningObjectiveId: focus.learningObjectiveId,
    description: focus.description,
    priority: focus.priority,
    difficultyHint: focus.difficultyHint,
    questionTypeSuggestions: focus.questionTypeSuggestions,
    sourceType: focus.sourceType,
    reviewStatus: focus.reviewStatus,
    createdAt: focus.createdAt,
    updatedAt: focus.updatedAt,
    learningObjective: objective
      ? {
          id: (objective as WorkspaceLearningObjectiveRecord).id,
          objective: (objective as WorkspaceLearningObjectiveRecord).objective,
          reviewStatus: (objective as WorkspaceLearningObjectiveRecord).reviewStatus,
          knowledgeItemId: (objective as WorkspaceLearningObjectiveRecord).knowledgeItemId
        }
      : null
  };
}

function toEvidenceSummary(record: WorkspaceEvidenceRecord, noteById: WorkspaceProjectionLookup) {
  const note = record.noteId ? (noteById.get as NativeGet)(record.noteId) : null;
  return {
    id: record.id,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    noteId: record.noteId,
    noteTitle: (note as { title?: unknown } | null | undefined)?.title ?? '',
    noteVersionId: record.noteVersionId,
    annotationId: record.annotationId,
    quoteText: record.quoteText,
    headingPath: record.headingPath,
    status: record.status
  };
}

function toQuestionSourceSummary(source: WorkspaceQuestionSourceRecord, sourceLabels: WorkspaceProjectionLookup) {
  return {
    id: source.id,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    quote: source.quote,
    quoteText: source.quote,
    locator: source.locator,
    contentHash: source.contentHash,
    status: source.status,
    label: (sourceLabels.get as NativeGet)(`${source.sourceType}:${source.sourceId ?? ''}`) ?? source.sourceType
  };
}
