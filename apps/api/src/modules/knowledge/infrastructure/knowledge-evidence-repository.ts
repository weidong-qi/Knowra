import { createAppError } from '../../../errors/app-error.ts';

import type { KnowledgeEvidence } from '../domain/knowledge-evidence.ts';

/** 本地历史记录只保证标识与知识归属；其余字段不假定已经过领域构造器规范化。 */
export interface KnowledgeEvidenceRecord<
  SourceType = KnowledgeEvidence['sourceType'] | null,
  RelationType = KnowledgeEvidence['relationType'] | null
> {
  id: string;
  knowledgeItemId: string;
  sourceType?: SourceType;
  status?: KnowledgeEvidence['status'] | null;
  relationType?: RelationType;
  applicabilityStatus?: KnowledgeEvidence['applicabilityStatus'] | null;
  noteId?: string | null;
  noteVersionId?: string | null;
  annotationId?: string | null;
  sourceId?: unknown;
  quoteText?: unknown;
  headingPath?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface KnowledgeEvidenceListOptions {
  knowledgeItemId?: string | null;
  noteId?: string | null;
  noteVersionId?: string | null;
  annotationId?: string | null;
}

// mark* 会原地改写这两个字段；任何读取及回调均不能承诺其输入字面量。
// 保留其他字段及 extra；旧默认 Record 的字段形状不变。
type MutableEvidenceFields<Record extends KnowledgeEvidenceRecord<unknown, unknown>> = {
  [Key in keyof Record as Key extends 'status' | 'updatedAt' ? never : Key]: Record[Key];
} & {
  status?: KnowledgeEvidence['status'] | null;
  updatedAt?: Record['updatedAt'] | string;
};

// 同态映射保留联合记录的各自 extra 字段，不把它们缩成公共键。
type EvidenceRecordShape<Fields> = { [Key in keyof Fields]: Fields[Key] };
export type StoredKnowledgeEvidenceRecord<Record extends KnowledgeEvidenceRecord<unknown, unknown>> =
  EvidenceRecordShape<MutableEvidenceFields<Record>>;

/** 同步本地仓库，保留引用；严格写入参数拒绝窄仓库冒充宽仓库。 */
export interface KnowledgeEvidenceRepository<
  Record extends KnowledgeEvidenceRecord<unknown, unknown> = KnowledgeEvidenceRecord
> {
  // 泛型保留输入额外字段；基础重载维持严格写入参数方差。
  create: {
    <Value extends StoredKnowledgeEvidenceRecord<Record>>(
      evidence: Value
    ): StoredKnowledgeEvidenceRecord<Value> & StoredKnowledgeEvidenceRecord<Record>;
    (evidence: StoredKnowledgeEvidenceRecord<Record>): StoredKnowledgeEvidenceRecord<Record>;
  };
  save: {
    <Value extends StoredKnowledgeEvidenceRecord<Record>>(
      evidence: Value
    ): StoredKnowledgeEvidenceRecord<Value> & StoredKnowledgeEvidenceRecord<Record>;
    (evidence: StoredKnowledgeEvidenceRecord<Record>): StoredKnowledgeEvidenceRecord<Record>;
  };
  findById(id: string | null | undefined): StoredKnowledgeEvidenceRecord<Record> | null;
  deleteByKnowledgeItemId(knowledgeItemId: string | null | undefined): StoredKnowledgeEvidenceRecord<Record>[];
  list(options?: KnowledgeEvidenceListOptions): StoredKnowledgeEvidenceRecord<Record>[];
  markByNoteId(
    noteId: string | null | undefined,
    status: KnowledgeEvidence['status']
  ): StoredKnowledgeEvidenceRecord<Record>[];
  markByAnnotationId(
    annotationId: string | null | undefined,
    status: KnowledgeEvidence['status']
  ): StoredKnowledgeEvidenceRecord<Record>[];
  markByNoteVersionId(
    noteVersionId: string | null | undefined,
    status: KnowledgeEvidence['status'],
    sourceType?: KnowledgeEvidence['sourceType'] | '' | null
  ): StoredKnowledgeEvidenceRecord<Record>[];
  markByNoteVersionIds(
    noteVersionIds: readonly string[],
    status: KnowledgeEvidence['status'],
    sourceType?: KnowledgeEvidence['sourceType'] | '' | null
  ): StoredKnowledgeEvidenceRecord<Record>[];
}

export interface KnowledgeEvidenceRepositoryOptions<
  Record extends KnowledgeEvidenceRecord<unknown, unknown> = KnowledgeEvidenceRecord
> {
  /** 保留调用方数组引用；省略或 null 时使用新数组。窄可变别名不能获得字段不变保证。 */
  records?: Record[] | null;
  /** 同步动态回调；接收到的记录可能已经被 mark* 改写。 */
  onChange?: ((records: StoredKnowledgeEvidenceRecord<Record>[]) => void) | null;
}

// 只在整个推导结果为 never 时恢复旧默认，不把 Record<never> 中的字段偷换为默认。
type InitialKnowledgeEvidenceRecord<Record extends KnowledgeEvidenceRecord<unknown, unknown>> =
  Record | ([Record] extends [never] ? KnowledgeEvidenceRecord : never);

export function createInMemoryKnowledgeEvidenceRepository<
  Record extends KnowledgeEvidenceRecord<unknown, unknown> = KnowledgeEvidenceRecord
>(
  options: KnowledgeEvidenceRepositoryOptions<InitialKnowledgeEvidenceRecord<Record>> = {}
): KnowledgeEvidenceRepository<InitialKnowledgeEvidenceRecord<Record>> {
  const records: StoredKnowledgeEvidenceRecord<InitialKnowledgeEvidenceRecord<Record>>[] = options.records ?? [];
  const persist = () => options.onChange?.(records);
  function updateStatus(
    predicate: (record: StoredKnowledgeEvidenceRecord<InitialKnowledgeEvidenceRecord<Record>>) => boolean,
    status: KnowledgeEvidence['status']
  ) {
    const changed = [];
    for (const record of records) {
      if (!predicate(record) || record.status === status) continue;
      if (status === 'stale' && record.status === 'invalid') continue;
      record.status = status;
      record.updatedAt = new Date().toISOString();
      changed.push(record);
    }
    if (changed.length) persist();
    return changed;
  }
  return {
    create<Value extends StoredKnowledgeEvidenceRecord<InitialKnowledgeEvidenceRecord<Record>>>(evidence: Value) {
      if (records.some(record => record.id === evidence.id)) {
        throw createAppError(
          'KNOWLEDGE_EVIDENCE_ID_CONFLICT',
          'KnowledgeEvidence with the same id already exists',
          409
        );
      }
      records.push(evidence);
      persist();
      // 返回同一对象，只拓宽仓库允许原地改写的字段，不把历史记录补成领域实体。
      return evidence as StoredKnowledgeEvidenceRecord<Value> &
        StoredKnowledgeEvidenceRecord<InitialKnowledgeEvidenceRecord<Record>>;
    },
    save<Value extends StoredKnowledgeEvidenceRecord<InitialKnowledgeEvidenceRecord<Record>>>(evidence: Value) {
      const index = records.findIndex(record => record.id === evidence.id);
      if (index < 0) records.push(evidence);
      else records[index] = evidence;
      persist();
      // 返回同一对象，只拓宽仓库允许原地改写的字段，不把历史记录补成领域实体。
      return evidence as StoredKnowledgeEvidenceRecord<Value> &
        StoredKnowledgeEvidenceRecord<InitialKnowledgeEvidenceRecord<Record>>;
    },
    findById(id) {
      return records.find(item => item.id === id) ?? null;
    },
    deleteByKnowledgeItemId(knowledgeItemId) {
      const deleted = records.filter(item => item.knowledgeItemId === knowledgeItemId);
      for (const record of deleted) records.splice(records.indexOf(record), 1);
      if (deleted.length) persist();
      return deleted;
    },
    list({ knowledgeItemId, noteId, noteVersionId, annotationId } = {}) {
      return records.filter(
        item =>
          (!knowledgeItemId || item.knowledgeItemId === knowledgeItemId) &&
          (!noteId || item.noteId === noteId) &&
          (!noteVersionId || item.noteVersionId === noteVersionId) &&
          (!annotationId || item.annotationId === annotationId)
      );
    },
    markByNoteId(noteId, status) {
      return updateStatus(item => item.noteId === noteId, status);
    },
    markByAnnotationId(annotationId, status) {
      return updateStatus(item => item.annotationId === annotationId, status);
    },
    markByNoteVersionId(noteVersionId, status, sourceType = null) {
      return updateStatus(
        item => item.noteVersionId === noteVersionId && (!sourceType || item.sourceType === sourceType),
        status
      );
    },
    markByNoteVersionIds(noteVersionIds, status, sourceType = null) {
      const ids = new Set<string | null | undefined>(noteVersionIds);
      return updateStatus(
        item => ids.has(item.noteVersionId) && (!sourceType || item.sourceType === sourceType),
        status
      );
    }
  };
}
