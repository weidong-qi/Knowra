import { createPrefixedId, requireText } from './_shared.ts';
import { validationError } from '../knowledge-errors.js';
import { QUESTION_SOURCE_TYPES } from '../../domain/question-source.js';
import { QUESTION_TYPES, QUESTION_SOURCE_MODES, QUESTION_DIFFICULTIES } from '../../domain/question.js';
import { EXAM_FOCUS_DIFFICULTY_HINTS } from '../../domain/exam-focus.js';

export interface AssessmentDtoInput {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  scope?: unknown;
  language?: unknown;
  commonQuestionTypes?: unknown;
  difficultyProfile?: unknown;
  examProfileId?: unknown;
  learningObjectiveId?: unknown;
  priority?: unknown;
  difficultyHint?: unknown;
  questionTypeSuggestions?: unknown;
  sourceType?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}
export interface QuestionDtoInput {
  id?: unknown;
  questionType?: unknown;
  stem?: unknown;
  options?: unknown;
  referenceAnswer?: unknown;
  rubric?: unknown;
  explanation?: unknown;
  difficulty?: unknown;
  sourceMode?: unknown;
  learningObjectiveIds?: unknown;
  sources?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}
export interface QuestionSourceDtoInput {
  id?: unknown;
  sourceType?: unknown;
  sourceId?: unknown;
  quote?: unknown;
  locator?: unknown;
  contentHash?: unknown;
}
type Field<Input, Key extends PropertyKey> = Key extends keyof Input ? Input[Key] : unknown;
type Trimmed<Value> = Value extends string ? string : Value;
interface DynamicTrim {
  trim(): unknown;
}
interface DynamicStringArray {
  map(callback: (item: unknown) => string): { filter(callback: typeof Boolean): unknown };
}
interface DynamicSources {
  map(callback: typeof buildQuestionSourceDto): unknown;
}
export interface CreateExamProfileDto<Input extends AssessmentDtoInput = AssessmentDtoInput> {
  id: string;
  name: string;
  description: string;
  scope: unknown;
  language: string;
  commonQuestionTypes: unknown;
  difficultyProfile: object;
  createdAt: Field<Input, 'createdAt'>;
  updatedAt: Field<Input, 'updatedAt'>;
}
export type UpdateExamProfileDto = Partial<Omit<CreateExamProfileDto, 'id' | 'createdAt' | 'updatedAt'>>;
export interface CreateExamFocusDto<Input extends AssessmentDtoInput = AssessmentDtoInput> {
  id: string;
  examProfileId: string;
  learningObjectiveId: string;
  description: string;
  priority: number;
  difficultyHint: Field<Input, 'difficultyHint'> | null;
  questionTypeSuggestions: unknown;
  sourceType: 'manual';
  createdAt: Field<Input, 'createdAt'>;
  updatedAt: Field<Input, 'updatedAt'>;
}
export interface UpdateExamFocusDto<Input extends AssessmentDtoInput = AssessmentDtoInput> {
  description?: string;
  difficultyHint?: Field<Input, 'difficultyHint'> | null;
  priority?: number;
  questionTypeSuggestions?: unknown;
}
export interface CreateQuestionDto<Input extends QuestionDtoInput = QuestionDtoInput> {
  id: string;
  questionType: NonNullable<Field<Input, 'questionType'>> | 'shortAnswer';
  stem: Trimmed<Field<Input, 'stem'>> | '';
  options: unknown[] | null;
  referenceAnswer: unknown;
  rubric: unknown;
  explanation: string;
  difficulty: Field<Input, 'difficulty'> | null;
  sourceMode: 'manual';
  learningObjectiveIds: unknown[];
  sources: unknown;
  createdAt: Field<Input, 'createdAt'>;
  updatedAt: Field<Input, 'updatedAt'>;
}
export interface UpdateQuestionDto<Input extends QuestionDtoInput = QuestionDtoInput> {
  questionType?: Field<Input, 'questionType'>;
  stem?: Trimmed<Field<Input, 'stem'>>;
  explanation?: Trimmed<Field<Input, 'explanation'>>;
  options?: unknown[] | null;
  referenceAnswer?: unknown;
  rubric?: unknown;
  difficulty?: Field<Input, 'difficulty'> | null;
  learningObjectiveIds?: unknown[];
  sources?: unknown;
}
export interface QuestionSourceDto<Input extends QuestionSourceDtoInput = QuestionSourceDtoInput> {
  id: string;
  sourceType: NonNullable<Field<Input, 'sourceType'>> | 'manual';
  sourceId: string | null;
  quote: string;
  locator: object | null;
  contentHash: string | null;
}

function optionalText(value: unknown, code: string, message: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw validationError(code, message);
  return value.trim() || null;
}

function jsonObject(value: unknown, fallback: object, code: string, message: string): object {
  if (value === undefined || value === null) return structuredClone(fallback);
  if (typeof value !== 'object' || Array.isArray(value)) throw validationError(code, message);
  return structuredClone(value);
}

function stringArray(value: unknown, fallback: unknown[], code: string, message: string): unknown {
  if (value === undefined || value === null) return structuredClone(fallback);
  if (!Array.isArray(value)) throw validationError(code, message);
  return (value as DynamicStringArray).map(item => String(item).trim()).filter(Boolean);
}

function optionalEnum<Value>(value: Value, values: readonly unknown[], code: string, message: string): Value | null {
  if (value === undefined || value === null || value === '') return null;
  if (!values.includes(value)) throw validationError(code, message);
  return value;
}

function optionalJsonObject(value: unknown, code: string, message: string): object | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw validationError(code, message);
  return structuredClone(value);
}

export function buildCreateExamProfileDto<Input extends AssessmentDtoInput>(input: Input): CreateExamProfileDto<Input>;
export function buildCreateExamProfileDto(input?: AssessmentDtoInput): CreateExamProfileDto;
export function buildCreateExamProfileDto(input: AssessmentDtoInput = {}): CreateExamProfileDto {
  return {
    id:
      input.id === undefined
        ? createPrefixedId('exam-profile')
        : requireText(input.id, 'EXAM_PROFILE_ID_INVALID', 'ExamProfile id is invalid'),
    name: requireText(input.name, 'EXAM_PROFILE_NAME_REQUIRED', 'ExamProfile name is required'),
    description:
      optionalText(input.description, 'EXAM_PROFILE_DESCRIPTION_INVALID', 'ExamProfile description is invalid') ?? '',
    scope: stringArray(input.scope, [], 'EXAM_PROFILE_SCOPE_INVALID', 'ExamProfile scope is invalid'),
    language:
      optionalText(input.language, 'EXAM_PROFILE_LANGUAGE_INVALID', 'ExamProfile language is invalid') ?? 'zh-CN',
    commonQuestionTypes: stringArray(
      input.commonQuestionTypes,
      [],
      'EXAM_PROFILE_TYPES_INVALID',
      'ExamProfile commonQuestionTypes is invalid'
    ),
    difficultyProfile: jsonObject(
      input.difficultyProfile,
      {},
      'EXAM_PROFILE_DIFFICULTY_INVALID',
      'ExamProfile difficultyProfile is invalid'
    ),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

export function buildUpdateExamProfileDto(input: AssessmentDtoInput = {}): UpdateExamProfileDto {
  const dto: UpdateExamProfileDto = {};
  if (input.name !== undefined)
    dto.name = requireText(input.name, 'EXAM_PROFILE_NAME_REQUIRED', 'ExamProfile name is required');
  if (input.description !== undefined)
    dto.description =
      optionalText(input.description, 'EXAM_PROFILE_DESCRIPTION_INVALID', 'ExamProfile description is invalid') ?? '';
  if (input.scope !== undefined)
    dto.scope = stringArray(input.scope, [], 'EXAM_PROFILE_SCOPE_INVALID', 'ExamProfile scope is invalid');
  if (input.language !== undefined)
    dto.language =
      optionalText(input.language, 'EXAM_PROFILE_LANGUAGE_INVALID', 'ExamProfile language is invalid') ?? 'zh-CN';
  if (input.commonQuestionTypes !== undefined)
    dto.commonQuestionTypes = stringArray(
      input.commonQuestionTypes,
      [],
      'EXAM_PROFILE_TYPES_INVALID',
      'ExamProfile commonQuestionTypes is invalid'
    );
  if (input.difficultyProfile !== undefined)
    dto.difficultyProfile = jsonObject(
      input.difficultyProfile,
      {},
      'EXAM_PROFILE_DIFFICULTY_INVALID',
      'ExamProfile difficultyProfile is invalid'
    );
  return dto;
}

export function buildCreateExamFocusDto<Input extends AssessmentDtoInput>(input: Input): CreateExamFocusDto<Input>;
export function buildCreateExamFocusDto(input?: AssessmentDtoInput): CreateExamFocusDto;
export function buildCreateExamFocusDto(input: AssessmentDtoInput = {}): CreateExamFocusDto {
  const priority = Number(input.priority ?? 1);
  if (!Number.isInteger(priority) || priority < 1)
    throw validationError('EXAM_FOCUS_PRIORITY_INVALID', 'ExamFocus priority is invalid');
  const sourceType = input.sourceType ?? 'manual';
  if (sourceType !== 'manual')
    throw validationError('EXAM_FOCUS_SOURCE_TYPE_UNSUPPORTED', 'Phase3.0 only supports manual ExamFocus sources');
  return {
    id:
      input.id === undefined
        ? createPrefixedId('exam-focus')
        : requireText(input.id, 'EXAM_FOCUS_ID_INVALID', 'ExamFocus id is invalid'),
    examProfileId: requireText(
      input.examProfileId,
      'EXAM_FOCUS_PROFILE_REQUIRED',
      'ExamFocus examProfileId is required'
    ),
    learningObjectiveId: requireText(
      input.learningObjectiveId,
      'EXAM_FOCUS_OBJECTIVE_REQUIRED',
      'ExamFocus learningObjectiveId is required'
    ),
    description:
      optionalText(input.description, 'EXAM_FOCUS_DESCRIPTION_INVALID', 'ExamFocus description is invalid') ?? '',
    priority,
    difficultyHint: optionalEnum(
      input.difficultyHint,
      EXAM_FOCUS_DIFFICULTY_HINTS,
      'EXAM_FOCUS_DIFFICULTY_INVALID',
      'ExamFocus difficultyHint is invalid'
    ),
    questionTypeSuggestions: stringArray(
      input.questionTypeSuggestions,
      [],
      'EXAM_FOCUS_TYPES_INVALID',
      'ExamFocus questionTypeSuggestions is invalid'
    ),
    sourceType,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

export function buildUpdateExamFocusDto<Input extends AssessmentDtoInput>(input: Input): UpdateExamFocusDto<Input>;
export function buildUpdateExamFocusDto(input?: AssessmentDtoInput): UpdateExamFocusDto;
export function buildUpdateExamFocusDto(input: AssessmentDtoInput = {}): UpdateExamFocusDto {
  const dto: UpdateExamFocusDto = {};
  if (input.description !== undefined)
    dto.description =
      optionalText(input.description, 'EXAM_FOCUS_DESCRIPTION_INVALID', 'ExamFocus description is invalid') ?? '';
  if (input.difficultyHint !== undefined)
    dto.difficultyHint = optionalEnum(
      input.difficultyHint,
      EXAM_FOCUS_DIFFICULTY_HINTS,
      'EXAM_FOCUS_DIFFICULTY_INVALID',
      'ExamFocus difficultyHint is invalid'
    );
  if (input.priority !== undefined) {
    const priority = Number(input.priority);
    if (!Number.isInteger(priority) || priority < 1)
      throw validationError('EXAM_FOCUS_PRIORITY_INVALID', 'ExamFocus priority is invalid');
    dto.priority = priority;
  }
  if (input.questionTypeSuggestions !== undefined)
    dto.questionTypeSuggestions = stringArray(
      input.questionTypeSuggestions,
      [],
      'EXAM_FOCUS_TYPES_INVALID',
      'ExamFocus questionTypeSuggestions is invalid'
    );
  return dto;
}

export function buildCreateQuestionDto<Input extends QuestionDtoInput>(input: Input): CreateQuestionDto<Input>;
export function buildCreateQuestionDto(input?: QuestionDtoInput): CreateQuestionDto;
export function buildCreateQuestionDto(input: QuestionDtoInput = {}): CreateQuestionDto {
  const questionType = input.questionType ?? 'shortAnswer';
  if (!(QUESTION_TYPES as readonly unknown[]).includes(questionType))
    throw validationError('QUESTION_TYPE_INVALID', 'Question questionType is invalid');
  const sourceMode = input.sourceMode ?? 'manual';
  if (!(QUESTION_SOURCE_MODES as readonly unknown[]).includes(sourceMode))
    throw validationError('QUESTION_SOURCE_MODE_INVALID', 'Question sourceMode is invalid');
  if (sourceMode !== 'manual')
    throw validationError('QUESTION_SOURCE_MODE_UNSUPPORTED', 'Phase3.0 only supports manual Question sources');
  const objectiveIds = stringArray(
    input.learningObjectiveIds,
    [],
    'QUESTION_OBJECTIVES_INVALID',
    'Question learningObjectiveIds is invalid'
  );
  const sources = Array.isArray(input.sources) ? (input.sources as DynamicSources).map(buildQuestionSourceDto) : [];
  return {
    id:
      input.id === undefined
        ? createPrefixedId('question')
        : requireText(input.id, 'QUESTION_ID_INVALID', 'Question id is invalid'),
    questionType,
    stem: typeof input.stem === 'string' ? (input.stem as DynamicTrim).trim() : '',
    options: cloneQuestionOptions(input.options),
    referenceAnswer: input.referenceAnswer === undefined ? null : structuredClone(input.referenceAnswer),
    rubric: input.rubric === undefined ? null : structuredClone(input.rubric),
    explanation:
      optionalText(input.explanation, 'QUESTION_EXPLANATION_INVALID', 'Question explanation is invalid') ?? '',
    difficulty: optionalEnum(
      input.difficulty,
      QUESTION_DIFFICULTIES,
      'QUESTION_DIFFICULTY_INVALID',
      'Question difficulty is invalid'
    ),
    sourceMode,
    learningObjectiveIds: [...new Set(objectiveIds as Iterable<unknown> | null | undefined)],
    sources,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

export function buildUpdateQuestionDto<Input extends QuestionDtoInput>(input: Input): UpdateQuestionDto<Input>;
export function buildUpdateQuestionDto(input?: QuestionDtoInput): UpdateQuestionDto;
export function buildUpdateQuestionDto(input: QuestionDtoInput = {}): UpdateQuestionDto {
  const dto: UpdateQuestionDto = {};
  if (input.questionType !== undefined) {
    if (!(QUESTION_TYPES as readonly unknown[]).includes(input.questionType))
      throw validationError('QUESTION_TYPE_INVALID', 'Question questionType is invalid');
    dto.questionType = input.questionType;
  }
  for (const field of ['stem', 'explanation'] as const) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== 'string')
        throw validationError('QUESTION_TEXT_INVALID', `Question ${field} is invalid`);
      dto[field] = (input[field] as DynamicTrim).trim();
    }
  }
  if (input.options !== undefined) dto.options = cloneQuestionOptions(input.options);
  for (const field of ['referenceAnswer', 'rubric'] as const) {
    if (input[field] !== undefined) dto[field] = input[field] === null ? null : structuredClone(input[field]);
  }
  if (input.difficulty !== undefined)
    dto.difficulty = optionalEnum(
      input.difficulty,
      QUESTION_DIFFICULTIES,
      'QUESTION_DIFFICULTY_INVALID',
      'Question difficulty is invalid'
    );
  if (input.learningObjectiveIds !== undefined)
    dto.learningObjectiveIds = [
      ...new Set(
        stringArray(
          input.learningObjectiveIds,
          [],
          'QUESTION_OBJECTIVES_INVALID',
          'Question learningObjectiveIds is invalid'
        ) as Iterable<unknown> | null | undefined
      )
    ];
  if (input.sources !== undefined) {
    if (!Array.isArray(input.sources)) throw validationError('QUESTION_SOURCES_INVALID', 'Question sources is invalid');
    dto.sources = (input.sources as DynamicSources).map(buildQuestionSourceDto);
  }
  return dto;
}

export function buildQuestionSourceDto<Input extends QuestionSourceDtoInput>(input: Input): QuestionSourceDto<Input>;
export function buildQuestionSourceDto(input?: QuestionSourceDtoInput): QuestionSourceDto;
export function buildQuestionSourceDto(input: QuestionSourceDtoInput = {}): QuestionSourceDto {
  const sourceType = input.sourceType ?? 'manual';
  if (!(QUESTION_SOURCE_TYPES as readonly unknown[]).includes(sourceType))
    throw validationError('QUESTION_SOURCE_TYPE_INVALID', 'QuestionSource sourceType is invalid');
  return {
    id:
      input.id === undefined
        ? createPrefixedId('question-source')
        : requireText(input.id, 'QUESTION_SOURCE_ID_INVALID', 'QuestionSource id is invalid'),
    sourceType,
    sourceId: optionalText(input.sourceId, 'QUESTION_SOURCE_ID_INVALID', 'QuestionSource sourceId is invalid'),
    quote: optionalText(input.quote, 'QUESTION_SOURCE_QUOTE_INVALID', 'QuestionSource quote is invalid') ?? '',
    locator: optionalJsonObject(input.locator, 'QUESTION_SOURCE_LOCATOR_INVALID', 'QuestionSource locator is invalid'),
    contentHash: optionalText(
      input.contentHash,
      'QUESTION_SOURCE_HASH_INVALID',
      'QuestionSource contentHash is invalid'
    )
  };
}

function cloneQuestionOptions(value: unknown): unknown[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw validationError('QUESTION_OPTIONS_INVALID', 'Question options must be an array or null');
  }
  return structuredClone(value);
}
