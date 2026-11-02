export interface ExamFocusConstructorInput<DifficultyHint = string | null, CreatedAt = string, UpdatedAt = CreatedAt> {
  id: string;
  examProfileId: string;
  learningObjectiveId: string;
  description?: string;
  priority?: unknown;
  difficultyHint?: DifficultyHint | string | null;
  questionTypeSuggestions?: unknown;
  sourceType?: string;
  reviewStatus?: string;
  deletedAt?: string | null;
  createdAt?: CreatedAt | string;
  updatedAt?: UpdatedAt | CreatedAt | string;
}

const REVIEW_STATUSES = new Set(['candidate', 'confirmed', 'archived']);
const SOURCE_TYPES = new Set(['manual', 'ai', 'pastPaper', 'syllabus']);
const DIFFICULTY_HINTS = new Set(['easy', 'medium', 'hard']);

export class ExamFocus<DifficultyHint = string | null, CreatedAt = string, UpdatedAt = CreatedAt> {
  declare id: string;
  declare examProfileId: string;
  declare learningObjectiveId: string;
  declare description: string;
  declare priority: number;
  declare difficultyHint: Exclude<DifficultyHint, string | null | undefined> | 'easy' | 'medium' | 'hard' | null;
  declare questionTypeSuggestions: unknown[];
  declare sourceType: 'manual' | 'ai' | 'pastPaper' | 'syllabus';
  declare reviewStatus: 'candidate' | 'confirmed' | 'archived';
  declare deletedAt: string | null;
  declare createdAt: Exclude<CreatedAt, undefined> | string;
  declare updatedAt: Exclude<UpdatedAt | CreatedAt, undefined> | string;

  constructor({
    id,
    examProfileId,
    learningObjectiveId,
    description = '',
    priority = 1,
    difficultyHint = null,
    questionTypeSuggestions = [],
    sourceType = 'manual',
    reviewStatus = 'candidate',
    deletedAt = null,
    createdAt = new Date().toISOString(),
    updatedAt = createdAt
  }: ExamFocusConstructorInput<DifficultyHint, CreatedAt, UpdatedAt>) {
    if (!id?.trim()) throw new Error('ExamFocus id is required');
    if (!examProfileId?.trim() || !learningObjectiveId?.trim()) throw new Error('ExamFocus references are required');
    if (typeof description !== 'string') throw new Error('ExamFocus description is invalid');
    if (!Number.isInteger(Number(priority)) || Number(priority) < 1) throw new Error('ExamFocus priority is invalid');
    if (!Array.isArray(questionTypeSuggestions)) throw new Error('ExamFocus questionTypeSuggestions is invalid');
    if (difficultyHint && !(DIFFICULTY_HINTS as ReadonlySet<unknown>).has(difficultyHint))
      throw new Error('ExamFocus difficultyHint is invalid');
    if (!SOURCE_TYPES.has(sourceType) || !REVIEW_STATUSES.has(reviewStatus))
      throw new Error('ExamFocus status or sourceType is invalid');

    Object.assign(this, {
      id,
      examProfileId,
      learningObjectiveId,
      description: description.trim(),
      priority: Number(priority),
      difficultyHint: difficultyHint || null,
      questionTypeSuggestions: structuredClone(questionTypeSuggestions),
      sourceType,
      reviewStatus,
      deletedAt,
      createdAt,
      updatedAt
    });
  }
}

export const EXAM_FOCUS_REVIEW_STATUSES = Object.freeze([...REVIEW_STATUSES]);
export const EXAM_FOCUS_SOURCE_TYPES = Object.freeze([...SOURCE_TYPES]);
export const EXAM_FOCUS_DIFFICULTY_HINTS = Object.freeze([...DIFFICULTY_HINTS]);
