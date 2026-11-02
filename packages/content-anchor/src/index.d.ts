export type AnnotationScopeType = 'selection' | 'blocks' | 'section' | 'list';
export interface NoteLinkLocator {
  targetNoteId: string;
  occurrenceId: string;
}
export interface NoteLinkOccurrence extends NoteLinkLocator {
  url: string;
  sourceStart: number;
  sourceEnd: number;
  label: string;
  context: string;
}
export function parseNoteLinkUrl(url: unknown): NoteLinkLocator | null;
export function createNoteLinkUrl(targetNoteId: string, occurrenceId: string): string;
export function extractNoteLinks(markdown: string): { targetIds: string[]; occurrences: NoteLinkOccurrence[] };
export function resolveNoteLinkOccurrence(markdown: string, locator: NoteLinkLocator): NoteLinkOccurrence | null;
export interface AnchorSegment {
  start: number;
  end: number;
  path: string;
}
export interface ContentAnchor {
  tracking?: {
    formatVersion?: number;
    empty?: boolean;
    emptyPosition?: number;
    emptyType?: string;
    [key: string]: unknown;
  };
  pending?: { anchor: ContentAnchor; contentHash: string; reason: string } | null;
  projectionVersion: number;
  scopeType: AnnotationScopeType;
  segments: AnchorSegment[];
  structurePath: string | null;
  quoteText: string;
  prefixText: string;
  suffixText: string;
  sourceStart: number;
  sourceEnd: number;
  projectedStart: number;
  projectedEnd: number;
  list?: {
    itemPath: string;
    parentItemPath: string | null;
    depth: number;
    ordered: boolean;
    childCount: number;
    memberFingerprint: string;
  };
  section?: {
    headingLevel: number;
    title: string;
    sourceStart: number;
    sourceEnd: number;
    endBoundaryPath: string | null;
    endBoundaryLevel: number | null;
    endBoundaryTitle: string | null;
    memberFingerprint: string;
  };
}
export interface ListItemProjection {
  path: string;
  parentListPath: string;
  parentItemPath: string | null;
  depth: number;
  ordered: boolean;
  task: boolean;
  sourceStart: number;
  sourceEnd: number;
}
export interface MarkdownProjection {
  listItems: ListItemProjection[];
  version: number;
  source: string;
  contentHash: string;
  text: string;
  units: Array<{
    text: string;
    sourceStart: number | null;
    sourceEnd: number | null;
    projectedStart: number;
    projectedEnd: number;
    path: string;
    atomic?: boolean;
  }>;
  blocks: Array<{ sourceStart: number; sourceEnd: number; path: string; type: string }>;
  headings: Array<{ sourceStart: number; sourceEnd: number; path: string; level: number; title: string }>;
  sections: Array<{ sourceStart: number; sourceEnd: number; path: string; level: number; title: string }>;
}
export const MARKDOWN_PROJECTION_VERSION: number;
export function calculateContentHash(markdown: string): string;
export function projectMarkdown(markdown: string, options?: { includeMath?: boolean }): MarkdownProjection;
export function anchorFromProjectedRange(
  projection: MarkdownProjection,
  start: number,
  end: number,
  options?: { scopeType?: AnnotationScopeType; structurePath?: string }
): ContentAnchor;
export function anchorForSourceRange(
  projection: MarkdownProjection,
  start: number,
  end: number,
  options?: { scopeType?: AnnotationScopeType; structurePath?: string }
): ContentAnchor;
export function anchorForBlock(projection: MarkdownProjection, blockIndex: number): ContentAnchor;
export function anchorForSection(projection: MarkdownProjection, headingIndex: number): ContentAnchor;
export function resolveAnchor(
  markdown: string,
  anchor: ContentAnchor
): {
  status: 'resolved' | 'needsReview' | 'missing';
  reason: string | null;
  anchor?: ContentAnchor;
  projection: MarkdownProjection;
  quoteText?: string;
  segments?: AnchorSegment[];
};
export function relocateAnchor(
  markdown: string,
  anchor: ContentAnchor
): ReturnType<typeof resolveAnchor> & { candidates?: ContentAnchor[] };
export function followSectionAnchor(markdown: string, anchor: ContentAnchor): ReturnType<typeof resolveAnchor>;
export function headingPathForSourceOffset(projection: MarkdownProjection, sourceOffset: number): string[];

export interface SourceEdit {
  from: number;
  to: number;
  text: string;
  history?: boolean;
  moveId?: string;
  moveKind?: 'cut' | 'paste';
  preserveEmptyBlock?: boolean;
  deletedEmptyAnnotationIds?: string[];
}
export interface AnnotationMapping {
  formatVersion: 1;
  operationId: string;
  baseContentHash: string;
  targetContentHash: string;
  baseStructureRevision?: number;
  edits: SourceEdit[];
  editorState?: IdentityEditorState;
}

/** 稳定身份迁移影子阶段：编辑器在保存时上报的身份视角快照。 */
export interface IdentityEditorBlock {
  id: string;
  type: string;
  empty: boolean;
}
/** 块内位置：offset 为编辑器内容偏移；表格内附带单元格 [行, 列]。 */
export interface IdentityPoint {
  blockId: string;
  offset: number;
  cell?: [number, number];
}
export interface IdentityEditorAnnotation {
  id: string;
  scopeType: AnnotationScopeType;
  present: boolean;
  rootBlockId?: string;
  startBlockId?: string;
  endBlockId?: string;
  quoteHash?: string;
  start?: IdentityPoint;
  end?: IdentityPoint;
}
export interface IdentityEditorState {
  formatVersion: 2;
  targetContentHash: string;
  blocks: IdentityEditorBlock[];
  annotations: IdentityEditorAnnotation[];
}
export type IdentityShadowDivergenceKind =
  'trackedLost' | 'oldNeedsReview' | 'identityLost' | 'blockMismatch' | 'quoteMismatch';
export interface IdentityShadowDivergence {
  annotationId: string;
  scopeType: AnnotationScopeType;
  kind: IdentityShadowDivergenceKind;
  oldStatus: string | null;
  oldReason: string | null;
}
export interface IdentityShadowResult {
  status: 'compared' | 'invalidState' | 'stateMismatch' | 'alignFailed';
  compared: number;
  divergences: IdentityShadowDivergence[];
  alignment?: { editorIndex: number; markdownIndex: number; editorType: string | null; markdownType: string | null };
}
export const IDENTITY_SHADOW_FORMAT: 2;
export const EDITOR_TO_MARKDOWN_BLOCK: Readonly<Record<string, string>>;
export function parseIdentityBlocks(
  markdown: string,
  options?: { includeContent?: boolean }
): Array<{
  type: string;
  depth: number;
  sourceStart: number;
  sourceEnd: number;
  br: boolean;
  value?: string;
  level?: number;
  containerEnd?: number;
}>;
export function alignIdentityBlocks(
  markdownBlocks: ReturnType<typeof parseIdentityBlocks>,
  editorBlocks: IdentityEditorBlock[]
):
  | { aligned: true; pairs: Map<number, number> }
  | {
      aligned: false;
      editorIndex: number;
      markdownIndex: number;
      editorType: string | null;
      markdownType: string | null;
    };
export function validIdentityEditorState(state: unknown): state is IdentityEditorState;
export function identityQuoteHash(value: string | null | undefined): string;
/** 块身份表：按 parseIdentityBlocks 顺序记录每个 Markdown 块的编辑器 ID，存放在 annotationStructure.identity。 */
export interface IdentityTable {
  formatVersion: 2;
  contentHash: string;
  blocks: Array<{ id: string; type: string }>;
}
export function identityFromEditorState(markdown: string, editorState: unknown): IdentityTable | null;
export function validIdentityTable(markdown: string, identity: unknown): identity is IdentityTable;
export function adoptIdentityIds(
  markdown: string,
  identity: unknown,
  editorBlocks: IdentityEditorBlock[]
): Map<number, string> | null;
export interface IdentitySourceAnnotation {
  id?: string;
  scopeType?: string;
  anchorStatus?: string;
  anchorReason?: string | null;
  lifecycleStatus?: string;
  anchor?: Partial<Pick<ContentAnchor, 'sourceStart' | 'sourceEnd' | 'quoteText'>> | null;
  fromPosition?: number;
  toPosition?: number;
  quoteText?: string;
}
export function compareIdentityShadow(input: {
  markdown: string;
  editorState: unknown;
  annotations: IdentitySourceAnnotation[];
}): IdentityShadowResult;
export interface AnnotationStructure {
  formatVersion: 1;
  revision: number;
  contentHash: string;
  nodes: Array<{ id: string; path: string; type: string; sourceStart: number; sourceEnd: number }>;
  identity?: IdentityTable;
}
export function sourceEdit(before: string, after: string): SourceEdit;
export function applySourceEdit(source: string, edit: SourceEdit): string;
export function verifiedSourceEdits(before: string, after: string, mapping?: AnnotationMapping): SourceEdit[] | null;
export function followAnchorChanges(
  before: string,
  after: string,
  anchor: ContentAnchor,
  edits?: SourceEdit[] | null
): ReturnType<typeof resolveAnchor>;
export function updateStructure(
  before: string,
  after: string,
  previous?: AnnotationStructure | null,
  edits?: SourceEdit[] | null
): AnnotationStructure;
export function sourceEdits(before: string, after: string): SourceEdit[];

export function anchorForListItem(
  projection: MarkdownProjection,
  itemPath: string,
  allowEmpty?: boolean
): ContentAnchor;
export function followListAnchor(markdown: string, anchor: ContentAnchor): ReturnType<typeof resolveAnchor>;
export function listTracking(
  projection: MarkdownProjection,
  anchor: ContentAnchor,
  structure?: AnnotationStructure | null
): NonNullable<ContentAnchor['tracking']>;
export function followListAnchorChanges(
  before: string,
  after: string,
  anchor: ContentAnchor,
  edits?: SourceEdit[] | null,
  structures?: { before?: AnnotationStructure | null; after?: AnnotationStructure | null }
): ReturnType<typeof resolveAnchor>;

/** 块内偏移模型：与 parseIdentityBlocks 同序，非文本块为 null。 */
export interface InlineOffsetModel {
  size: number;
  start: Array<number | null>;
  end: Array<number | null>;
}
export type IdentityBlockModel =
  | InlineOffsetModel
  | { kind: 'table'; rows: Array<Array<(InlineOffsetModel & { from: number; to: number }) | null>> }
  | null;
export function identityBlockModels(markdown: string): IdentityBlockModel[];
export function blockOffsetToSource(
  model: IdentityBlockModel,
  point: { offset: number; cell?: [number, number] },
  edge: 'start' | 'end'
): number | null;
export function sourceToBlockOffset(
  model: IdentityBlockModel,
  sourceOffset: number,
  edge: 'start' | 'end',
  cell?: [number, number]
): number | null;

/** 重点绑定：以块身份表中的 ID 描述重点位置。 */
export type IdentityBinding = { formatVersion: 2; contentHash: string } & (
  | { scopeType: 'selection'; start: IdentityPoint; end: IdentityPoint }
  | { scopeType: 'blocks'; startBlockId: string; endBlockId: string }
  | { scopeType: 'section' | 'list'; rootBlockId: string }
);
export interface IdentityBindingCache {
  markdown?: string;
  identitySignature?: string;
  context?: {
    blocks: ReturnType<typeof parseIdentityBlocks>;
    models: IdentityBlockModel[];
    ids: string[];
    contentHash: string;
  } | null;
}
export const IDENTITY_BINDING_FORMAT: 2;
export function bindingFromAnchor(
  markdown: string,
  identity: unknown,
  annotation: IdentitySourceAnnotation,
  cache?: IdentityBindingCache | null
): IdentityBinding | null;
export function bindingFromEditor(
  markdown: string,
  identity: unknown,
  reported: IdentityEditorAnnotation,
  cache?: IdentityBindingCache | null
): IdentityBinding | null;
export function validBinding(
  markdown: string,
  identity: unknown,
  binding: unknown,
  cache?: IdentityBindingCache | null
): binding is IdentityBinding;
export function bindingSourceRange(
  markdown: string,
  identity: unknown,
  binding: unknown
): { sourceStart: number; sourceEnd: number } | null;
