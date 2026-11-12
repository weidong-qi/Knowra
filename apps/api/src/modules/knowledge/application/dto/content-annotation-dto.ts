import { validationError } from '../knowledge-errors.ts';

export interface AnnotationDtoInput {
  spaceId?: unknown;
  noteId?: unknown;
  noteVersionId?: unknown;
  quoteText?: unknown;
  headingPath?: unknown;
  prefixText?: unknown;
  suffixText?: unknown;
  anchorFingerprint?: unknown;
  noteContentHash?: unknown;
  idempotencyKey?: unknown;
  kind?: unknown;
  sourceMode?: unknown;
  schemaVersion?: unknown;
  scopeType?: unknown;
  importance?: unknown;
  comment?: unknown;
  anchor?: unknown;
  fromPosition?: unknown;
  toPosition?: unknown;
  expectedRevision?: unknown;
}
interface DynamicHeadingPath {
  map(callback: (item: unknown) => string): { filter(callback: typeof Boolean): unknown };
}
interface AnchorScopeView {
  scopeType?: unknown;
}
export type CreateContentAnnotationDto = ReturnType<typeof buildCreateContentAnnotationDto>;
export type UpdateAnnotationAnchorDto = ReturnType<typeof buildUpdateAnnotationAnchorDto>;

const annotationKinds = new Set<unknown>(['important', 'question', 'supplement', 'pitfall', 'temporary']);
const sourceModes = new Set<unknown>(['manual', 'ai']);
const scopeTypes = new Set<unknown>(['selection', 'blocks', 'section', 'list']);
const importanceLevels = new Set<unknown>([null, 'normal', 'important', 'core']);

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function quote(value: unknown, versioned: boolean) {
  return typeof value === 'string' ? (versioned ? value : value.trim()) : '';
}

function positions(input: Pick<AnnotationDtoInput, 'fromPosition' | 'toPosition'>) {
  const fromPosition = Number(input.fromPosition);
  const toPosition = Number(input.toPosition);
  if (
    !Number.isInteger(fromPosition) ||
    !Number.isInteger(toPosition) ||
    fromPosition < 0 ||
    fromPosition >= toPosition
  ) {
    throw validationError('ANNOTATION_RANGE_INVALID', 'Annotation range is invalid');
  }
  return { fromPosition, toPosition };
}

export function buildCreateContentAnnotationDto(input: AnnotationDtoInput = {}) {
  const schemaVersion = Number(input.schemaVersion ?? (input.anchor ? 2 : 1));
  const dto = {
    spaceId: text(input.spaceId),
    noteId: text(input.noteId),
    noteVersionId: text(input.noteVersionId) || null,
    quoteText: quote(input.quoteText, schemaVersion === 2),
    headingPath: Array.isArray(input.headingPath)
      ? (input.headingPath as DynamicHeadingPath).map(text).filter(Boolean)
      : [],
    prefixText: text(input.prefixText),
    suffixText: text(input.suffixText),
    anchorFingerprint: text(input.anchorFingerprint),
    noteContentHash: text(input.noteContentHash),
    idempotencyKey: text(input.idempotencyKey),
    kind: input.kind ?? 'important',
    sourceMode: input.sourceMode ?? 'manual',
    schemaVersion,
    scopeType: input.scopeType ?? (input.anchor as AnchorScopeView | null | undefined)?.scopeType ?? 'selection',
    importance: input.importance === undefined ? 'normal' : input.importance,
    comment: typeof input.comment === 'string' ? (input.comment as unknown) : '',
    anchor:
      input.anchor && typeof input.anchor === 'object' && !Array.isArray(input.anchor)
        ? structuredClone(input.anchor as unknown)
        : null,
    ...positions(input)
  };
  if (
    !dto.spaceId ||
    !dto.noteId ||
    !dto.quoteText.trim() ||
    !dto.anchorFingerprint ||
    !dto.noteContentHash ||
    !dto.idempotencyKey
  ) {
    throw validationError('ANNOTATION_FIELDS_REQUIRED', 'Annotation creation fields are required');
  }
  if (!annotationKinds.has(dto.kind) || !sourceModes.has(dto.sourceMode)) {
    throw validationError('ANNOTATION_TYPE_INVALID', 'Annotation kind or sourceMode is invalid');
  }
  if (![1, 2].includes(dto.schemaVersion) || !scopeTypes.has(dto.scopeType) || !importanceLevels.has(dto.importance)) {
    throw validationError('ANNOTATION_SCHEMA_INVALID', 'Annotation schema, scope or importance is invalid');
  }
  if ((dto.comment as { length: number }).length > 2000)
    throw validationError('ANNOTATION_COMMENT_TOO_LONG', 'Annotation comment is too long');
  if (dto.schemaVersion === 2 && !dto.anchor) {
    throw validationError('ANNOTATION_ANCHOR_FIELDS_REQUIRED', 'Versioned annotation anchor is required');
  }
  if (dto.anchor && dto.scopeType !== (dto.anchor as AnchorScopeView).scopeType)
    throw validationError('ANNOTATION_RANGE_INVALID', '标注类型与锚点不一致');
  if (dto.scopeType === 'list' && dto.schemaVersion !== 2)
    throw validationError('ANNOTATION_ANCHOR_FIELDS_REQUIRED', '列表标记需要版本化锚点');
  return dto;
}

export function buildUpdateAnnotationAnchorDto(input: AnnotationDtoInput = {}) {
  const dto = {
    quoteText: quote(input.quoteText, Boolean(input.anchor)),
    prefixText: text(input.prefixText),
    suffixText: text(input.suffixText),
    anchorFingerprint: text(input.anchorFingerprint),
    noteContentHash: text(input.noteContentHash),
    headingPath: Array.isArray(input.headingPath)
      ? (input.headingPath as DynamicHeadingPath).map(text).filter(Boolean)
      : [],
    anchor:
      input.anchor && typeof input.anchor === 'object' && !Array.isArray(input.anchor)
        ? structuredClone(input.anchor as unknown)
        : null,
    expectedRevision: Number(input.expectedRevision),
    ...positions(input)
  };
  if (!dto.quoteText.trim() || !dto.anchorFingerprint || !dto.noteContentHash) {
    throw validationError('ANNOTATION_ANCHOR_FIELDS_REQUIRED', 'Annotation anchor fields are required');
  }
  return dto;
}

export function buildUpdateContentAnnotationDto(input: AnnotationDtoInput = {}) {
  const dto = {
    expectedRevision: Number(input.expectedRevision),
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.importance !== undefined ? { importance: input.importance } : {}),
    ...(input.comment !== undefined ? { comment: String(input.comment) } : {})
  };
  if (!Number.isInteger(dto.expectedRevision) || dto.expectedRevision < 1) {
    throw validationError('ANNOTATION_REVISION_REQUIRED', 'Annotation revision is required');
  }
  if (dto.kind !== undefined && !annotationKinds.has(dto.kind))
    throw validationError('ANNOTATION_TYPE_INVALID', 'Annotation kind is invalid');
  if (dto.importance !== undefined && !importanceLevels.has(dto.importance))
    throw validationError('ANNOTATION_IMPORTANCE_INVALID', 'Annotation importance is invalid');
  if (dto.comment !== undefined && dto.comment.length > 2000)
    throw validationError('ANNOTATION_COMMENT_TOO_LONG', 'Annotation comment is too long');
  return dto;
}
