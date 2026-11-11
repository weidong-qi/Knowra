// 历史 JSON 通过原有运行时检查；未规范化的字段保留输入类型。
type LearningObjectiveActionVerb =
  '' | 'identify' | 'explain' | 'apply' | 'compare' | 'analyze' | 'calculate' | 'design' | 'evaluate';
type LearningObjectiveCognitiveLevel = '' | 'remember' | 'understand' | 'apply' | 'analyze';
type LearningObjectiveDifficultyHint = 'easy' | 'medium' | 'hard' | null;

// 旧默认输入仍接受字符串；新泛型承接 DTO 未校验为字符串的值及历史时间戳。
export interface LearningObjectiveConstructorInput<
  ActionVerb = string,
  CognitiveLevel = string,
  DifficultyHint = string | null,
  CreatedAt = string,
  UpdatedAt = CreatedAt,
  Id = string,
  KnowledgeItemId = string,
  ReviewNote = string | null,
  DeletedAt = string | null
> {
  id: Id;
  knowledgeItemId?: KnowledgeItemId;
  objective?: unknown;
  actionVerb?: ActionVerb | '';
  cognitiveLevel?: CognitiveLevel | '';
  difficultyHint?: DifficultyHint | null;
  reviewStatus?: unknown;
  reviewNote?: ReviewNote | null;
  deletedAt?: DeletedAt | null;
  order?: unknown;
  createdAt?: CreatedAt | string;
  updatedAt?: UpdatedAt | CreatedAt | string;
}

const REVIEW_STATUSES = new Set(['candidate', 'confirmed', 'archived']);
const ACTION_VERBS = new Set(['identify', 'explain', 'apply', 'compare', 'analyze', 'calculate', 'design', 'evaluate']);
const COGNITIVE_LEVELS = new Set(['remember', 'understand', 'apply', 'analyze']);
const DIFFICULTY_HINTS = new Set(['easy', 'medium', 'hard']);

// 旧字符串输入沿用标准 Set.has 的枚举契约；unknown 输入不冒充该保证。
// 内建方法被全局替换时，旧枚举契约本身不提供动态保证；不新增字面量精度。
export class LearningObjective<
  ActionVerb = string | undefined,
  CognitiveLevel = string | undefined,
  DifficultyHint = string | null | undefined,
  CreatedAt = string | undefined,
  UpdatedAt = CreatedAt,
  Id = string,
  KnowledgeItemId = string,
  ReviewNote = string | null,
  DeletedAt = string | null
> {
  declare id: NonNullable<Id>;
  declare knowledgeItemId: NonNullable<KnowledgeItemId>;
  declare objective: string;
  declare actionVerb: [Exclude<ActionVerb, undefined>] extends [string] ? LearningObjectiveActionVerb : string;
  declare cognitiveLevel: [Exclude<CognitiveLevel, undefined>] extends [string]
    ? LearningObjectiveCognitiveLevel
    : string;
  declare difficultyHint: Exclude<DifficultyHint, string | undefined> | LearningObjectiveDifficultyHint;
  declare reviewStatus: 'candidate' | 'confirmed' | 'archived';
  declare reviewNote: [Exclude<ReviewNote, null | undefined>] extends [string] ? string | null : unknown;
  declare deletedAt: Exclude<DeletedAt, undefined> | null;
  declare order: number;
  declare createdAt: Exclude<CreatedAt, undefined> | string;
  declare updatedAt: Exclude<UpdatedAt | CreatedAt, undefined> | string;

  constructor({
    id,
    knowledgeItemId,
    objective = '',
    actionVerb = '',
    cognitiveLevel = '',
    difficultyHint = null,
    reviewStatus = 'candidate',
    reviewNote = null,
    deletedAt = null,
    order = 0,
    createdAt = new Date().toISOString(),
    updatedAt = createdAt
  }: LearningObjectiveConstructorInput<
    ActionVerb,
    CognitiveLevel,
    DifficultyHint,
    CreatedAt,
    UpdatedAt,
    Id,
    KnowledgeItemId,
    ReviewNote,
    DeletedAt
  >) {
    if (!(id as { trim(): unknown } | null | undefined)?.trim()) throw new Error('LearningObjective id is required');
    if (!(knowledgeItemId as { trim(): unknown } | null | undefined)?.trim())
      throw new Error('LearningObjective knowledgeItemId is required');
    if (typeof objective !== 'string' || typeof actionVerb !== 'string' || typeof cognitiveLevel !== 'string') {
      throw new Error('LearningObjective text fields are invalid');
    }
    if (!(REVIEW_STATUSES as ReadonlySet<unknown>).has(reviewStatus))
      throw new Error('LearningObjective reviewStatus is invalid');
    if (actionVerb && !ACTION_VERBS.has(actionVerb)) throw new Error('LearningObjective actionVerb is invalid');
    if (cognitiveLevel && !COGNITIVE_LEVELS.has(cognitiveLevel))
      throw new Error('LearningObjective cognitiveLevel is invalid');
    // 只放宽原 Set.has 的操作输入；动态 has 不证明泛型值属于枚举。
    if (
      difficultyHint !== null &&
      difficultyHint !== '' &&
      !(DIFFICULTY_HINTS as ReadonlySet<unknown>).has(difficultyHint)
    ) {
      throw new Error('LearningObjective difficultyHint is invalid');
    }
    if (!Number.isInteger(Number(order)) || Number(order) < 0) throw new Error('LearningObjective order is invalid');

    Object.assign(this, {
      id,
      knowledgeItemId,
      objective: objective.trim(),
      actionVerb: actionVerb.trim(),
      cognitiveLevel: cognitiveLevel.trim(),
      difficultyHint: difficultyHint || null,
      reviewStatus,
      reviewNote: (reviewNote as { trim?: () => unknown } | null | undefined)?.trim?.() || null,
      deletedAt,
      order: Number(order),
      createdAt,
      updatedAt
    });
  }
}

export const LEARNING_OBJECTIVE_REVIEW_STATUSES = Object.freeze([...REVIEW_STATUSES]);
export const LEARNING_OBJECTIVE_ACTION_VERBS = Object.freeze([...ACTION_VERBS]);
export const LEARNING_OBJECTIVE_COGNITIVE_LEVELS = Object.freeze([...COGNITIVE_LEVELS]);
export const LEARNING_OBJECTIVE_DIFFICULTY_HINTS = Object.freeze([...DIFFICULTY_HINTS]);
