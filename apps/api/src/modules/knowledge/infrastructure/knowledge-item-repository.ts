import { createAppError } from '../../../errors/app-error.ts';

import type { KnowledgeItem } from '../domain/knowledge-item.ts';

/** 旧默认来源模式不变；未知来源模式须显式选择宽 Record 或由 records 推导。 */
export interface KnowledgeItemRecord<SourceMode = KnowledgeItem['sourceMode'] | null> {
  id: string;
  title?: string;
  canonicalStatement?: string;
  reviewStatus?: KnowledgeItem['reviewStatus'] | null;
  sourceMode?: SourceMode;
  userExplanation?: unknown;
  knowledgeType?: unknown;
  importance?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
}

export interface KnowledgeItemSaveOptions {
  expectedUpdatedAt?: string | null;
}

export interface KnowledgeItemListOptions {
  reviewStatus?: KnowledgeItem['reviewStatus'] | '' | null;
  query?: unknown;
  includeArchived?: boolean | string | null;
  includeDeleted?: boolean | string | null;
}

/** 同步本地仓库；原记录原样返回。写入函数保持严格参数方差，不能把窄仓库当宽仓库。 */
export interface KnowledgeItemRepository<Record extends KnowledgeItemRecord<unknown> = KnowledgeItemRecord> {
  // 泛型保留输入额外字段；基础重载维持严格写入参数方差。
  create: {
    <Value extends Record>(item: Value): Value;
    (item: Record): Record;
  };
  save: {
    <Value extends Record>(item: Value, options?: KnowledgeItemSaveOptions): Value;
    (item: Record, options?: KnowledgeItemSaveOptions): Record;
  };
  findById(id: string | null | undefined): Record | null;
  delete(id: string | null | undefined): Record | null;
  list(options?: KnowledgeItemListOptions): Record[];
}

export interface KnowledgeItemRepositoryOptions<Record extends KnowledgeItemRecord<unknown> = KnowledgeItemRecord> {
  /** 保留调用方数组引用；省略或 null 时使用新数组。 */
  records?: Record[] | null;
  /** 同步变更钩子；每次读取当前回调，抛错不在本仓库内回滚。 */
  onChange?: ((records: Record[]) => void) | null;
}

// 原生 Date 单参数构造器接受任意 JavaScript 值且可能抛错；这里只补齐其重载边界。
type NativeDateConstructor = new (value: unknown) => Date;

// 空数组推导出的 never 没有记录信息，沿用旧默认；保留实际宽记录的推导。
type StoredKnowledgeItemRecord<Record extends KnowledgeItemRecord<unknown>> =
  Record | ([Record] extends [never] ? KnowledgeItemRecord : never);

export function createInMemoryKnowledgeItemRepository<
  Record extends KnowledgeItemRecord<unknown> = KnowledgeItemRecord
>(
  options: KnowledgeItemRepositoryOptions<StoredKnowledgeItemRecord<Record>> = {}
): KnowledgeItemRepository<StoredKnowledgeItemRecord<Record>> {
  const records = options.records ?? [];
  const persist = () => options.onChange?.(records);
  return {
    create<Value extends StoredKnowledgeItemRecord<Record>>(item: Value) {
      if (records.some(record => record.id === item.id)) {
        throw createAppError('KNOWLEDGE_ITEM_ID_CONFLICT', 'A KnowledgeItem with the same id already exists', 409);
      }
      records.push(item);
      persist();
      return item;
    },
    save<Value extends StoredKnowledgeItemRecord<Record>>(
      item: Value,
      { expectedUpdatedAt }: KnowledgeItemSaveOptions = {}
    ) {
      const index = records.findIndex(record => record.id === item.id);
      if (expectedUpdatedAt && (index < 0 || records[index].updatedAt !== expectedUpdatedAt)) {
        throw createAppError('KNOWLEDGE_ITEM_UPDATE_CONFLICT', '知识已被其他操作修改，请重新加载并核对。', 409);
      }
      if (index < 0) records.push(item);
      else records[index] = item;
      persist();
      return item;
    },
    findById(id) {
      return records.find(item => item.id === id) ?? null;
    },
    delete(id) {
      const index = records.findIndex(item => item.id === id);
      if (index < 0) return null;
      const [deleted] = records.splice(index, 1);
      persist();
      return deleted;
    },
    list({ reviewStatus, query = '', includeArchived = false, includeDeleted = false } = {}) {
      const search = String(query).trim().toLocaleLowerCase();
      const showArchived = includeArchived === true || includeArchived === 'true';
      const showDeleted = includeDeleted === true || includeDeleted === 'true';
      return records
        .filter(item => (reviewStatus ? item.reviewStatus === reviewStatus : true))
        .filter(item => reviewStatus === 'archived' || showArchived || item.reviewStatus !== 'archived')
        .filter(item => showDeleted || !item.deletedAt)
        .filter(
          item =>
            !search ||
            [item.title, item.canonicalStatement, item.userExplanation].some(value =>
              String(value).toLocaleLowerCase().includes(search)
            )
        )
        .sort(
          (left, right) =>
            new (Date as NativeDateConstructor)(right.updatedAt).getTime() -
            new (Date as NativeDateConstructor)(left.updatedAt).getTime()
        );
    }
  };
}
