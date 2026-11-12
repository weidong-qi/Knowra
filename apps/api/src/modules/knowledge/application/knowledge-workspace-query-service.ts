import { toKnowledgeItemWorkspaceDto, toLearningObjectiveWorkspaceDto } from './workspace-query-dto.ts';
import {
  countBy,
  matchesText,
  paginateWorkspaceItems,
  parseWorkspaceQuery,
  summarizeEvidenceStatus
} from './workspace-query-utils.ts';

import type {
  KnowledgeItemWorkspaceDto,
  WorkspaceKnowledgeItemRecord,
  WorkspaceLearningObjectiveRecord,
  WorkspaceQuestionRecord,
  WorkspaceEvidenceRecord,
  WorkspaceKnowledgeSummaryRecord,
  LearningObjectiveWorkspaceDto,
  WorkspaceProjectionLookup,
  WorkspaceProjectionMap,
  WorkspaceProjectionFilter
} from './workspace-query-dto.ts';
import type {
  WorkspaceQueryInput,
  WorkspaceRecord,
  WorkspaceReduce,
  WorkspaceCounts,
  WorkspaceStatusRecord,
  WorkspaceStatusRecords
} from './workspace-query-utils.ts';

/** 快照只声明原实现读取的字段；自定义 map/reduce 索引与集合没有通过验证。 */
export interface KnowledgeWorkspaceSnapshot {
  knowledgeItems: unknown;
  objectives: unknown;
  evidence: unknown;
  indexes: {
    noteById: unknown;
    evidenceByItem: unknown;
    objectivesByItem: unknown;
    questionsByObjective: unknown;
  };
}
export interface KnowledgeWorkspaceSnapshotReader {
  load: () => KnowledgeWorkspaceSnapshot | PromiseLike<KnowledgeWorkspaceSnapshot>;
}
export interface KnowledgeWorkspaceQueryOptions {
  snapshotReader?: KnowledgeWorkspaceSnapshotReader | null;
}

/** 分页原生展开创建数组，但上游自定义 filter/map 可以替换 DTO，元素仍是 unknown。 */
export interface KnowledgeWorkspacePage {
  items: unknown[];
  pagination: ReturnType<typeof paginateWorkspaceItems>['pagination'];
}

type KnowledgeRecord = WorkspaceKnowledgeItemRecord & { deletedAt?: unknown };
type Query = ReturnType<typeof parseWorkspaceQuery>;
// 这些视图仅在原操作处允许属性/方法调用，不验证数据或宣称自定义方法返回数组。
// 严格函数属性保留回调方差；每个未知返回值只在下一次原操作时再次提供最小视图。
type NativeFilter<Record> = { filter: (predicate: (record: Record) => boolean) => unknown };
type NativeMap<Record> = { map: (project: (record: Record) => unknown) => unknown };
type NativeSort<Record> = { sort: (compare: (left: Record, right: Record) => number) => unknown };
type NativeSlice = { slice: (start: number, end: number) => unknown };
type NativeForEach = { forEach: (visit: (value: unknown) => void) => unknown };
type NativeLookup = { get: (key: unknown) => unknown };
type NativeLength = { length?: unknown };
type NativeMapConstructor = new (entries: unknown) => Map<unknown, unknown>;
type NativeDateConstructor = new (value: unknown) => Date;

export function createKnowledgeWorkspaceQuery({ snapshotReader }: KnowledgeWorkspaceQueryOptions = {}) {
  if (!snapshotReader?.load) throw new TypeError('Knowledge workspace snapshot reader is required');

  return {
    listKnowledgeItems,
    listLearningObjectives,
    getKnowledgeOverview
  };

  async function listKnowledgeItems(input: WorkspaceQueryInput = {}): Promise<KnowledgeWorkspacePage> {
    const query = parseWorkspaceQuery(input);
    const snapshot = await snapshotReader!.load();
    const items = (
      (
        (
          (snapshot.knowledgeItems as NativeFilter<KnowledgeRecord>).filter(
            item => !item.deletedAt
          ) as NativeFilter<KnowledgeRecord>
        ).filter(item => query.includeArchived || item.reviewStatus !== 'archived') as NativeMap<KnowledgeRecord>
      ).map(item => buildKnowledgeItemDto(snapshot, item)) as NativeFilter<KnowledgeItemWorkspaceDto>
    ).filter(item => matchesKnowledgeItem(item, query));
    return paginateWorkspaceItems(items as Iterable<WorkspaceRecord>, query);
  }

  async function listLearningObjectives(input: WorkspaceQueryInput = {}): Promise<KnowledgeWorkspacePage> {
    const query = parseWorkspaceQuery(input);
    const snapshot = await snapshotReader!.load();
    const getKnowledgeItemSummary = createKnowledgeItemSummaryReader(snapshot);
    const objectives = (
      (
        (snapshot.objectives as NativeFilter<WorkspaceLearningObjectiveRecord>).filter(
          objective => query.includeArchived || objective.reviewStatus !== 'archived'
        ) as NativeMap<WorkspaceLearningObjectiveRecord>
      ).map(objective =>
        toLearningObjectiveWorkspaceDto(objective, {
          knowledgeItem: getKnowledgeItemSummary(objective.knowledgeItemId),
          questions: activeQuestions(
            (snapshot.indexes.questionsByObjective as NativeLookup).get(objective.id) ?? [],
            query.includeArchived
          ) as WorkspaceProjectionMap<{ id?: unknown }>
        })
      ) as NativeFilter<LearningObjectiveWorkspaceDto>
    ).filter(objective => matchesObjective(objective, query));
    return paginateWorkspaceItems(objectives as Iterable<WorkspaceRecord>, query);
  }

  async function getKnowledgeOverview() {
    const snapshot = await snapshotReader!.load();
    const items = (snapshot.knowledgeItems as NativeFilter<KnowledgeRecord>).filter(item => !item.deletedAt);
    const itemDtos = (items as NativeMap<KnowledgeRecord>).map(item => buildKnowledgeItemDto(snapshot, item));
    const objectives = (snapshot.objectives as NativeFilter<WorkspaceLearningObjectiveRecord>).filter(
      objective => objective.reviewStatus !== 'archived'
    );
    return {
      generatedAt: new Date().toISOString(),
      knowledgeItems: {
        total: (itemDtos as NativeLength).length,
        byReviewStatus: countBy(
          itemDtos as WorkspaceReduce<KnowledgeItemWorkspaceDto, WorkspaceCounts, unknown>,
          item => item.reviewStatus
        ),
        byKnowledgeType: countBy(
          itemDtos as WorkspaceReduce<KnowledgeItemWorkspaceDto, WorkspaceCounts, unknown>,
          item => item.knowledgeType
        )
      },
      evidence: {
        byStatus: countBy(
          snapshot.evidence as WorkspaceReduce<WorkspaceStatusRecord, WorkspaceCounts, unknown>,
          record => record.status
        ),
        byHealth: countBy(
          itemDtos as WorkspaceReduce<KnowledgeItemWorkspaceDto, WorkspaceCounts, unknown>,
          item => item.evidenceStatus
        )
      },
      learningObjectives: {
        total: (objectives as NativeLength).length,
        byReviewStatus: countBy(
          objectives as WorkspaceReduce<WorkspaceLearningObjectiveRecord, WorkspaceCounts, unknown>,
          objective => objective.reviewStatus
        ),
        withoutConfirmedObjective: (
          (itemDtos as NativeFilter<KnowledgeItemWorkspaceDto>).filter(
            item => item.confirmedObjectiveCount === 0
          ) as NativeLength
        ).length
      },
      coverage: {
        itemsWithoutConfirmedObjective: (
          (itemDtos as NativeFilter<KnowledgeItemWorkspaceDto>).filter(
            item => item.confirmedObjectiveCount === 0
          ) as NativeLength
        ).length,
        itemsWithoutQuestions: (
          (itemDtos as NativeFilter<KnowledgeItemWorkspaceDto>).filter(item => item.questionCount === 0) as NativeLength
        ).length
      },
      recentItems: (
        ((itemDtos as NativeSort<WorkspaceRecord>).sort(compareUpdatedDesc) as NativeSlice).slice(
          0,
          5
        ) as NativeMap<KnowledgeItemWorkspaceDto>
      ).map(item => ({
        id: item.id,
        title: item.title,
        reviewStatus: item.reviewStatus,
        evidenceStatus: item.evidenceStatus,
        updatedAt: item.updatedAt
      }))
    };
  }
}

// 目标 DTO 只需要四个知识字段；不为它构造证据明细或其他目标的题目聚合。
function createKnowledgeItemSummaryReader(snapshot: KnowledgeWorkspaceSnapshot) {
  const itemById = new (Map as NativeMapConstructor)(
    (snapshot.knowledgeItems as NativeMap<KnowledgeRecord>).map(item => [item.id, item])
  );
  const summaries = new Map<unknown, WorkspaceKnowledgeSummaryRecord | null>();
  return (id: unknown) => {
    if (summaries.has(id)) return summaries.get(id)!;
    const item = itemById.get(id) as KnowledgeRecord | null | undefined;
    const summary = item
      ? {
          id: item.id,
          title: item.title,
          reviewStatus: item.reviewStatus,
          evidenceStatus: summarizeEvidenceStatus(
            ((snapshot.indexes.evidenceByItem as NativeLookup).get(item.id) ?? []) as WorkspaceStatusRecords
          )
        }
      : null;
    summaries.set(id, summary);
    return summary;
  };
}

function buildKnowledgeItemDto(snapshot: KnowledgeWorkspaceSnapshot, item: KnowledgeRecord) {
  const evidence = ((snapshot.indexes.evidenceByItem as NativeLookup).get(item.id) ??
    []) as WorkspaceProjectionMap<WorkspaceEvidenceRecord>;
  const objectives = (snapshot.indexes.objectivesByItem as NativeLookup).get(item.id) ?? [];
  const questions = questionsForItem(snapshot, item.id, true);
  return toKnowledgeItemWorkspaceDto(item, {
    evidence,
    objectives: (objectives as NativeFilter<WorkspaceLearningObjectiveRecord>).filter(
      objective => objective.reviewStatus !== 'archived'
    ) as WorkspaceProjectionFilter<{ reviewStatus?: unknown }>,
    questions,
    noteById: snapshot.indexes.noteById as WorkspaceProjectionLookup
  });
}

function questionsForItem(snapshot: KnowledgeWorkspaceSnapshot, knowledgeItemId: unknown, includeArchived: boolean) {
  const objectiveIds = (
    (
      ((snapshot.indexes.objectivesByItem as NativeLookup).get(knowledgeItemId) ??
        []) as NativeFilter<WorkspaceLearningObjectiveRecord>
    ).filter(
      objective => includeArchived || objective.reviewStatus !== 'archived'
    ) as NativeMap<WorkspaceLearningObjectiveRecord>
  ).map(objective => objective.id);
  const questions = new Map<unknown, WorkspaceQuestionRecord>();
  (objectiveIds as NativeForEach).forEach(objectiveId => {
    for (const question of ((snapshot.indexes.questionsByObjective as NativeLookup).get(objectiveId) ??
      []) as Iterable<WorkspaceQuestionRecord>) {
      if (includeArchived || question.reviewStatus !== 'archived') questions.set(question.id, question);
    }
  });
  return [...questions.values()];
}

function matchesKnowledgeItem(item: KnowledgeItemWorkspaceDto, query: Query) {
  if (query.reviewStatus && item.reviewStatus !== query.reviewStatus) return false;
  if (query.knowledgeType && item.knowledgeType !== query.knowledgeType) return false;
  if (query.evidenceStatus && item.evidenceStatus !== query.evidenceStatus) return false;
  if (query.missingObjectives && (item.confirmedObjectiveCount as number) > 0) return false;
  if (query.missingQuestions && (item.questionCount as number) > 0) return false;
  return matchesText([item.title, item.canonicalStatement, item.userExplanation], query.query);
}

function matchesObjective(objective: LearningObjectiveWorkspaceDto, query: Query) {
  if (query.reviewStatus && objective.reviewStatus !== query.reviewStatus) return false;
  if (query.actionVerb && objective.actionVerb !== query.actionVerb) return false;
  if (query.cognitiveLevel && objective.cognitiveLevel !== query.cognitiveLevel) return false;
  if (query.knowledgeItemId && objective.knowledgeItemId !== query.knowledgeItemId) return false;
  if (query.hasQuestions !== null && (objective.questionCount as number) > 0 !== query.hasQuestions) return false;
  return matchesText(
    [
      objective.objective,
      objective.knowledgeItem?.title,
      (objective.knowledgeItem as (WorkspaceKnowledgeSummaryRecord & { canonicalStatement?: unknown }) | null)
        ?.canonicalStatement
    ],
    query.query
  );
}

function activeQuestions(questions: unknown, includeArchived: boolean) {
  return (questions as NativeFilter<WorkspaceQuestionRecord>).filter(
    question => includeArchived || question.reviewStatus !== 'archived'
  );
}

function compareUpdatedDesc(left: WorkspaceRecord, right: WorkspaceRecord) {
  return (
    new (Date as NativeDateConstructor)(right.updatedAt).getTime() -
      new (Date as NativeDateConstructor)(left.updatedAt).getTime() || String(left.id).localeCompare(String(right.id))
  );
}
