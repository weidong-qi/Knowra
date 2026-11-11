import { matchesText, paginateWorkspaceItems, parseWorkspaceQuery } from './workspace-query-utils.ts';

import type {
  WorkspaceKnowledgeItemRecord,
  WorkspaceEvidenceRecord,
  WorkspaceLearningObjectiveRecord,
  WorkspaceQuestionRecord,
  WorkspaceQuestionSourceRecord
} from './workspace-query-dto.ts';
import type { WorkspaceQueryInput, WorkspaceRecord } from './workspace-query-utils.ts';

/** 仅声明原服务读取的字段存在；原始集合、动态索引和历史值不保证已验证。 */
export interface ReviewQueueSnapshot {
  knowledgeItems: unknown;
  evidence: unknown;
  objectives: unknown;
  questions: unknown;
  indexes: { linksByQuestion: unknown; sourcesByQuestion: unknown };
}
export interface ReviewQueueSnapshotReader {
  load: () => ReviewQueueSnapshot | PromiseLike<ReviewQueueSnapshot>;
}
export interface ReviewQueueQueryOptions {
  snapshotReader?: ReviewQueueSnapshotReader | null;
}
/** 原生展开保证数组，但自定义 map/flatMap 可替换回调结果，不能承诺完整 DTO。 */
export interface ReviewQueuePage {
  items: unknown[];
  pagination: ReturnType<typeof paginateWorkspaceItems>['pagination'];
}

// 仅在原操作点提供可擦除视图；自定义方法返回仍 unknown，不验证或预转换数据。
type NativeFilter<Record> = { filter: (predicate: (record: Record) => boolean) => unknown };
type NativeMap<Record> = { map: (project: (record: Record) => unknown) => unknown };
type NativeFlatMap<Record> = { flatMap: (project: (record: Record) => unknown) => unknown };
type NativeFind<Record> = { find: (predicate: (record: Record) => boolean) => unknown };
type NativeLookup = { get: (key: unknown) => unknown };
type NativeIncludes = { includes: (value: unknown) => boolean };
type NativeMapConstructor = new (entries: unknown) => Map<unknown, unknown>;
type NativeDateConstructor = new (value: unknown) => Date;
type KnowledgeItem = WorkspaceKnowledgeItemRecord & { deletedAt?: unknown };
type Evidence = WorkspaceEvidenceRecord & { knowledgeItemId?: unknown; updatedAt?: unknown };
type QueueEntry = WorkspaceRecord & {
  kind?: unknown;
  status?: unknown;
  title?: unknown;
  summary?: unknown;
  reason?: unknown;
};
type Query = ReturnType<typeof parseWorkspaceQuery>;

export function createReviewQueueQuery({ snapshotReader }: ReviewQueueQueryOptions = {}) {
  if (!snapshotReader?.load) throw new TypeError('Review queue snapshot reader is required');

  return { listReviewQueue };

  async function listReviewQueue(input: WorkspaceQueryInput = {}): Promise<ReviewQueuePage> {
    const query = parseWorkspaceQuery(input);
    const snapshot = await snapshotReader!.load();
    const itemById = new (Map as NativeMapConstructor)(
      (snapshot.knowledgeItems as NativeMap<KnowledgeItem>).map(item => [item.id, item])
    );
    const objectiveById = new (Map as NativeMapConstructor)(
      (snapshot.objectives as NativeMap<WorkspaceLearningObjectiveRecord>).map(objective => [objective.id, objective])
    );
    const queue = [
      ...(buildKnowledgeItemEntries(snapshot) as Iterable<QueueEntry>),
      ...(buildEvidenceEntries(snapshot, itemById) as Iterable<QueueEntry>),
      ...(buildObjectiveEntries(snapshot, itemById) as Iterable<QueueEntry>),
      ...(buildQuestionEntries(snapshot, objectiveById) as Iterable<QueueEntry>)
    ]
      .filter(entry => matchesQueueEntry(entry, query))
      .sort(compareUpdatedDesc);
    return paginateWorkspaceItems(queue, query);
  }
}

function buildKnowledgeItemEntries(snapshot: ReviewQueueSnapshot) {
  return (
    (snapshot.knowledgeItems as NativeFilter<KnowledgeItem>).filter(
      item => !item.deletedAt && (['candidate', 'needsRevision'] as NativeIncludes).includes(item.reviewStatus)
    ) as NativeMap<KnowledgeItem>
  ).map(item => ({
    kind: 'knowledgeItem',
    id: item.id,
    resourceType: 'knowledgeItem',
    resourceId: item.id,
    title: item.title || '未命名知识单元',
    summary: item.canonicalStatement,
    status: item.reviewStatus,
    reason: item.reviewStatus === 'candidate' ? '知识单元待确认' : '知识单元需要修订',
    updatedAt: item.updatedAt
  }));
}

function buildEvidenceEntries(snapshot: ReviewQueueSnapshot, itemById: Map<unknown, unknown>) {
  return (
    (snapshot.evidence as NativeFilter<Evidence>).filter(record =>
      (['stale', 'invalid', 'insufficient'] as NativeIncludes).includes(record.status)
    ) as NativeMap<Evidence>
  ).map(record => {
    const item = itemById.get(record.knowledgeItemId) as WorkspaceKnowledgeItemRecord | null | undefined;
    return {
      kind: 'knowledgeEvidence',
      id: record.id,
      resourceType: 'knowledgeItem',
      resourceId: record.knowledgeItemId,
      title: item?.title ?? '知识来源',
      summary: record.quoteText || '来源未提供引用文本',
      status: record.status,
      reason: `来源${evidenceStatusLabel(record.status)}`,
      updatedAt: record.updatedAt
    };
  });
}

function buildObjectiveEntries(snapshot: ReviewQueueSnapshot, itemById: Map<unknown, unknown>) {
  return (
    (snapshot.objectives as NativeFilter<WorkspaceLearningObjectiveRecord>).filter(
      objective => objective.reviewStatus === 'candidate'
    ) as NativeMap<WorkspaceLearningObjectiveRecord>
  ).map(objective => ({
    kind: 'learningObjective',
    id: objective.id,
    resourceType: 'learningObjective',
    resourceId: objective.id,
    title:
      (itemById.get(objective.knowledgeItemId) as WorkspaceKnowledgeItemRecord | null | undefined)?.title ?? '学习目标',
    summary: objective.objective || '目标内容尚未填写',
    status: objective.reviewStatus,
    reason: '学习目标待确认',
    updatedAt: objective.updatedAt
  }));
}

function buildQuestionEntries(snapshot: ReviewQueueSnapshot, objectiveById: Map<unknown, unknown>) {
  const { linksByQuestion, sourcesByQuestion } = snapshot.indexes;
  return (
    (snapshot.questions as NativeFilter<WorkspaceQuestionRecord>).filter(
      question => question.reviewStatus !== 'archived'
    ) as NativeFlatMap<WorkspaceQuestionRecord>
  ).flatMap(question => {
    const sources = (sourcesByQuestion as NativeLookup).get(question.id) ?? [];
    const staleSource = (sources as NativeFind<WorkspaceQuestionSourceRecord>).find(
      source => source.status === 'stale'
    );
    const missingSource = (sources as { length?: unknown }).length === 0;
    if (!staleSource && !missingSource && question.reviewStatus !== 'candidate') return [];
    const objective = objectiveById.get(
      (
        (linksByQuestion as NativeLookup).get(question.id) as
          { 0?: { learningObjectiveId?: unknown } | null } | null | undefined
      )?.[0]?.learningObjectiveId
    ) as WorkspaceLearningObjectiveRecord | null | undefined;
    const reason = staleSource ? '题目来源待复核' : missingSource ? '题目缺少来源' : '题目待确认';
    return [
      {
        kind: 'question',
        id: question.id,
        resourceType: 'question',
        resourceId: question.id,
        title: question.stem || '未命名题目',
        summary: objective?.objective ?? question.explanation,
        status: staleSource ? 'stale' : question.reviewStatus,
        reason,
        updatedAt: question.updatedAt
      }
    ];
  });
}

function matchesQueueEntry(entry: QueueEntry, query: Query) {
  if (query.kind && entry.kind !== query.kind) return false;
  if (query.reviewStatus && entry.status !== query.reviewStatus) return false;
  return matchesText([entry.title, entry.summary, entry.reason], query.query);
}

function evidenceStatusLabel(status: unknown): unknown {
  return (
    (
      {
        stale: '待复核',
        invalid: '已失效',
        insufficient: '不足'
      } as Record<PropertyKey, unknown>
    )[status as PropertyKey] ?? status
  );
}

function compareUpdatedDesc(left: WorkspaceRecord, right: WorkspaceRecord) {
  return (
    new (Date as NativeDateConstructor)(right.updatedAt).getTime() -
      new (Date as NativeDateConstructor)(left.updatedAt).getTime() || String(left.id).localeCompare(String(right.id))
  );
}
