import { createAppError } from '../../../errors/app-error.ts';
import { questionObjectiveRecords } from './question-objective-identity.ts';
import type { QuestionObjectiveIdentityRecord } from './question-objective-identity.ts';

/** 只描述仓库读取的字段，不把历史快照冒充完整领域对象。 */
export interface AssessmentRecord {
  id: unknown;
  updatedAt?: unknown;
  questionId?: unknown;
}
export interface LearningObjectiveRecord extends AssessmentRecord {
  order?: unknown;
  knowledgeItemId?: unknown;
  reviewStatus?: unknown;
  deletedAt?: unknown;
}
export interface ExamProfileRecord extends AssessmentRecord {
  archivedAt?: unknown;
  deletedAt?: unknown;
}
export interface ExamFocusRecord extends AssessmentRecord {
  priority?: unknown;
  examProfileId?: unknown;
  learningObjectiveId?: unknown;
  reviewStatus?: unknown;
  deletedAt?: unknown;
}
export interface QuestionRecord extends AssessmentRecord {
  reviewStatus?: unknown;
  deletedAt?: unknown;
}
export interface QuestionObjectiveRecord extends AssessmentRecord {
  learningObjectiveId?: unknown;
  createdAt?: unknown;
  isPrimary?: unknown;
  order?: unknown;
}
export interface QuestionSourceRecord extends AssessmentRecord {
  sourceType?: unknown;
  sourceId?: unknown;
  status?: unknown;
  createdAt?: unknown;
}
export interface AssessmentListOptions {
  limit?: unknown;
  knowledgeItemId?: unknown;
  examProfileId?: unknown;
  learningObjectiveId?: unknown;
  reviewStatus?: unknown;
  includeArchived?: unknown;
  includeDeleted?: unknown;
}
export interface AssessmentRepositoryOptions<Record extends AssessmentRecord> {
  records?: Record[];
  /** 普通写入捕获初始回调；关系替换和来源标记读取 options 的当前回调。 */
  onChange?: ((records: Record[]) => unknown) | null;
}
export interface NullishAssessmentRepositoryOptions<Record extends AssessmentRecord> extends Omit<
  AssessmentRepositoryOptions<Record>,
  'records'
> {
  records?: Record[] | null;
}
export interface AssessmentCollectionRepository<Record extends AssessmentRecord> {
  create<Value extends Record>(record: Value): Value;
  save<Value extends Record>(record: Value, options?: { expectedUpdatedAt?: unknown }): Value;
  findById(id: unknown): Record | null;
  delete(id: unknown): Record | null;
  list(options?: AssessmentListOptions): Record[];
  deleteByQuestionId(questionId: unknown): Record[];
}
interface CollectionOptions<Record extends AssessmentRecord> extends AssessmentRepositoryOptions<Record> {
  sort?: ((left: Record, right: Record) => number) | null;
  filter?: (record: Record, query: AssessmentListOptions) => unknown;
  conflictCode?: string | null;
}
export interface ExamFocusRepository<Record extends ExamFocusRecord> extends AssessmentCollectionRepository<Record> {
  findByProfileAndObjective(examProfileId: unknown, learningObjectiveId: unknown): Record | null;
}
/** 替换会生成新形状，不能保证输入的附加字段仍存在。 */
export interface QuestionObjectiveRepository extends AssessmentCollectionRepository<QuestionObjectiveRecord> {
  listByQuestionIds(questionIds?: Iterable<unknown> | null): QuestionObjectiveRecord[];
  listByObjectiveId(learningObjectiveId: unknown): QuestionObjectiveRecord[];
  replaceForQuestion(questionId: unknown, objectiveIds?: Iterable<unknown> | null): QuestionObjectiveIdentityRecord[];
}
/** status/updatedAt 原地可变，读取不保证调用前的字面量或领域状态枚举。 */
export interface QuestionSourceRepository extends Omit<
  AssessmentCollectionRepository<QuestionSourceRecord>,
  'list' | 'create' | 'save'
> {
  create<Value extends QuestionSourceRecord>(record: Value): QuestionSourceRecord;
  save<Value extends QuestionSourceRecord>(
    record: Value,
    options?: { expectedUpdatedAt?: unknown }
  ): QuestionSourceRecord;
  listByQuestionIds(questionIds?: Iterable<unknown> | null): QuestionSourceRecord[];
  list(options?: { questionId?: unknown }): QuestionSourceRecord[];
  replaceForQuestion(questionId: unknown, sources?: QuestionSourceRecord[]): QuestionSourceRecord[];
  markBySourceId(sourceType: unknown, sourceId: unknown, status?: unknown): QuestionSourceRecord[];
  markBySourceIds(sourceType: unknown, sourceIds?: readonly unknown[], status?: unknown): QuestionSourceRecord[];
}
// 扩大原生 Date 输入签名，不验证、转换、缓存或保证日期有效。
type NativeDateConstructor = new (value: unknown) => Date;

function createCollectionRepository<Record extends AssessmentRecord>({
  records = [],
  onChange = null,
  sort = null,
  filter = () => true,
  conflictCode = null
}: CollectionOptions<Record> = {}): AssessmentCollectionRepository<Record> {
  const persist = () => onChange?.(records);
  return {
    create(record) {
      if (records.some(item => item.id === record.id)) {
        throw createAppError(
          'ASSESSMENT_ASSET_ID_CONFLICT',
          'An assessment asset with the same id already exists',
          409
        );
      }
      records.push(record);
      persist();
      return record;
    },
    save(record, { expectedUpdatedAt } = {}) {
      const index = records.findIndex(item => item.id === record.id);
      if (expectedUpdatedAt && (index < 0 || records[index].updatedAt !== expectedUpdatedAt)) {
        throw createAppError(
          conflictCode ?? 'ASSESSMENT_ASSET_UPDATE_CONFLICT',
          '学习资产已变化，请重新加载并核对。',
          409
        );
      }
      if (index < 0) records.push(record);
      else records[index] = record;
      persist();
      return record;
    },
    findById(id) {
      return records.find(item => item.id === id) ?? null;
    },
    delete(id) {
      const index = records.findIndex(item => item.id === id);
      if (index < 0) return null;
      const [removed] = records.splice(index, 1);
      persist();
      return removed;
    },
    list(options = {}) {
      const result = records.filter(item => filter(item, options));
      const ordered = sort ? result.sort(sort) : result;
      const limit = Number(options.limit);
      return Number.isInteger(limit) && limit > 0 ? ordered.slice(0, limit) : ordered;
    },
    deleteByQuestionId(questionId) {
      const removed = records.filter(item => item.questionId === questionId);
      if (!removed.length) return [];
      for (const item of removed) records.splice(records.indexOf(item), 1);
      persist();
      return removed;
    }
  };
}

const newestFirst = (left: AssessmentRecord, right: AssessmentRecord) =>
  new (Date as NativeDateConstructor)(right.updatedAt).getTime() -
  new (Date as NativeDateConstructor)(left.updatedAt).getTime();

export function createInMemoryLearningObjectiveRepository<
  Record extends LearningObjectiveRecord = LearningObjectiveRecord
>(options: AssessmentRepositoryOptions<Record> = {}): AssessmentCollectionRepository<Record> {
  return createCollectionRepository<Record>({
    conflictCode: 'LEARNING_OBJECTIVE_UPDATE_CONFLICT',
    records: options.records,
    onChange: options.onChange,
    // 仅允许原减法表达式；字段仍为 unknown，BigInt/Symbol 等保留原生 sort/运算异常。
    sort: (left, right) => (left.order as number) - (right.order as number) || newestFirst(left, right),
    filter: (item, query) =>
      (!query.knowledgeItemId || item.knowledgeItemId === query.knowledgeItemId) &&
      (!query.reviewStatus || item.reviewStatus === query.reviewStatus) &&
      (query.includeArchived || item.reviewStatus !== 'archived') &&
      (query.includeDeleted || !item.deletedAt)
  });
}

export function createInMemoryExamProfileRepository<Record extends ExamProfileRecord = ExamProfileRecord>(
  options: AssessmentRepositoryOptions<Record> = {}
): AssessmentCollectionRepository<Record> {
  return createCollectionRepository<Record>({
    records: options.records,
    onChange: options.onChange,
    sort: newestFirst,
    filter: (item, query) => (query.includeArchived || !item.archivedAt) && (query.includeDeleted || !item.deletedAt)
  });
}

export function createInMemoryExamFocusRepository<Record extends ExamFocusRecord = ExamFocusRecord>(
  options: NullishAssessmentRepositoryOptions<Record> = {}
): ExamFocusRepository<Record> {
  const records = options.records ?? [];
  const repository = createCollectionRepository<Record>({
    records,
    onChange: options.onChange,
    sort: (left, right) => (left.priority as number) - (right.priority as number) || newestFirst(left, right),
    filter: (item, query) =>
      (!query.examProfileId || item.examProfileId === query.examProfileId) &&
      (!query.learningObjectiveId || item.learningObjectiveId === query.learningObjectiveId) &&
      (!query.reviewStatus || item.reviewStatus === query.reviewStatus) &&
      (query.includeArchived || item.reviewStatus !== 'archived') &&
      (query.includeDeleted || !item.deletedAt)
  });
  return {
    ...repository,
    findByProfileAndObjective(examProfileId, learningObjectiveId) {
      return (
        records.find(
          item => item.examProfileId === examProfileId && item.learningObjectiveId === learningObjectiveId
        ) ?? null
      );
    }
  };
}

export function createInMemoryQuestionRepository<Record extends QuestionRecord = QuestionRecord>(
  options: AssessmentRepositoryOptions<Record> = {}
): AssessmentCollectionRepository<Record> {
  return createCollectionRepository<Record>({
    records: options.records,
    onChange: options.onChange,
    sort: newestFirst,
    filter: (item, query) =>
      (!query.reviewStatus || item.reviewStatus === query.reviewStatus) &&
      (query.includeArchived || item.reviewStatus !== 'archived') &&
      (query.includeDeleted || !item.deletedAt)
  });
}

export function createInMemoryQuestionObjectiveRepository(
  options: NullishAssessmentRepositoryOptions<QuestionObjectiveRecord> = {}
): QuestionObjectiveRepository {
  const records = options.records ?? [];
  const repository = createCollectionRepository({ records, onChange: options.onChange });
  return {
    ...repository,
    listByQuestionIds(questionIds = []) {
      const wanted = new Set(questionIds);
      return records.filter(item => wanted.has(item.questionId));
    },
    listByObjectiveId(learningObjectiveId) {
      return records.filter(item => item.learningObjectiveId === learningObjectiveId);
    },
    replaceForQuestion(questionId, objectiveIds = []) {
      const removed = records.filter(item => item.questionId === questionId);
      for (const item of removed) records.splice(records.indexOf(item), 1);
      const next = questionObjectiveRecords(questionId, objectiveIds, removed);
      records.push(...next);
      options.onChange?.(records);
      return next;
    },
    deleteByQuestionId(questionId) {
      return repository.deleteByQuestionId(questionId);
    }
  };
}

export function createInMemoryQuestionSourceRepository(
  options: NullishAssessmentRepositoryOptions<QuestionSourceRecord> = {}
): QuestionSourceRepository {
  const records = options.records ?? [];
  const repository = createCollectionRepository({
    records,
    onChange: options.onChange,
    sort: (left, right) =>
      new (Date as NativeDateConstructor)(left.createdAt).getTime() -
      new (Date as NativeDateConstructor)(right.createdAt).getTime()
  });
  return {
    ...repository,
    listByQuestionIds(questionIds = []) {
      const wanted = new Set(questionIds);
      return records.filter(item => wanted.has(item.questionId));
    },
    list({ questionId } = {}) {
      return records
        .filter(item => !questionId || item.questionId === questionId)
        .sort(
          (left, right) =>
            new (Date as NativeDateConstructor)(left.createdAt).getTime() -
            new (Date as NativeDateConstructor)(right.createdAt).getTime()
        );
    },
    replaceForQuestion(questionId, sources = []) {
      const removed = records.filter(item => item.questionId === questionId);
      for (const item of removed) records.splice(records.indexOf(item), 1);
      records.push(...sources);
      options.onChange?.(records);
      return sources;
    },
    deleteByQuestionId(questionId) {
      return repository.deleteByQuestionId(questionId);
    },
    markBySourceId(sourceType, sourceId, status = 'stale') {
      return this.markBySourceIds(sourceType, [sourceId], status);
    },
    markBySourceIds(sourceType, sourceIds = [], status = 'stale') {
      const wanted = new Set(sourceIds.filter(Boolean));
      const changed = [];
      for (const item of records) {
        if (item.sourceType !== sourceType || !wanted.has(item.sourceId) || item.status === status) continue;
        item.status = status;
        item.updatedAt = new Date().toISOString();
        changed.push(item);
      }
      if (changed.length) options.onChange?.(records);
      return changed;
    }
  };
}
