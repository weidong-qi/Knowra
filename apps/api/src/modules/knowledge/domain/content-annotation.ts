import type { AnnotationScopeType, ContentAnchor, IdentityBinding } from '@study-accelerator/content-anchor';

export type ContentAnnotationKind = 'important' | 'question' | 'supplement' | 'pitfall' | 'temporary';
export type ContentAnnotationSourceMode = 'manual' | 'ai';
export type ContentAnnotationStatus = 'active' | 'stale' | 'archived';
export type ContentAnnotationLifecycleStatus = 'active' | 'archived' | 'deleted';
export type ContentAnnotationAnchorStatus = 'resolved' | 'needsReview' | 'missing';
export type ContentAnnotationImportance = 'normal' | 'important' | 'core' | null;
export type ContentAnnotationSchemaVersion = 1 | 2 | 3;

/** 支持旧版局部锚点和 v3 内联元数据；构造器不验证完整的 ContentAnchor。 */
export interface ContentAnnotationAnchor extends Partial<ContentAnchor> {
  noteVersionId?: string | null;
  format?: string;
  markId?: string;
  roles?: string[];
}
interface AnchorConstructorView {
  tracking?: { empty?: unknown };
  format?: unknown;
  markId?: unknown;
}

export interface ContentAnnotationOriginSnapshot {
  noteVersionId: string | null;
  contentHash: string;
  scopeType: unknown;
  segments: unknown;
  quoteText: string;
  headingPath: unknown;
}

/** 受支持的调用契约，不代表 JavaScript 运行时所有能通过校验的输入。 */
export interface ContentAnnotationConstructorInput<
  Kind = string,
  SourceMode = string,
  ScopeType = string,
  Importance = string | null,
  HeadingPath = string[],
  Anchor = ContentAnnotationAnchor
> {
  id: string;
  spaceId: string;
  noteId: string;
  noteVersionId?: string | null;
  kind?: Kind | string;
  sourceMode?: SourceMode | string;
  quoteText: string;
  headingPath?: HeadingPath | string[];
  fromPosition: number;
  toPosition: number;
  prefixText?: string;
  suffixText?: string;
  anchorFingerprint: string;
  noteContentHash: string;
  idempotencyKey: string;
  status?: string;
  schemaVersion?: number;
  scopeType?: ScopeType | string;
  importance?: Importance | string | null;
  comment?: unknown;
  lifecycleStatus?: string;
  anchorStatus?: string;
  anchorReason?: string | null;
  revision?: number;
  anchor?: Anchor | ContentAnnotationAnchor | null;
  originSnapshot?: Partial<ContentAnnotationOriginSnapshot> | null;
  identityBinding?: IdentityBinding | null;
  resolvedContentHash?: string | null;
  boundaryFingerprint?: string | null;
  requestHash?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
}

const ANNOTATION_KINDS = new Set(['important', 'question', 'supplement', 'pitfall', 'temporary']);
const SOURCE_MODES = new Set(['manual', 'ai']);
const ANNOTATION_STATUSES = new Set(['active', 'stale', 'archived']);
const SCOPE_TYPES = new Set(['selection', 'blocks', 'section', 'list']);
const IMPORTANCE_LEVELS = new Set([null, 'normal', 'important', 'core']);
const LIFECYCLE_STATUSES = new Set(['active', 'archived', 'deleted']);
const ANCHOR_STATUSES = new Set(['resolved', 'needsReview', 'missing']);
/** 重点内联化：位置写在正文标记里（《重点标记内联化方案》），这一行只存元数据与派生缓存。 */
export const INLINE_ANNOTATION_SCHEMA = 3;
export const INLINE_ANCHOR_FORMAT = 'knowra-inline';

export function projectLegacyAnnotationStatus({
  lifecycleStatus,
  anchorStatus
}: {
  lifecycleStatus: string;
  anchorStatus: string;
}): ContentAnnotationStatus {
  if (lifecycleStatus === 'archived' || lifecycleStatus === 'deleted') return 'archived';
  return anchorStatus === 'resolved' ? 'active' : 'stale';
}

export class ContentAnnotation<
  Kind = string,
  SourceMode = string,
  ScopeType = string,
  Importance = string | null,
  HeadingPath = string[],
  Anchor = ContentAnnotationAnchor
> {
  declare id: string;
  declare spaceId: string;
  declare noteId: string;
  declare noteVersionId: string | null;
  declare kind: Exclude<Kind, string | undefined> | ContentAnnotationKind;
  declare sourceMode: Exclude<SourceMode, string | undefined> | ContentAnnotationSourceMode;
  declare quoteText: string;
  declare headingPath: (HeadingPath extends Iterable<infer Item> ? Item[] : unknown[]) | string[];
  declare fromPosition: number;
  declare toPosition: number;
  declare prefixText: string;
  declare suffixText: string;
  declare anchorFingerprint: string;
  declare noteContentHash: string;
  declare idempotencyKey: string;
  declare schemaVersion: ContentAnnotationSchemaVersion;
  declare scopeType: Exclude<ScopeType, string | undefined> | AnnotationScopeType;
  declare importance: Exclude<Importance, string | null | undefined> | ContentAnnotationImportance;
  declare comment: string;
  declare lifecycleStatus: ContentAnnotationLifecycleStatus;
  declare anchorStatus: ContentAnnotationAnchorStatus;
  declare anchorReason: string | null;
  declare revision: number;
  declare anchor: Exclude<Anchor, undefined> | ContentAnnotationAnchor | null;
  // 仅检查真值并克隆，不能据此保证快照字段完整。
  declare originSnapshot: Partial<ContentAnnotationOriginSnapshot> | null;
  declare identityBinding: IdentityBinding | null;
  declare resolvedContentHash: string | null;
  declare boundaryFingerprint: string | null;
  declare requestHash: string | null;
  declare status: ContentAnnotationStatus;
  declare createdAt: string | null;
  declare updatedAt: string | null;
  declare deletedAt: string | null;

  constructor({
    id,
    spaceId,
    noteId,
    noteVersionId = null,
    kind = 'important',
    sourceMode = 'manual',
    quoteText,
    headingPath = [],
    fromPosition,
    toPosition,
    prefixText = '',
    suffixText = '',
    anchorFingerprint,
    noteContentHash,
    idempotencyKey,
    status = 'active',
    schemaVersion = 1,
    scopeType = 'selection',
    importance = null,
    comment = '',
    lifecycleStatus = status === 'archived' ? 'archived' : 'active',
    anchorStatus = status === 'stale' ? 'needsReview' : 'resolved',
    anchorReason = null,
    revision = 1,
    anchor = null,
    originSnapshot = null,
    identityBinding = null,
    resolvedContentHash = null,
    boundaryFingerprint = null,
    requestHash = null,
    createdAt = new Date().toISOString(),
    updatedAt = createdAt,
    deletedAt = null
  }: ContentAnnotationConstructorInput<Kind, SourceMode, ScopeType, Importance, HeadingPath, Anchor>) {
    if (!id?.trim() || !spaceId?.trim() || !noteId?.trim()) throw new Error('Annotation identity is required');
    if (
      !(ANNOTATION_KINDS as ReadonlySet<unknown>).has(kind) ||
      !(SOURCE_MODES as ReadonlySet<unknown>).has(sourceMode)
    )
      throw new Error('Annotation kind or sourceMode is invalid');
    if (
      !(SCOPE_TYPES as ReadonlySet<unknown>).has(scopeType) ||
      !(IMPORTANCE_LEVELS as ReadonlySet<unknown>).has(importance)
    )
      throw new Error('Annotation scope or importance is invalid');
    if (!LIFECYCLE_STATUSES.has(lifecycleStatus) || !ANCHOR_STATUSES.has(anchorStatus))
      throw new Error('Annotation lifecycle or anchor status is invalid');
    if (![1, 2, INLINE_ANNOTATION_SCHEMA].includes(schemaVersion) || !Number.isInteger(revision) || revision < 1)
      throw new Error('Annotation schema or revision is invalid');
    if (typeof comment !== 'string' || comment.length > 2000) throw new Error('Annotation comment is invalid');
    if (
      typeof quoteText !== 'string' ||
      (!quoteText.trim() && !(anchor as AnchorConstructorView | null)?.tracking?.empty) ||
      !anchorFingerprint?.trim() ||
      !noteContentHash?.trim() ||
      !idempotencyKey?.trim()
    )
      throw new Error('Annotation content is required');
    if (
      !Number.isInteger(fromPosition) ||
      !Number.isInteger(toPosition) ||
      fromPosition < 0 ||
      (fromPosition >= toPosition && !(anchor as AnchorConstructorView | null)?.tracking?.empty)
    )
      throw new Error('Annotation range is invalid');
    if (!ANNOTATION_STATUSES.has(status)) throw new Error('Annotation status is invalid');
    if (schemaVersion === 2 && (!anchor || !originSnapshot)) throw new Error('Versioned annotation anchor is required');
    if (
      schemaVersion === INLINE_ANNOTATION_SCHEMA &&
      ((anchor as AnchorConstructorView | null)?.format !== INLINE_ANCHOR_FORMAT ||
        typeof (anchor as AnchorConstructorView).markId !== 'string' ||
        !originSnapshot)
    )
      throw new Error('Inline annotation anchor is required');

    Object.assign(this, {
      id,
      spaceId,
      noteId,
      noteVersionId,
      kind,
      sourceMode,
      quoteText: schemaVersion === 1 ? quoteText.trim() : quoteText,
      headingPath: [...(headingPath as Iterable<unknown>)],
      fromPosition,
      toPosition,
      prefixText,
      suffixText,
      anchorFingerprint,
      noteContentHash,
      idempotencyKey,
      schemaVersion,
      scopeType,
      importance,
      comment,
      lifecycleStatus,
      anchorStatus,
      anchorReason,
      revision,
      anchor: anchor ? structuredClone(anchor) : null,
      originSnapshot: originSnapshot ? structuredClone(originSnapshot) : null,
      // 稳定身份迁移 S2b-2：以块身份表 ID 描述的重点位置；影子阶段只记录，不参与状态判断。
      identityBinding: identityBinding ? structuredClone(identityBinding) : null,
      resolvedContentHash,
      boundaryFingerprint,
      requestHash,
      status: projectLegacyAnnotationStatus({ lifecycleStatus, anchorStatus }),
      createdAt,
      updatedAt,
      deletedAt
    });
  }
}
