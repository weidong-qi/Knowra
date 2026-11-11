import { validationError } from './knowledge-errors.ts';

/** 请求字段未经过验证；原有 Number/String/布尔分支负责运行时处理。 */
export interface WorkspaceQueryInput {
  limit?: unknown;
  sort?: unknown;
  query?: unknown;
  cursor?: unknown;
  reviewStatus?: unknown;
  knowledgeType?: unknown;
  evidenceStatus?: unknown;
  sourceStatus?: unknown;
  questionType?: unknown;
  difficulty?: unknown;
  actionVerb?: unknown;
  cognitiveLevel?: unknown;
  knowledgeItemId?: unknown;
  learningObjectiveId?: unknown;
  examProfileId?: unknown;
  kind?: unknown;
  includeArchived?: unknown;
  missingObjectives?: unknown;
  missingQuestions?: unknown;
  hasQuestions?: unknown;
}

export interface WorkspaceCursor {
  id: string;
  updatedAt: string;
}

/** 分页只读取字段，不保证历史记录来自已验证领域模型。 */
export interface WorkspaceRecord {
  id?: unknown;
  updatedAt?: unknown;
}

export interface WorkspacePageQuery {
  limit: number;
  sort: string;
  cursor: WorkspaceCursor | null;
}

/** 继承键可能产生字符串或原型对象，不能公开为数字计数。 */
// 同时覆盖 TypeScript 默认赋给 Object 继承成员的函数签名，防止 toString/constructor 伪装可调用。
export type WorkspaceCounts = Record<PropertyKey, unknown> & { [Member in keyof typeof Object.prototype]: unknown };

export interface WorkspaceReduce<Item, Accumulator, Result = Accumulator> {
  reduce: (callback: (accumulator: Accumulator, item: Item) => Accumulator, initial: Accumulator) => Result;
}

export interface WorkspaceSome<Result = boolean> {
  some: (predicate: (value: unknown) => boolean) => Result;
}

export interface WorkspaceStatusRecord {
  status?: unknown;
}

export interface WorkspaceStatusValues {
  includes: (status: string) => unknown;
  length?: unknown;
}

export interface WorkspaceStatusRecords {
  map: (project: (record: WorkspaceStatusRecord) => unknown) => WorkspaceStatusValues;
}

type NativeDateConstructor = new (value: unknown) => Date;
type NativeStringIncludes = (value: unknown) => boolean;

export const WORKSPACE_DEFAULT_LIMIT = 20;
export const WORKSPACE_MAX_LIMIT = 100;
export const WORKSPACE_SORTS = Object.freeze(['updated-desc', 'updated-asc']);

export function parseWorkspaceQuery(input: WorkspaceQueryInput = {}) {
  const limitValue = input.limit ?? WORKSPACE_DEFAULT_LIMIT;
  const limit = Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > WORKSPACE_MAX_LIMIT) {
    throw validationError('WORKSPACE_LIMIT_INVALID', `limit must be an integer between 1 and ${WORKSPACE_MAX_LIMIT}`);
  }

  const sort = String(input.sort ?? 'updated-desc');
  if (!WORKSPACE_SORTS.includes(sort)) {
    throw validationError('WORKSPACE_SORT_INVALID', 'sort must be updated-desc or updated-asc');
  }

  return {
    query: String(input.query ?? '')
      .trim()
      .toLocaleLowerCase(),
    limit,
    sort,
    cursor: decodeWorkspaceCursor(input.cursor),
    reviewStatus: normalizeOptional(input.reviewStatus),
    knowledgeType: normalizeOptional(input.knowledgeType),
    evidenceStatus: normalizeOptional(input.evidenceStatus ?? input.sourceStatus),
    questionType: normalizeOptional(input.questionType),
    difficulty: normalizeOptional(input.difficulty),
    actionVerb: normalizeOptional(input.actionVerb),
    cognitiveLevel: normalizeOptional(input.cognitiveLevel),
    knowledgeItemId: normalizeOptional(input.knowledgeItemId),
    learningObjectiveId: normalizeOptional(input.learningObjectiveId),
    examProfileId: normalizeOptional(input.examProfileId),
    kind: normalizeOptional(input.kind),
    includeArchived: parseBoolean(input.includeArchived, false),
    missingObjectives: parseBoolean(input.missingObjectives, false),
    missingQuestions: parseBoolean(input.missingQuestions, false),
    hasQuestions: parseOptionalBoolean(input.hasQuestions)
  };
}

export function paginateWorkspaceItems<Item extends WorkspaceRecord>(items: Iterable<Item>, query: WorkspacePageQuery) {
  const ordered = [...items].sort((left, right) => compareUpdated(left, right, query.sort));
  const startIndex = findCursorIndex(ordered, query.cursor, query.sort);
  const page = ordered.slice(startIndex, startIndex + query.limit);
  const hasMore = startIndex + query.limit < ordered.length;
  const last = page.at(-1);
  return {
    items: page,
    pagination: {
      limit: query.limit,
      sort: query.sort,
      total: ordered.length,
      hasMore,
      nextCursor: hasMore && last ? encodeWorkspaceCursor(last) : null
    }
  };
}

export function matchesText<Result = boolean>(values: WorkspaceSome<Result>, query: unknown): Result | true {
  if (!query) return true;
  return values.some(value => (String(value ?? '').toLocaleLowerCase().includes as NativeStringIncludes)(query));
}

export function countBy<Item>(items: readonly Item[], selector: (item: Item) => unknown): WorkspaceCounts;
export function countBy<Item, Result>(
  items: WorkspaceReduce<Item, WorkspaceCounts, Result>,
  selector: (item: Item) => unknown
): Result;
export function countBy<Item, Result>(
  items: WorkspaceReduce<Item, WorkspaceCounts, Result>,
  selector: (item: Item) => unknown
): Result {
  return items.reduce((counts, item) => {
    const key = selector(item) ?? 'unknown';
    // 仅允许保留原属性键转换和 JavaScript 原生 +，不证明操作数或结果为数字。
    // 原型继承值、对象转换、Symbol/BigInt 异常仍原样发生；公开读写边界始终为 unknown。
    counts[key as PropertyKey] = ((counts[key as PropertyKey] ?? 0) as number) + 1;
    return counts;
  }, {});
}

export function summarizeEvidenceStatus(records: WorkspaceStatusRecords = []) {
  const statuses = records.map(record => record.status);
  if (statuses.includes('invalid')) return 'invalid';
  if (statuses.includes('stale')) return 'stale';
  if (statuses.includes('insufficient')) return 'insufficient';
  return statuses.length ? 'valid' : 'insufficient';
}

export function summarizeSourceStatus(records: WorkspaceStatusRecords = []) {
  const statuses = records.map(record => record.status);
  if (statuses.includes('stale')) return 'stale';
  if (statuses.includes('active') || statuses.includes('reanchored')) return 'valid';
  return 'insufficient';
}

export function groupBy<Item, Key>(records: readonly Item[], keySelector: (record: Item) => Key): Map<Key, Item[]>;
export function groupBy<Item, Key, Result>(
  records: WorkspaceReduce<Item, Map<Key, Item[]>, Result>,
  keySelector: (record: Item) => Key
): Result;
export function groupBy<Item, Key, Result>(
  records: WorkspaceReduce<Item, Map<Key, Item[]>, Result>,
  keySelector: (record: Item) => Key
): Result {
  return records.reduce((groups, record) => {
    const key = keySelector(record);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
    return groups;
  }, new Map<Key, Item[]>());
}

export function encodeWorkspaceCursor(record: WorkspaceRecord) {
  const value = JSON.stringify({ updatedAt: record.updatedAt, id: record.id });
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeWorkspaceCursor(value: unknown): WorkspaceCursor | null {
  if (!value) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (
      !(decoded as WorkspaceRecord | null | undefined)?.id ||
      !(decoded as WorkspaceRecord | null | undefined)?.updatedAt ||
      Number.isNaN(new (Date as NativeDateConstructor)((decoded as WorkspaceRecord).updatedAt).getTime())
    ) {
      throw new Error('invalid cursor');
    }
    return { id: String((decoded as WorkspaceRecord).id), updatedAt: String((decoded as WorkspaceRecord).updatedAt) };
  } catch {
    throw validationError('WORKSPACE_CURSOR_INVALID', 'cursor is invalid or expired');
  }
}

function findCursorIndex(items: readonly WorkspaceRecord[], cursor: WorkspaceCursor | null, sort: string) {
  if (!cursor) return 0;
  const exactIndex = items.findIndex(item => item.id === cursor.id && item.updatedAt === cursor.updatedAt);
  if (exactIndex >= 0) return exactIndex + 1;
  const nextIndex = items.findIndex(item => compareUpdated(item, cursor, sort) > 0);
  return nextIndex >= 0 ? nextIndex : items.length;
}

function compareUpdated(left: WorkspaceRecord, right: WorkspaceRecord, sort: string) {
  const leftTime = new (Date as NativeDateConstructor)(left.updatedAt).getTime();
  const rightTime = new (Date as NativeDateConstructor)(right.updatedAt).getTime();
  const timeCompare = sort === 'updated-asc' ? leftTime - rightTime : rightTime - leftTime;
  return timeCompare || String(left.id).localeCompare(String(right.id));
}

function normalizeOptional(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw validationError('WORKSPACE_BOOLEAN_INVALID', 'Boolean query parameters must be true or false');
}

function parseOptionalBoolean(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  return parseBoolean(value, false);
}
