import { createPrefixedId, requireText } from './_shared.js';
import { validationError } from '../knowledge-errors.js';

export interface KnowledgeItemDtoInput {
  id?: unknown;
  title?: unknown;
  canonicalStatement?: unknown;
  userExplanation?: unknown;
  knowledgeType?: unknown;
  importance?: unknown;
  sourceMode?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CreateKnowledgeItemDto {
  id: string;
  title: string;
  canonicalStatement: string;
  userExplanation: string;
  knowledgeType: unknown;
  importance: number | null;
  sourceMode: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface UpdateKnowledgeItemDto {
  title?: unknown;
  canonicalStatement?: unknown;
  userExplanation?: unknown;
  knowledgeType?: unknown;
  importance?: number | null;
  sourceMode?: unknown;
}

export interface KnowledgeEvidenceDtoInput {
  id?: unknown;
  sourceType?: unknown;
  sourceId?: unknown;
  noteId?: unknown;
  noteVersionId?: unknown;
  annotationId?: unknown;
  expectedAnnotationRevision?: unknown;
  quoteText?: unknown;
  headingPath?: unknown;
  relationType?: unknown;
}

export interface CreateKnowledgeEvidenceDto {
  expectedAnnotationRevision: unknown;
  id: string;
  sourceType: unknown;
  sourceId: string | null;
  noteId: string | null;
  noteVersionId: string | null;
  annotationId: string | null;
  quoteText: unknown;
  headingPath: unknown;
  relationType: unknown;
}

type TextField = 'title' | 'canonicalStatement' | 'userExplanation';
// 只描述旧表达式执行的操作，不承诺第三次 getter 或自定义方法的返回类型。
interface DynamicTrim {
  trim: () => unknown;
}
interface DynamicHeadingPath {
  map: (callback: (item: unknown) => string) => { filter: (callback: typeof Boolean) => unknown };
}

// Set.has 动态读取，只保留旧成员测试，不将输入收窄成枚举。
const KNOWLEDGE_TYPES = new Set<unknown>([
  'concept',
  'fact',
  'principle',
  'process',
  'algorithm',
  'formula',
  'comparison',
  'application'
]);
const SOURCE_MODES = new Set<unknown>(['manual', 'annotation', 'selection', 'ai']);
const SOURCE_TYPES = new Set<unknown>(['noteVersion', 'annotation', 'manual']);

function text(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function optionalText(value: unknown, code: string, message: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw validationError(code, message);
  return value.trim() || null;
}

export function buildCreateKnowledgeItemDto<Input extends KnowledgeItemDtoInput>(
  input: Input
): Omit<CreateKnowledgeItemDto, 'knowledgeType' | 'sourceMode' | 'createdAt' | 'updatedAt'> & {
  knowledgeType: NonNullable<Input['knowledgeType']> | 'concept';
  sourceMode: NonNullable<Input['sourceMode']> | 'manual';
  createdAt: Input['createdAt'];
  updatedAt: Input['updatedAt'];
};
export function buildCreateKnowledgeItemDto(input?: KnowledgeItemDtoInput): CreateKnowledgeItemDto;
export function buildCreateKnowledgeItemDto(input: KnowledgeItemDtoInput = {}): CreateKnowledgeItemDto {
  const title = optionalText(input.title, 'KNOWLEDGE_ITEM_TITLE_INVALID', 'KnowledgeItem title is invalid') ?? '';
  const canonicalStatement =
    optionalText(
      input.canonicalStatement,
      'KNOWLEDGE_ITEM_STATEMENT_INVALID',
      'KnowledgeItem canonicalStatement is invalid'
    ) ?? '';
  const knowledgeType = input.knowledgeType ?? 'concept';
  const sourceMode = input.sourceMode ?? 'manual';
  if (!KNOWLEDGE_TYPES.has(knowledgeType)) {
    throw validationError('KNOWLEDGE_ITEM_TYPE_INVALID', 'KnowledgeItem knowledgeType is invalid');
  }
  if (!SOURCE_MODES.has(sourceMode)) {
    throw validationError('KNOWLEDGE_ITEM_SOURCE_MODE_INVALID', 'KnowledgeItem sourceMode is invalid');
  }
  if (input.importance !== undefined && input.importance !== null && !Number.isFinite(Number(input.importance))) {
    throw validationError('KNOWLEDGE_ITEM_IMPORTANCE_INVALID', 'KnowledgeItem importance is invalid');
  }
  return {
    id:
      input.id === undefined
        ? createPrefixedId('knowledge', title || 'item')
        : requireText(input.id, 'KNOWLEDGE_ITEM_ID_INVALID', 'KnowledgeItem id is invalid'),
    title,
    canonicalStatement,
    userExplanation:
      optionalText(
        input.userExplanation,
        'KNOWLEDGE_ITEM_EXPLANATION_INVALID',
        'KnowledgeItem userExplanation is invalid'
      ) ?? '',
    knowledgeType,
    importance: input.importance === undefined || input.importance === null ? null : Number(input.importance),
    sourceMode,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

export function buildUpdateKnowledgeItemDto(input: KnowledgeItemDtoInput = {}): UpdateKnowledgeItemDto {
  const dto: UpdateKnowledgeItemDto = {};
  for (const field of ['title', 'canonicalStatement', 'userExplanation'] satisfies TextField[]) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== 'string') {
        throw validationError('KNOWLEDGE_ITEM_TEXT_INVALID', `KnowledgeItem ${field} is invalid`);
      }
      dto[field] = (input[field] as DynamicTrim).trim();
    }
  }
  if (input.knowledgeType !== undefined) {
    if (!KNOWLEDGE_TYPES.has(input.knowledgeType)) {
      throw validationError('KNOWLEDGE_ITEM_TYPE_INVALID', 'KnowledgeItem knowledgeType is invalid');
    }
    dto.knowledgeType = input.knowledgeType;
  }
  if (input.importance !== undefined) {
    if (input.importance !== null && !Number.isFinite(Number(input.importance))) {
      throw validationError('KNOWLEDGE_ITEM_IMPORTANCE_INVALID', 'KnowledgeItem importance is invalid');
    }
    dto.importance = input.importance === null ? null : Number(input.importance);
  }
  if (input.sourceMode !== undefined) {
    if (!SOURCE_MODES.has(input.sourceMode)) {
      throw validationError('KNOWLEDGE_ITEM_SOURCE_MODE_INVALID', 'KnowledgeItem sourceMode is invalid');
    }
    dto.sourceMode = input.sourceMode;
  }
  return dto;
}

export function buildCreateKnowledgeEvidenceDto<Input extends KnowledgeEvidenceDtoInput>(
  input: Input
): Omit<CreateKnowledgeEvidenceDto, 'sourceType' | 'relationType'> & {
  sourceType: NonNullable<Input['sourceType']> | 'manual';
  relationType: NonNullable<Input['relationType']> | 'supports';
};
export function buildCreateKnowledgeEvidenceDto(input?: KnowledgeEvidenceDtoInput): CreateKnowledgeEvidenceDto;
export function buildCreateKnowledgeEvidenceDto(input: KnowledgeEvidenceDtoInput = {}): CreateKnowledgeEvidenceDto {
  const sourceType = input.sourceType ?? 'manual';
  if (!SOURCE_TYPES.has(sourceType)) {
    throw validationError('KNOWLEDGE_EVIDENCE_SOURCE_TYPE_INVALID', 'KnowledgeEvidence sourceType is invalid');
  }
  const sourceId = optionalText(
    input.sourceId,
    'KNOWLEDGE_EVIDENCE_SOURCE_ID_INVALID',
    'KnowledgeEvidence sourceId is invalid'
  );
  const noteId = optionalText(
    input.noteId,
    'KNOWLEDGE_EVIDENCE_NOTE_ID_INVALID',
    'KnowledgeEvidence noteId is invalid'
  );
  const noteVersionId = optionalText(
    input.noteVersionId,
    'KNOWLEDGE_EVIDENCE_VERSION_ID_INVALID',
    'KnowledgeEvidence noteVersionId is invalid'
  );
  const annotationId = optionalText(
    input.annotationId,
    'KNOWLEDGE_EVIDENCE_ANNOTATION_ID_INVALID',
    'KnowledgeEvidence annotationId is invalid'
  );
  if (sourceType === 'noteVersion' && !noteVersionId) {
    throw validationError('KNOWLEDGE_EVIDENCE_VERSION_REQUIRED', 'NoteVersion evidence requires noteVersionId');
  }
  if (sourceType === 'annotation' && !annotationId) {
    throw validationError('KNOWLEDGE_EVIDENCE_ANNOTATION_REQUIRED', 'Annotation evidence requires annotationId');
  }
  if (sourceType === 'manual' && (noteVersionId || annotationId)) {
    throw validationError(
      'KNOWLEDGE_EVIDENCE_MANUAL_SOURCE_INVALID',
      'Manual evidence cannot reference a NoteVersion or annotation'
    );
  }
  // 比较点视图不验证本次重读；保留原生 < 对 BigInt、Symbol、对象的转换或异常。
  if (
    input.expectedAnnotationRevision !== undefined &&
    (!Number.isInteger(input.expectedAnnotationRevision) || (input.expectedAnnotationRevision as number) < 1)
  ) {
    throw validationError('KNOWLEDGE_EVIDENCE_REVISION_INVALID', '标注来源修订号无效，请重新加载标注。');
  }
  return {
    expectedAnnotationRevision: input.expectedAnnotationRevision,
    id:
      input.id === undefined
        ? createPrefixedId('evidence')
        : requireText(input.id, 'KNOWLEDGE_EVIDENCE_ID_INVALID', 'KnowledgeEvidence id is invalid'),
    sourceType,
    sourceId,
    noteId,
    noteVersionId,
    annotationId,
    quoteText: text(input.quoteText) ?? '',
    headingPath: Array.isArray(input.headingPath)
      ? (input.headingPath as DynamicHeadingPath).map(item => String(item).trim()).filter(Boolean)
      : [],
    relationType: input.relationType ?? 'supports'
  };
}
