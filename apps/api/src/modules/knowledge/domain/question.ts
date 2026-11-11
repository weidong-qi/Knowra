// 历史 JSON 通过原有运行时检查；未规范化的字段保留输入类型。
export interface QuestionConstructorInput<
  QuestionType = string,
  Difficulty = string | null,
  CreatedAt = string,
  UpdatedAt = CreatedAt,
  Id = string,
  DeletedAt = string | null
> {
  id: Id;
  questionType?: QuestionType | string;
  stem?: unknown;
  options?: unknown;
  referenceAnswer?: unknown;
  rubric?: unknown;
  explanation?: unknown;
  difficulty?: Difficulty | string | null;
  reviewStatus?: unknown;
  sourceMode?: unknown;
  version?: unknown;
  deletedAt?: DeletedAt | null;
  createdAt?: CreatedAt | string;
  updatedAt?: UpdatedAt | CreatedAt | string;
}

const QUESTION_TYPE_SET = new Set(['singleChoice', 'multipleChoice', 'trueFalse', 'shortAnswer']);
const REVIEW_STATUS_SET = new Set(['draft', 'validating', 'candidate', 'confirmed', 'archived']);
const SOURCE_MODE_SET = new Set(['manual', 'ai', 'import']);
const DIFFICULTY_SET = new Set(['easy', 'medium', 'hard']);

function cloneOrNull<T>(value: T | null | undefined): T | null {
  return value === undefined || value === null ? null : structuredClone(value);
}

export class Question<
  QuestionType = string,
  Difficulty = string | null,
  CreatedAt = string,
  UpdatedAt = CreatedAt,
  Id = string,
  DeletedAt = string | null
> {
  declare id: NonNullable<Id>;
  declare questionType: 'singleChoice' | 'multipleChoice' | 'trueFalse' | 'shortAnswer';
  declare stem: string;
  declare options: unknown[] | null;
  declare referenceAnswer: unknown;
  declare rubric: unknown;
  declare explanation: string;
  declare difficulty: 'easy' | 'medium' | 'hard' | null;
  declare reviewStatus: 'draft' | 'validating' | 'candidate' | 'confirmed' | 'archived';
  declare sourceMode: 'manual' | 'ai' | 'import';
  declare version: number;
  declare deletedAt: Exclude<DeletedAt, undefined> | null;
  declare createdAt: Exclude<CreatedAt, undefined> | string;
  declare updatedAt: Exclude<UpdatedAt | CreatedAt, undefined> | string;

  constructor({
    id,
    questionType = 'shortAnswer',
    stem = '',
    options = null,
    referenceAnswer = null,
    rubric = null,
    explanation = '',
    difficulty = null,
    reviewStatus = 'draft',
    sourceMode = 'manual',
    version = 1,
    deletedAt = null,
    createdAt = new Date().toISOString(),
    updatedAt = createdAt
  }: QuestionConstructorInput<QuestionType, Difficulty, CreatedAt, UpdatedAt, Id, DeletedAt>) {
    if (!(id as { trim(): unknown } | null | undefined)?.trim()) throw new Error('Question id is required');
    if (!(QUESTION_TYPE_SET as ReadonlySet<unknown>).has(questionType))
      throw new Error('Question questionType is invalid');
    if (
      !(REVIEW_STATUS_SET as ReadonlySet<unknown>).has(reviewStatus) ||
      !(SOURCE_MODE_SET as ReadonlySet<unknown>).has(sourceMode)
    )
      throw new Error('Question status or sourceMode is invalid');
    if (difficulty && !(DIFFICULTY_SET as ReadonlySet<unknown>).has(difficulty))
      throw new Error('Question difficulty is invalid');
    if (!Number.isInteger(Number(version)) || Number(version) < 1) throw new Error('Question version is invalid');
    if (typeof stem !== 'string' || typeof explanation !== 'string')
      throw new Error('Question text fields are invalid');
    if (options !== null && options !== undefined && !Array.isArray(options)) {
      throw new Error('Question options must be an array or null');
    }

    Object.assign(this, {
      id,
      questionType,
      stem: stem.trim(),
      options: cloneOrNull(options),
      referenceAnswer: cloneOrNull(referenceAnswer),
      rubric: cloneOrNull(rubric),
      explanation: explanation.trim(),
      difficulty: difficulty || null,
      reviewStatus,
      sourceMode,
      version: Number(version),
      deletedAt,
      createdAt,
      updatedAt
    });
  }
}

export const QUESTION_TYPES = Object.freeze([...QUESTION_TYPE_SET]);
export const QUESTION_REVIEW_STATUSES = Object.freeze([...REVIEW_STATUS_SET]);
export const QUESTION_SOURCE_MODES = Object.freeze([...SOURCE_MODE_SET]);
export const QUESTION_DIFFICULTIES = Object.freeze([...DIFFICULTY_SET]);
