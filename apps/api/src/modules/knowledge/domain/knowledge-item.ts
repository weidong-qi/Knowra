type KnowledgeItemSourceMode = 'manual' | 'annotation' | 'selection' | 'ai';

// 旧默认输入仍保持字符串；新的未知边界由显式泛型或调用推导承接。
export interface KnowledgeItemConstructorInput<
  Title = string,
  CanonicalStatement = string,
  UserExplanation = string | null,
  KnowledgeType = string,
  SourceMode = string,
  CreatedAt = string,
  UpdatedAt = CreatedAt,
  DeletedAt = string | null
> {
  id: string;
  title?: Title | '';
  canonicalStatement?: CanonicalStatement | '';
  userExplanation?: UserExplanation | '';
  knowledgeType?: KnowledgeType | 'concept';
  importance?: unknown;
  reviewStatus?: string | null;
  sourceMode?: SourceMode | 'manual';
  createdAt?: CreatedAt | string;
  updatedAt?: UpdatedAt | CreatedAt | string;
  deletedAt?: DeletedAt | null;
}

const REVIEW_STATUSES = new Set(['candidate', 'confirmed', 'needsRevision', 'archived']);
const SOURCE_MODES = new Set(['manual', 'annotation', 'selection', 'ai']);

// 旧字符串路径保留标准 Set.has 的既有枚举假设；unknown 不获得该保证。
export class KnowledgeItem<
  Title = string | undefined,
  CanonicalStatement = string | undefined,
  UserExplanation = string | null | undefined,
  KnowledgeType = string | undefined,
  SourceMode = string | undefined,
  CreatedAt = string | undefined,
  UpdatedAt = CreatedAt,
  DeletedAt = string | null
> {
  declare id: string;
  declare title: string;
  declare canonicalStatement: string;
  declare userExplanation: [Exclude<UserExplanation, null | undefined>] extends [string] ? string : unknown;
  declare knowledgeType: Exclude<KnowledgeType, undefined> | 'concept';
  declare importance: number | null;
  declare reviewStatus: 'candidate' | 'confirmed' | 'needsRevision' | 'archived';
  declare sourceMode: Exclude<SourceMode, string | undefined> | KnowledgeItemSourceMode;
  declare createdAt: Exclude<CreatedAt, undefined> | string;
  declare updatedAt: Exclude<UpdatedAt | CreatedAt, undefined> | string;
  declare deletedAt: Exclude<DeletedAt, undefined> | null;

  constructor({
    id,
    title = '',
    canonicalStatement = '',
    userExplanation = '',
    knowledgeType = 'concept',
    importance = null,
    reviewStatus = 'candidate',
    sourceMode = 'manual',
    createdAt = new Date().toISOString(),
    updatedAt = createdAt,
    deletedAt = null
  }: KnowledgeItemConstructorInput<
    Title,
    CanonicalStatement,
    UserExplanation,
    KnowledgeType,
    SourceMode,
    CreatedAt,
    UpdatedAt,
    DeletedAt
  >) {
    if (!id?.trim()) throw new Error('KnowledgeItem id is required');
    if (typeof title !== 'string' || typeof canonicalStatement !== 'string') {
      throw new Error('KnowledgeItem text fields are invalid');
    }
    if (
      !(REVIEW_STATUSES as ReadonlySet<unknown>).has(reviewStatus) ||
      !(SOURCE_MODES as ReadonlySet<unknown>).has(sourceMode)
    ) {
      throw new Error('KnowledgeItem status or sourceMode is invalid');
    }
    if (importance !== null && importance !== undefined && !Number.isFinite(Number(importance))) {
      throw new Error('KnowledgeItem importance is invalid');
    }

    Object.assign(this, {
      id,
      title: title.trim(),
      canonicalStatement: canonicalStatement.trim(),
      // 只描述旧可选调用；未校验输入的自定义 trim 可以返回任意值。
      userExplanation: (userExplanation as { trim?: () => unknown } | null | undefined)?.trim?.() ?? '',
      knowledgeType,
      importance: importance === null || importance === undefined ? null : Number(importance),
      reviewStatus,
      sourceMode,
      createdAt,
      updatedAt,
      deletedAt
    });
  }
}

export const KNOWLEDGE_ITEM_REVIEW_STATUSES = Object.freeze([...REVIEW_STATUSES]);
export const KNOWLEDGE_ITEM_SOURCE_MODES = Object.freeze([...SOURCE_MODES]);
