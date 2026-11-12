/** 本地仓库只读取身份/筛选字段；未校验的历史值保留 unknown。 */
export interface AnnotationSupportRecord {
  id?: unknown;
}
export interface AnnotationExclusionRecord extends AnnotationSupportRecord {
  parentAnnotationId?: unknown;
  status?: unknown;
}
export interface AnnotationRevisionRecord extends AnnotationSupportRecord {
  annotationId?: unknown;
  revision?: unknown;
}
export interface AnalysisScopeRecord extends AnnotationSupportRecord {
  noteVersions?: unknown;
  spaceId?: unknown;
  idempotencyKey?: unknown;
  deletedAt?: unknown;
}
export interface AnnotationSupportOptions<Record extends AnnotationSupportRecord> {
  records?: Record[] | null;
  /** 工厂只捕获一次回调；无 options 接收者；抛错不撤销此前数组变更。 */
  onChange?: ((records: Record[]) => unknown) | null;
}
export interface AnnotationSupportRepository<Record extends AnnotationSupportRecord> {
  save<Value extends Record>(record: Value): Value;
  findById(id: unknown): Record | null;
  delete(id: unknown): Record | null | undefined;
}
interface ArrayRepository<Record extends AnnotationSupportRecord> extends AnnotationSupportRepository<Record> {
  list(predicate?: (record: Record, index: number, records: Record[]) => unknown): Record[];
}
export interface AnnotationExclusionRepository<
  Record extends AnnotationExclusionRecord
> extends AnnotationSupportRepository<Record> {
  list(options?: { parentAnnotationId?: unknown; includeDeleted?: unknown }): Record[];
  /** 逐项按当前 ID 删除；重复 ID 和回调修改数组会改变结果，不能保证每项都存在。 */
  deleteByAnnotationIds(annotationIds: Iterable<unknown> | null | undefined): (Record | null | undefined)[];
}
export interface AnnotationRevisionRepository<
  Record extends AnnotationRevisionRecord
> extends AnnotationSupportRepository<Record> {
  list(options?: { annotationId?: unknown }): Record[];
  findByAnnotationRevision(annotationId: unknown, revision: unknown): Record | null;
  deleteByAnnotationIds(annotationIds: Iterable<unknown> | null | undefined): (Record | null | undefined)[];
}
export interface AnalysisScopeRepository<
  Record extends AnalysisScopeRecord
> extends AnnotationSupportRepository<Record> {
  list(options?: { spaceId?: unknown; includeDeleted?: unknown }): Record[];
  findByIdempotencyKey(spaceId: unknown, idempotencyKey: unknown): Record | null;
}

function createArrayRepository<Record extends AnnotationSupportRecord>(
  records: Record[],
  onChange: AnnotationSupportOptions<Record>['onChange']
): ArrayRepository<Record> {
  const persist = () => onChange?.(records);
  return {
    save(record) {
      const index = records.findIndex(item => item.id === record.id);
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
      const [deleted] = records.splice(index, 1);
      persist();
      return deleted;
    },
    list(predicate = () => true) {
      return records.filter(predicate);
    }
  };
}

export function createInMemoryAnnotationExclusionRepository<
  Record extends AnnotationExclusionRecord = AnnotationExclusionRecord
>(options: AnnotationSupportOptions<Record> = {}): AnnotationExclusionRepository<Record> {
  const base = createArrayRepository(options.records ?? [], options.onChange);
  return {
    ...base,
    list({ parentAnnotationId, includeDeleted = false } = {}) {
      return base.list(
        item =>
          (!parentAnnotationId || item.parentAnnotationId === parentAnnotationId) &&
          (includeDeleted || item.status !== 'archived')
      );
    },
    deleteByAnnotationIds(annotationIds) {
      const ids = new Set(annotationIds);
      return base.list(item => ids.has(item.parentAnnotationId)).map(item => base.delete(item.id));
    }
  };
}

export function createInMemoryAnnotationRevisionRepository<
  Record extends AnnotationRevisionRecord = AnnotationRevisionRecord
>(options: AnnotationSupportOptions<Record> = {}): AnnotationRevisionRepository<Record> {
  const base = createArrayRepository(options.records ?? [], options.onChange);
  return {
    ...base,
    list({ annotationId } = {}) {
      return (
        base
          .list(item => !annotationId || item.annotationId === annotationId)
          // 仅在原减法位置提供操作数视图；历史字段仍为 unknown，保留 BigInt/Symbol/对象的原生行为。
          .sort((left, right) => (left.revision as number) - (right.revision as number))
      );
    },
    findByAnnotationRevision(annotationId, revision) {
      return base.list(item => item.annotationId === annotationId && item.revision === revision)[0] ?? null;
    },
    deleteByAnnotationIds(annotationIds) {
      const ids = new Set(annotationIds);
      return base.list(item => ids.has(item.annotationId)).map(item => base.delete(item.id));
    }
  };
}

export function createInMemoryAnalysisScopeRepository<Record extends AnalysisScopeRecord = AnalysisScopeRecord>(
  options: AnnotationSupportOptions<Record> = {}
): AnalysisScopeRepository<Record> {
  const base = createArrayRepository(options.records ?? [], options.onChange);
  return {
    ...base,
    findByIdempotencyKey(spaceId, idempotencyKey) {
      return base.list(item => item.spaceId === spaceId && item.idempotencyKey === idempotencyKey)[0] ?? null;
    },
    list({ spaceId, includeDeleted = false } = {}) {
      return base.list(item => (!spaceId || item.spaceId === spaceId) && (includeDeleted || !item.deletedAt));
    }
  };
}
