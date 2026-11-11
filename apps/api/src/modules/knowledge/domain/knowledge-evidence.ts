type KnowledgeEvidenceSourceType = 'noteVersion' | 'annotation' | 'manual';

// 必选同态视图仅检查实际方法签名，不验证或修改输入；也阻止整体实例的条件方差捷径。
// 对普通数组联合逐支检查，自定义 map/filter 的任何一支都不冒充标准数组输出。
type EvidenceHeadingShape<HeadingPath> = { [Key in keyof HeadingPath]-?: HeadingPath[Key] };
type SameHeadingMethod<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type StandardEvidenceHeadingMethods<HeadingPath> = HeadingPath extends unknown[]
  ? SameHeadingMethod<HeadingPath['map'], Array<HeadingPath[number]>['map']> extends true
    ? SameHeadingMethod<HeadingPath['filter'], Array<HeadingPath[number]>['filter']>
    : false
  : false;
type EvidenceHeadingOutput<HeadingPath> = [Exclude<HeadingPath, undefined>] extends [never]
  ? string[]
  : [Exclude<HeadingPath, undefined>] extends [unknown[]]
    ? [StandardEvidenceHeadingMethods<Exclude<HeadingPath, undefined>>] extends [true]
      ? string[]
      : unknown
    : unknown;

// 保留旧字符串/数组默认；新未知输入显式穿过未经类型验证的边界。
export interface KnowledgeEvidenceConstructorInput<
  SourceType = string,
  RelationType = string,
  HeadingPath = unknown[],
  CreatedAt = string,
  UpdatedAt = CreatedAt,
  SourceId = string | null
> {
  id: string;
  knowledgeItemId: string;
  sourceType?: SourceType | 'manual';
  sourceId?: SourceId | null;
  noteId?: string | null;
  noteVersionId?: string | null;
  annotationId?: string | null;
  quoteText?: unknown;
  headingPath?: HeadingPath | unknown[];
  relationType?: RelationType | 'supports';
  status?: string | null;
  applicabilityStatus?: string | null;
  createdAt?: CreatedAt | string;
  updatedAt?: UpdatedAt | CreatedAt | string;
}

const SOURCE_TYPES = new Set(['noteVersion', 'annotation', 'manual']);
const EVIDENCE_STATUSES = new Set(['valid', 'stale', 'invalid', 'insufficient']);
const RELATION_TYPES = new Set(['supports']);
const APPLICABILITY_STATUSES = new Set(['active', 'withdrawn', 'needsReview']);

// 旧枚举和数组结果依赖标准内建方法；unknown 不获得该保证。
// 自定义 map 及其返回值的 filter 不继承标准数组输出保证。
export class KnowledgeEvidence<
  SourceType = string | undefined,
  RelationType = string | undefined,
  HeadingPath = unknown[] | undefined,
  CreatedAt = string | undefined,
  UpdatedAt = CreatedAt,
  SourceId = string | null
> {
  declare id: string;
  declare knowledgeItemId: string;
  declare sourceType: Exclude<SourceType, string | undefined> | KnowledgeEvidenceSourceType;
  declare sourceId: Exclude<SourceId, undefined> | null;
  declare noteId: string | null;
  declare noteVersionId: string | null;
  declare annotationId: string | null;
  declare quoteText: string;
  declare headingPath: EvidenceHeadingOutput<EvidenceHeadingShape<HeadingPath>>;
  declare relationType: Exclude<RelationType, string | undefined> | 'supports';
  declare status: 'valid' | 'stale' | 'invalid' | 'insufficient';
  declare applicabilityStatus: 'active' | 'withdrawn' | 'needsReview';
  declare createdAt: Exclude<CreatedAt, undefined> | string;
  declare updatedAt: Exclude<UpdatedAt | CreatedAt, undefined> | string;

  constructor({
    id,
    knowledgeItemId,
    sourceType = 'manual',
    sourceId = null,
    noteId = null,
    noteVersionId = null,
    annotationId = null,
    quoteText = '',
    headingPath = [],
    relationType = 'supports',
    status = 'valid',
    applicabilityStatus = status === 'invalid' ? 'needsReview' : 'active',
    createdAt = new Date().toISOString(),
    updatedAt = createdAt
  }: KnowledgeEvidenceConstructorInput<SourceType, RelationType, HeadingPath, CreatedAt, UpdatedAt, SourceId>) {
    if (!id?.trim() || !knowledgeItemId?.trim()) {
      throw new Error('KnowledgeEvidence identity is required');
    }
    if (
      !(SOURCE_TYPES as ReadonlySet<unknown>).has(sourceType) ||
      !(EVIDENCE_STATUSES as ReadonlySet<unknown>).has(status) ||
      !(RELATION_TYPES as ReadonlySet<unknown>).has(relationType) ||
      !(APPLICABILITY_STATUSES as ReadonlySet<unknown>).has(applicabilityStatus)
    ) {
      throw new Error('KnowledgeEvidence type or status is invalid');
    }
    if (!Array.isArray(headingPath)) {
      throw new Error('KnowledgeEvidence headingPath is invalid');
    }
    if (sourceType === 'noteVersion' && !noteVersionId) {
      throw new Error('NoteVersion evidence requires noteVersionId');
    }
    if (sourceType === 'annotation' && !annotationId) {
      throw new Error('Annotation evidence requires annotationId');
    }
    if (sourceType === 'manual' && (noteVersionId || annotationId)) {
      throw new Error('Manual evidence cannot reference an annotation or NoteVersion');
    }

    Object.assign(this, {
      id,
      knowledgeItemId,
      sourceType,
      sourceId,
      noteId,
      noteVersionId,
      annotationId,
      quoteText: String(quoteText ?? '').trim(),
      // 只描述原有动态 map/filter 调用；自定义方法的最终返回值仍是 unknown。
      headingPath: (
        headingPath as {
          map: (callback: (item: unknown) => string) => { filter: (predicate: typeof Boolean) => unknown };
        }
      )
        .map(item => String(item).trim())
        .filter(Boolean),
      relationType,
      status,
      applicabilityStatus,
      createdAt,
      updatedAt
    });
  }
}

export const KNOWLEDGE_EVIDENCE_STATUSES = Object.freeze([...EVIDENCE_STATUSES]);
