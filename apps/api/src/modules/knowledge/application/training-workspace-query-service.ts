import { toExamProfileWorkspaceDto, toQuestionWorkspaceDto } from './workspace-query-dto.ts';
import { countBy, matchesText, paginateWorkspaceItems, parseWorkspaceQuery } from './workspace-query-utils.ts';

import type {
  WorkspaceQuestionRecord,
  WorkspaceExamProfileRecord,
  WorkspaceExamFocusRecord,
  WorkspaceLearningObjectiveRecord,
  WorkspaceKnowledgeItemRecord,
  WorkspaceEvidenceRecord,
  WorkspaceObjectiveLinkRecord,
  WorkspaceObjectiveLinks,
  WorkspaceQuestionSourceRecord,
  WorkspaceProjectionMap,
  WorkspaceProjectionFilter
} from './workspace-query-dto.ts';
import type {
  WorkspaceQueryInput,
  WorkspaceRecord,
  WorkspaceReduce,
  WorkspaceCounts
} from './workspace-query-utils.ts';

/** 仅声明原服务读取的快照字段；自定义集合、索引及历史记录没有通过验证。 */
export interface TrainingWorkspaceSnapshot {
  questions: unknown;
  profiles: unknown;
  objectives: unknown;
  knowledgeItems: unknown;
  noteVersions: unknown;
  evidence: unknown;
  indexes: {
    focusByProfile: unknown;
    linksByQuestion: unknown;
    sourcesByQuestion: unknown;
    noteById: unknown;
  };
}
export interface TrainingWorkspaceSnapshotReader {
  load: () => TrainingWorkspaceSnapshot | PromiseLike<TrainingWorkspaceSnapshot>;
}
export interface TrainingWorkspaceQueryOptions {
  snapshotReader?: TrainingWorkspaceSnapshotReader | null;
}
/** 分页原生展开会创建数组，但自定义 filter/map 不保证返回回调生成的 DTO。 */
export interface TrainingWorkspacePage {
  items: unknown[];
  pagination: ReturnType<typeof paginateWorkspaceItems>['pagination'];
}

// 视图只用于原操作点；每步自定义方法返回 unknown，不验证数据或收窄公开输出。
// 函数属性保留严格回调方差，不把快照整体断言为数组或 Map。
type NativeFilter<Record> = { filter: (predicate: (record: Record) => boolean) => unknown };
type NativeMap<Record> = { map: (project: (record: Record) => unknown) => unknown };
type NativeForEach<Record> = { forEach: (visit: (record: Record) => unknown) => unknown };
type NativeSort<Record> = { sort: (compare: (left: Record, right: Record) => number) => unknown };
type NativeSlice = { slice: (start: number, end: number) => unknown };
type NativeLookup = { get: (key: unknown) => unknown };
type NativeLength = { length?: unknown };
type NativeIncludes = { includes: (value: unknown) => boolean };
type NativeMapConstructor = new (entries: unknown) => Map<unknown, unknown>;
type NativeDateConstructor = new (value: unknown) => Date;
type Query = ReturnType<typeof parseWorkspaceQuery>;
type QuestionProjection = WorkspaceQuestionRecord & {
  sourceStatus?: unknown;
  learningObjectiveIds?: unknown;
  primaryObjective?: unknown;
  sources?: unknown;
};
type QuestionContext = {
  objectiveById: Map<unknown, unknown>;
  itemById: Map<unknown, unknown>;
  sourceLabels: Map<string, unknown>;
};

export function createTrainingWorkspaceQuery({ snapshotReader }: TrainingWorkspaceQueryOptions = {}) {
  if (!snapshotReader?.load) throw new TypeError('Training workspace snapshot reader is required');

  return {
    listQuestions,
    listExamProfiles,
    getTrainingOverview
  };

  async function listQuestions(input: WorkspaceQueryInput = {}): Promise<TrainingWorkspacePage> {
    const query = parseWorkspaceQuery(input);
    const snapshot = await snapshotReader!.load();
    const context = buildQuestionContext(snapshot);
    const questions = (
      (
        (snapshot.questions as NativeFilter<WorkspaceQuestionRecord>).filter(
          question => query.includeArchived || question.reviewStatus !== 'archived'
        ) as NativeMap<WorkspaceQuestionRecord>
      ).map(question => buildQuestionDto(snapshot, question, context)) as NativeFilter<QuestionProjection>
    ).filter(question => matchesQuestion(question, query));
    return paginateWorkspaceItems(questions as Iterable<WorkspaceRecord>, query);
  }

  async function listExamProfiles(input: WorkspaceQueryInput = {}): Promise<TrainingWorkspacePage> {
    const query = parseWorkspaceQuery(input);
    const snapshot = await snapshotReader!.load();
    const objectiveById = new (Map as NativeMapConstructor)(
      (snapshot.objectives as NativeMap<WorkspaceLearningObjectiveRecord>).map(objective => [objective.id, objective])
    );
    const profiles = (
      (
        (snapshot.profiles as NativeFilter<WorkspaceExamProfileRecord>).filter(
          profile => query.includeArchived || !profile.archivedAt
        ) as NativeMap<WorkspaceExamProfileRecord>
      ).map(profile =>
        toExamProfileWorkspaceDto(profile, {
          focuses: (
            ((snapshot.indexes.focusByProfile as NativeLookup).get(profile.id) ??
              []) as NativeFilter<WorkspaceExamFocusRecord>
          ).filter(
            focus => query.includeArchived || focus.reviewStatus !== 'archived'
          ) as WorkspaceProjectionMap<WorkspaceExamFocusRecord> & WorkspaceProjectionFilter<WorkspaceExamFocusRecord>,
          objectiveById
        })
      ) as NativeFilter<WorkspaceExamProfileRecord>
    ).filter(profile =>
      matchesText([profile.name, profile.description, ...(profile.scope as Iterable<unknown>)], query.query)
    );
    return paginateWorkspaceItems(profiles as Iterable<WorkspaceRecord>, query);
  }

  async function getTrainingOverview() {
    const snapshot = await snapshotReader!.load();
    const context = buildQuestionContext(snapshot);
    const questions = (
      (snapshot.questions as NativeFilter<WorkspaceQuestionRecord>).filter(
        question => question.reviewStatus !== 'archived'
      ) as NativeMap<WorkspaceQuestionRecord>
    ).map(question => buildQuestionDto(snapshot, question, context));
    const profiles = (snapshot.profiles as NativeFilter<WorkspaceExamProfileRecord>).filter(
      profile => !profile.archivedAt
    );
    return {
      generatedAt: new Date().toISOString(),
      questions: {
        total: (questions as NativeLength).length,
        byReviewStatus: countBy(
          questions as WorkspaceReduce<QuestionProjection, WorkspaceCounts, unknown>,
          question => question.reviewStatus
        ),
        byQuestionType: countBy(
          questions as WorkspaceReduce<QuestionProjection, WorkspaceCounts, unknown>,
          question => question.questionType
        ),
        byDifficulty: countBy(
          questions as WorkspaceReduce<QuestionProjection, WorkspaceCounts, unknown>,
          question => question.difficulty ?? 'unset'
        )
      },
      review: {
        pendingValidation: (
          (questions as NativeFilter<QuestionProjection>).filter(question =>
            (['draft', 'validating'] as NativeIncludes).includes(question.reviewStatus)
          ) as NativeLength
        ).length,
        pendingConfirmation: (
          (questions as NativeFilter<QuestionProjection>).filter(
            question => question.reviewStatus === 'candidate'
          ) as NativeLength
        ).length,
        staleSources: (
          (questions as NativeFilter<QuestionProjection>).filter(
            question => question.sourceStatus === 'stale'
          ) as NativeLength
        ).length,
        insufficientSources: (
          (questions as NativeFilter<QuestionProjection>).filter(
            question => question.sourceStatus === 'insufficient'
          ) as NativeLength
        ).length
      },
      examProfiles: {
        total: (profiles as NativeLength).length,
        updatedRecently: (
          ((profiles as NativeSort<WorkspaceRecord>).sort(compareUpdatedDesc) as NativeSlice).slice(
            0,
            5
          ) as NativeMap<WorkspaceExamProfileRecord>
        ).map(profile => ({ id: profile.id, name: profile.name, updatedAt: profile.updatedAt }))
      },
      recentQuestions: (
        ((questions as NativeSort<WorkspaceRecord>).sort(compareUpdatedDesc) as NativeSlice).slice(
          0,
          5
        ) as NativeMap<QuestionProjection>
      ).map(question => ({
        id: question.id,
        stem: question.stem,
        questionType: question.questionType,
        reviewStatus: question.reviewStatus,
        sourceStatus: question.sourceStatus,
        updatedAt: question.updatedAt
      }))
    };
  }
}

function buildQuestionContext(snapshot: TrainingWorkspaceSnapshot): QuestionContext {
  return {
    objectiveById: new (Map as NativeMapConstructor)(
      (snapshot.objectives as NativeMap<WorkspaceLearningObjectiveRecord>).map(objective => [objective.id, objective])
    ),
    itemById: new (Map as NativeMapConstructor)(
      (snapshot.knowledgeItems as NativeMap<WorkspaceKnowledgeItemRecord>).map(item => [item.id, item])
    ),
    sourceLabels: buildSourceLabels(snapshot)
  };
}

function buildQuestionDto(
  snapshot: TrainingWorkspaceSnapshot,
  question: WorkspaceQuestionRecord,
  { objectiveById, itemById, sourceLabels }: QuestionContext
) {
  const links = (
    ((snapshot.indexes.linksByQuestion as NativeLookup).get(question.id) ??
      []) as NativeMap<WorkspaceObjectiveLinkRecord>
  ).map(link => {
    const objective = objectiveById.get(link.learningObjectiveId) as
      WorkspaceLearningObjectiveRecord | null | undefined;
    const item = (objective ? itemById.get(objective.knowledgeItemId) : null) as
      WorkspaceKnowledgeItemRecord | null | undefined;
    return {
      ...link,
      objective: objective?.objective ?? '',
      actionVerb: objective?.actionVerb ?? '',
      cognitiveLevel: objective?.cognitiveLevel ?? '',
      reviewStatus: objective?.reviewStatus ?? null,
      knowledgeItemId: item?.id ?? objective?.knowledgeItemId ?? null,
      knowledgeItemTitle: item?.title ?? ''
    };
  });
  const sources = ((snapshot.indexes.sourcesByQuestion as NativeLookup).get(question.id) ??
    []) as WorkspaceProjectionMap<WorkspaceQuestionSourceRecord>;
  return toQuestionWorkspaceDto(question, {
    objectives: links as WorkspaceObjectiveLinks,
    sources,
    sourceLabels
  });
}

function matchesQuestion(question: QuestionProjection, query: Query) {
  if (query.questionType && question.questionType !== query.questionType) return false;
  if (query.reviewStatus && question.reviewStatus !== query.reviewStatus) return false;
  if (query.difficulty && question.difficulty !== query.difficulty) return false;
  if (
    query.learningObjectiveId &&
    !(question.learningObjectiveIds as NativeIncludes).includes(query.learningObjectiveId)
  )
    return false;
  if (query.evidenceStatus && question.sourceStatus !== query.evidenceStatus) return false;
  return matchesText(
    [
      question.stem,
      question.explanation,
      (question.primaryObjective as { objective?: unknown } | null | undefined)?.objective,
      ...((question.sources as NativeMap<{ quoteText?: unknown }>).map(source => source.quoteText) as Iterable<unknown>)
    ],
    query.query
  );
}

function buildSourceLabels(snapshot: TrainingWorkspaceSnapshot) {
  const labels = new Map<string, unknown>();
  (snapshot.knowledgeItems as NativeForEach<WorkspaceKnowledgeItemRecord>).forEach(item =>
    labels.set(`knowledgeItem:${item.id}`, item.title)
  );
  (snapshot.objectives as NativeForEach<WorkspaceLearningObjectiveRecord>).forEach(objective =>
    labels.set(`learningObjective:${objective.id}`, objective.objective)
  );
  (snapshot.noteVersions as NativeForEach<{ id?: unknown; noteId?: unknown }>).forEach(version =>
    labels.set(
      `noteVersion:${version.id}`,
      ((snapshot.indexes.noteById as NativeLookup).get(version.noteId) as { title?: unknown } | null | undefined)
        ?.title ?? '笔记版本'
    )
  );
  (snapshot.evidence as NativeForEach<WorkspaceEvidenceRecord>).forEach(evidence =>
    labels.set(`knowledgeEvidence:${evidence.id}`, evidence.quoteText || '知识证据')
  );
  return labels;
}

function compareUpdatedDesc(left: WorkspaceRecord, right: WorkspaceRecord) {
  return (
    new (Date as NativeDateConstructor)(right.updatedAt).getTime() -
      new (Date as NativeDateConstructor)(left.updatedAt).getTime() || String(left.id).localeCompare(String(right.id))
  );
}
