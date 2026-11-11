import crypto from 'node:crypto';
import { calculateContentHash, projectMarkdown } from '@study-accelerator/content-anchor';
import {
  parseKnowraMarks,
  sameKnowraText,
  stripKnowraMarks,
  stripKnowraMarksMapped
} from '@study-accelerator/shared/knowra-marks';
import { createInlineAnnotationSourceResolver } from './inline-annotation-ranges.ts';
import { ContentAnnotation, INLINE_ANCHOR_FORMAT, INLINE_ANNOTATION_SCHEMA } from '../domain/content-annotation.ts';
import { isEvidenceUsable } from '../domain/evidence-applicability.ts';

import type { AnnotationScopeType } from '@study-accelerator/content-anchor';
import type { ContentAnnotationConstructorInput, ContentAnnotationAnchor } from '../domain/content-annotation.ts';
import type { ContentAnnotationRecord } from '../infrastructure/content-annotation-repository.ts';
import type { AnnotationRevisionRecord } from '../infrastructure/annotation-support-repositories.ts';
import type { EvidenceApplicabilityInput } from '../domain/evidence-applicability.ts';
import type { NoteRecord } from '../infrastructure/note-repository.ts';
import type { NoteVersionRecord } from '../infrastructure/note-version-repository.ts';
import type { AsyncNoteDependencyOptions } from './postgres-async/note-dependency-lifecycle.ts';

type InlineNoteRecord = Pick<NoteRecord, 'id' | 'spaceId' | 'rawMarkdown'>;
type MaybePromise<T> = T | Promise<T>;
type Projection = ReturnType<typeof projectMarkdown>;
interface SourcePiece {
  start: number;
  end: number;
}
interface InlineMark {
  id: string;
  attrs: Record<string, string>;
  scopeType: AnnotationScopeType;
  segments: string[];
  firstLine: number;
  unresolved: boolean;
  resolved: boolean;
  quoteText: string;
  headingPath: string[];
  kind: string;
  importance: string;
  roles: string[];
  anchorStatus: string;
  anchorReason: string | null;
}
type InlineRow = ContentAnnotation & { anchor: ContentAnnotationAnchor & { markId: string } };
interface InlineNote {
  id: string;
  spaceId: string | null;
  rawMarkdown: string;
}
type InlineMarkDraft = Omit<
  InlineMark,
  'quoteText' | 'headingPath' | 'kind' | 'importance' | 'roles' | 'anchorStatus' | 'anchorReason'
>;
type InlineMarkMap = Map<string, InlineMark> & { has(key: unknown): boolean };
interface InlineChange {
  annotation: ContentAnnotation;
  revision: AnnotationRevisionRecord | null;
}
interface SourceContext {
  cleanBefore?: ReturnType<typeof stripKnowraMarksMapped>;
}
interface SourceChanges {
  changed: string[];
  removed: string[];
}
interface InlineRepository {
  list(options: { noteId: string; includeDeleted: true }): MaybePromise<ContentAnnotationRecord[]>;
  save(annotation: ContentAnnotation): MaybePromise<ContentAnnotationRecord>;
}
interface InlineRevisionRepository {
  save(revision: AnnotationRevisionRecord): MaybePromise<AnnotationRevisionRecord>;
}
interface InlineDependencies {
  repository: InlineRepository;
  revisionRepository?: InlineRevisionRepository | null;
  now?: () => string;
  before?: string | null;
}
interface InlineLifecycle<Result> {
  onNoteContentChanged(
    note: InlineNoteRecord,
    version: NoteVersionRecord,
    change: { before?: string | null } | null | undefined
  ): Result;
}
interface InlineLifecycleDependencies<Result> extends Omit<InlineDependencies, 'before'> {
  marksOnlyLifecycle?: InlineLifecycle<Result> | null;
  onSourceChanged?: ((sources: SourceChanges) => MaybePromise<void>) | null;
}
interface InlineEvidence extends EvidenceApplicabilityInput {
  id: string;
}
interface InlineEvidenceDependencies {
  knowledgeItemService: { reconcileEvidenceByAnnotationIds(ids: string[]): InlineEvidence[] };
  questionService: { markSourcesStale(type: 'knowledgeEvidence', ids: string[]): void };
  questionSourceRepository: {
    markBySourceIds(type: 'knowledgeEvidence', ids: string[], status: 'active'): { id?: unknown }[];
  };
}
interface AsyncInlineEvidenceDependencies {
  knowledgeItemService: { reconcileEvidenceByAnnotationIds(ids: string[]): Promise<InlineEvidence[]> };
  questionService: { markSourcesStale(type: 'knowledgeEvidence', ids: string[]): Promise<{ id?: unknown }[]> };
  questionSourceRepository: {
    markBySourceIds(type: 'knowledgeEvidence', ids: string[], status: 'active'): Promise<{ id?: unknown }[]>;
  };
}

/**
 * 重点内联化 I2（《重点标记内联化方案》3.2）：正文是重点位置的唯一来源，保存时从正文标记派生元数据行。
 * - 行 ID 由"笔记 ID + 标记 ID"确定性生成，多台设备各自派生也得到同一行，不产生同步冲突。
 * - 只有用户可见的元数据（类型、重要程度、范围、角色、取消/恢复）变化才升修订号并写修订记录；
 *   摘录、标题路径等缓存变化只覆盖写入。位置不缓存（固定 0/1）：上方打字不会让整篇的重点行被重写。
 */
export const INLINE_KEY_PREFIX = 'knowra-mark:';
const KINDS = new Set(['important', 'question', 'supplement', 'pitfall', 'temporary']);
const LEVELS = new Set(['important', 'core']);
const BLOCK_SCOPES = new Set(['section', 'list', 'blocks']);
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export const isInlineAnnotation = (annotation: { schemaVersion?: unknown } | null | undefined) =>
  annotation?.schemaVersion === INLINE_ANNOTATION_SCHEMA;
export const inlineAnnotationId = (noteId: unknown, markId: unknown) =>
  `annotation-k-${hash(`${noteId}\n${markId}`).slice(0, 32)}`;

/** 本次保存只增删或修改了标记（去掉标记后正文不变）。 */
export function isMarksOnlyChange(before: unknown, after: unknown) {
  return typeof before === 'string' && typeof after === 'string' && before !== after && sameKnowraText(before, after);
}

const mayContainMarks = (markdown: string) => markdown.includes('<mark') || markdown.includes('<!--k');

/** 按完整语法树读取前序标题，公式和代码里的标题文字不进入标题路径。 */
function headingPaths(lines: string[], projection: Projection, toClean: (offset: number) => number) {
  const paths: string[][] = [],
    stack: Projection['headings'][number][] = [];
  let offset = 0,
    next = 0;
  for (const line of lines) {
    const start = toClean(offset);
    while (next < projection.headings.length && projection.headings[next].sourceStart < start) {
      const heading = projection.headings[next++];
      while (stack.length && stack.at(-1)!.level >= heading.level) stack.pop();
      stack.push(heading);
    }
    paths.push(stack.map(item => item.title));
    offset += line.length + 1;
  }
  return paths;
}

/** 正文中每个标记 ID 的派生信息。排除标记（`<!--k- id-->`）属于所在章节重点，不单独成行。 */
export function inlineMarksOf(markdown: unknown): InlineMarkMap {
  const text = String(markdown ?? '');
  const result = new Map<string, InlineMarkDraft>();
  if (!mayContainMarks(text)) return result as InlineMarkMap;
  const parsed = parseKnowraMarks(text);
  const lines = text.split('\n');
  const clean = stripKnowraMarksMapped(text);
  const sourceEmpty = !clean.markdown.trim();
  const projection = projectMarkdown(clean.markdown, { includeMath: true });
  const paths = headingPaths(lines, projection, clean.toClean);
  const entry = (id: string, attrs: Record<string, string>) => {
    if (!result.has(id))
      result.set(id, {
        id,
        attrs: { ...attrs },
        scopeType: 'selection',
        segments: [],
        firstLine: Infinity,
        unresolved: false,
        resolved: false
      });
    return result.get(id)!;
  };
  const dataOf = (attrs: Record<string, string>) =>
    Object.fromEntries(Object.entries(attrs).filter(([key]) => !['k', 's', 'r', 'h'].includes(key)));
  for (const mark of parsed.inline) {
    const item = entry(mark.id, dataOf(mark.attrs));
    item.segments.push(stripKnowraMarks(text.slice(mark.contentStart, mark.contentEnd)).trim());
    item.firstLine = Math.min(item.firstLine, mark.line);
    item.resolved = true;
  }
  for (const marker of parsed.blocks) {
    if (marker.exclude) continue;
    const item = entry(marker.id, dataOf(marker.attrs));
    const target = marker.targetLine ?? marker.line;
    item.firstLine = Math.min(item.firstLine, target);
    if (marker.attrs.s === 'code') {
      if (marker.code?.resolved) {
        item.segments.push(marker.code.text!);
        item.resolved = true;
      } else item.unresolved = true;
      continue;
    }
    item.scopeType = BLOCK_SCOPES.has(marker.attrs.s) ? (marker.attrs.s as AnnotationScopeType) : 'blocks';
    item.resolved = true;
  }
  const resolve = createInlineAnnotationSourceResolver(text);
  for (const item of result.values()) {
    let quoteText = item.segments.filter(segment => segment.trim()).join('\n');
    if (item.scopeType !== 'selection') {
      const raw = resolve(item.id);
      const map = (ranges: SourcePiece[]) =>
        ranges.map(range => ({ start: clean!.toClean(range.start), end: clean!.toClean(range.end) }));
      const located = raw && { ranges: map(raw.ranges), excluded: map(raw.excluded) };
      const overlaps = (unit: Projection['units'][number], range: SourcePiece) =>
        unit.sourceStart! < range.end && unit.sourceEnd! > range.start;
      const selected = projection.units.filter(
        unit =>
          unit.sourceStart !== null &&
          located?.ranges.some(range => overlaps(unit, range)) &&
          !located.excluded.some(range => overlaps(unit, range))
      );
      let previous: Projection['units'][number] | undefined;
      quoteText = selected
        .map(unit => {
          const gap = previous ? projection.text.slice(previous.projectedEnd, unit.projectedStart) : '';
          previous = unit;
          return (gap && !/^\s*$/.test(gap) ? '\n' : gap) + unit.text;
        })
        .join('');
    }
    Object.assign(item, {
      quoteText: quoteText || '￼',
      headingPath: Number.isFinite(item.firstLine) ? (paths[item.firstLine] ?? []) : [],
      kind: KINDS.has(item.attrs.c) ? item.attrs.c : 'important',
      importance: LEVELS.has(item.attrs.l) ? item.attrs.l : 'normal',
      roles: (item.attrs.t ?? '').split(/\s+/).filter(Boolean),
      // 代码块在编辑器外被改写、校验不符：标记仍在正文里，但这一段需要用户确认。
      anchorStatus: sourceEmpty ? 'missing' : item.unresolved ? 'needsReview' : 'resolved',
      anchorReason: sourceEmpty
        ? 'sourceDeleted'
        : item.unresolved
          ? item.resolved
            ? 'partialCodeChanged'
            : 'codeChanged'
          : null
    });
  }
  return result as InlineMarkMap;
}

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

/**
 * 对比正文标记与已有的 v3 行，得出需要写入的行与修订记录。
 * @param {string | null} [before]
 */
export function planInlineAnnotations(
  note: InlineNote,
  version: { id?: string | null } | null | undefined,
  existing: ContentAnnotationRecord[] | null | undefined,
  now = new Date().toISOString(),
  before: string | null = null
) {
  const rows = (existing ?? []).filter(isInlineAnnotation) as InlineRow[];
  const marks = inlineMarksOf(note?.rawMarkdown);
  if (!marks.size && !rows.some(row => row.lifecycleStatus === 'active')) return [];
  const byMark = new Map(rows.map(row => [row.anchor.markId, row]));
  const contentHash = calculateContentHash(note.rawMarkdown);
  const changes: InlineChange[] = [];
  const push = (
    previous: InlineRow | null,
    fields: Partial<ContentAnnotationConstructorInput>,
    operation: string | null
  ) => {
    const annotation = new ContentAnnotation({
      ...(previous ?? {}),
      ...fields,
      updatedAt: now
    } as ContentAnnotationConstructorInput);
    const revision = operation
      ? {
          id: `annotation-revision-${crypto.randomUUID()}`,
          annotationId: annotation.id,
          revision: annotation.revision,
          operation,
          oldAnchor: previous?.anchor ? structuredClone(previous.anchor) : null,
          newAnchor: structuredClone(annotation.anchor),
          rangeSummary: { scopeType: annotation.scopeType, quoteText: annotation.quoteText },
          reason: null,
          createdAt: now
        }
      : null;
    changes.push({ annotation, revision });
  };
  for (const mark of marks.values()) {
    const previous = byMark.get(mark.id) ?? null;
    const anchor = { format: INLINE_ANCHOR_FORMAT, markId: mark.id, scopeType: mark.scopeType, roles: mark.roles };
    const derived = {
      kind: mark.kind,
      importance: mark.importance,
      scopeType: mark.scopeType,
      anchor,
      quoteText: mark.quoteText,
      headingPath: mark.headingPath,
      anchorStatus: mark.anchorStatus,
      anchorReason: mark.anchorReason
    };
    const written = {
      noteVersionId: version?.id ?? null,
      noteContentHash: contentHash,
      resolvedContentHash: calculateContentHash(mark.quoteText)
    };
    if (!previous) {
      push(
        null,
        {
          id: inlineAnnotationId(note.id, mark.id),
          spaceId: note.spaceId as string,
          noteId: note.id,
          sourceMode: 'manual',
          fromPosition: 0,
          toPosition: 1,
          prefixText: '',
          suffixText: '',
          anchorFingerprint: calculateContentHash(`${INLINE_ANCHOR_FORMAT}:${mark.id}`),
          idempotencyKey: `${INLINE_KEY_PREFIX}${mark.id}`,
          schemaVersion: INLINE_ANNOTATION_SCHEMA,
          comment: '',
          lifecycleStatus: 'active',
          revision: 1,
          originSnapshot: {
            noteVersionId: version?.id ?? null,
            contentHash,
            scopeType: mark.scopeType,
            segments: [],
            quoteText: mark.quoteText,
            headingPath: mark.headingPath
          },
          identityBinding: null,
          boundaryFingerprint: null,
          requestHash: null,
          createdAt: now,
          deletedAt: null,
          ...derived,
          ...written
        },
        'created'
      );
      continue;
    }
    const revived = previous.lifecycleStatus !== 'active';
    const metadataChanged =
      previous.kind !== mark.kind ||
      previous.importance !== mark.importance ||
      previous.scopeType !== mark.scopeType ||
      !sameJson(previous.anchor?.roles, mark.roles);
    const cacheChanged =
      previous.quoteText !== mark.quoteText ||
      !sameJson(previous.headingPath, mark.headingPath) ||
      previous.anchorStatus !== mark.anchorStatus ||
      previous.anchorReason !== mark.anchorReason;
    if (revived || metadataChanged) {
      push(
        previous,
        { ...derived, ...written, lifecycleStatus: 'active', deletedAt: null, revision: previous.revision + 1 },
        revived ? 'restored' : 'metadataUpdated'
      );
    } else if (cacheChanged) {
      push(previous, { ...derived, ...written }, null);
    }
  }
  let text = null;
  const sourceContext: SourceContext = {};
  const resolvePreviousSource =
    typeof before === 'string' ? createInlineAnnotationSourceResolver(before, { keepWhitespace: true }) : null;
  for (const row of rows) {
    if (row.lifecycleStatus !== 'active' || marks.has(row.anchor.markId)) continue;
    text ??= stripKnowraMarks(String(note.rawMarkdown ?? ''));
    const source = sourceLoss(text, row, before, resolvePreviousSource, sourceContext);
    push(
      row,
      {
        lifecycleStatus: 'deleted',
        deletedAt: now,
        revision: row.revision + 1,
        noteVersionId: version?.id ?? row.noteVersionId,
        noteContentHash: contentHash,
        ...(source ? { anchorStatus: source.anchorStatus, anchorReason: source.anchorReason } : {})
      },
      'deleted'
    );
  }
  return changes;
}

const then = <T, R>(value: MaybePromise<T>, next: (value: T) => MaybePromise<R>): MaybePromise<R> =>
  value && typeof (value as Promise<T>).then === 'function' ? (value as Promise<T>).then(next) : next(value as T);

/**
 * 标记消失时原文的去向（与旧链路一致）：原摘录还在正文里是取消重点（null）；
 * 正文已清空算原文缺失（证据依据不足）；其余是原文被改写，需要核对（不等同于删除）。
 */
function sourceLoss(
  text: string,
  row: InlineRow,
  before: string | null,
  resolvePreviousSource: ReturnType<typeof createInlineAnnotationSourceResolver> | null,
  context: SourceContext
) {
  const source = resolvePreviousSource?.(row.anchor.markId);
  const ranges = (source?.ranges ?? []).flatMap(range => {
    let pieces = [range];
    for (const excluded of source!.excluded) {
      pieces = pieces.flatMap(piece => {
        if (excluded.end <= piece.start || excluded.start >= piece.end) return [piece];
        return [
          ...(excluded.start > piece.start ? [{ start: piece.start, end: excluded.start }] : []),
          ...(excluded.end < piece.end ? [{ start: excluded.end, end: piece.end }] : [])
        ];
      });
    }
    return pieces;
  });
  const clean = typeof before === 'string' ? (context.cleanBefore ??= stripKnowraMarksMapped(before)) : null;
  // 嵌套标记会把连续原文拆成多个源码区间；去标记后必须重新合并相邻区间。
  const cleanRanges = ranges
    .map(range => ({ start: clean!.toClean(range.start), end: clean!.toClean(range.end) }))
    .reduce((result, range) => {
      const last = result.at(-1);
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
      else result.push(range);
      return result;
    }, [] as SourcePiece[]);
  const pieces = cleanRanges.map(range => clean!.markdown.slice(range.start, range.end).trim()).filter(Boolean);
  // 摘录可能是 Markdown 投影或多个不连续范围的拼接，不能直接在源码中查找 quoteText。
  // 按原始顺序查找保存前的各源码片段，允许取消重点的同时修改范围以外的内容。
  let offset = 0;
  const preserved = pieces.length
    ? pieces.every(piece => {
        const index = text.indexOf(piece, offset);
        if (index < 0) return false;
        offset = index + piece.length;
        return true;
      })
    : text.includes(row.quoteText);
  if (preserved) return null;
  return text.trim()
    ? { anchorStatus: 'needsReview', anchorReason: 'sourceChanged' }
    : { anchorStatus: 'missing', anchorReason: 'sourceDeleted' };
}

/**
 * 找出需要重新核对证据的 v3 重点，包括恢复已取消的标记和锚点状态变化。
 * 标记连同原文被改写算"改"；正文被清空算"删"；只删标记而原文还在是取消重点，不影响证据。
 */
export function inlineSourceChanges(
  note: InlineNoteRecord,
  existing: ContentAnnotationRecord[] | null | undefined,
  before: string | null = null
) {
  const marks = inlineMarksOf(note?.rawMarkdown);
  const text = stripKnowraMarks(String(note?.rawMarkdown ?? ''));
  const resolvePreviousSource =
    typeof before === 'string' ? createInlineAnnotationSourceResolver(before, { keepWhitespace: true }) : null;
  const sourceContext: SourceContext = {};
  const changed = [],
    removed = [];
  for (const rawRow of existing ?? []) {
    const row = rawRow as InlineRow;
    if (!isInlineAnnotation(row)) continue;
    const mark = marks.get(row.anchor.markId);
    if (mark) {
      if (mark.anchorStatus === 'missing') removed.push(row.id);
      else if (
        row.lifecycleStatus !== 'active' ||
        mark.quoteText !== row.quoteText ||
        mark.anchorStatus !== row.anchorStatus
      )
        changed.push(row.id);
      continue;
    }
    if (row.lifecycleStatus !== 'active') continue;
    const loss = sourceLoss(text, row, before, resolvePreviousSource, sourceContext);
    if (loss) (loss.anchorStatus === 'missing' ? removed : changed).push(row.id);
  }
  return { changed, removed };
}

/** 顺序写入（PostgreSQL 事务内不并发查询）；同步与异步仓储共用。 */
export function applyInlineAnnotationChanges(
  repository: InlineRepository,
  revisionRepository: InlineRevisionRepository | null | undefined,
  changes: InlineChange[]
): MaybePromise<InlineChange[]> {
  const step = (index: number): MaybePromise<InlineChange[]> => {
    if (index >= changes.length) return changes;
    const { annotation, revision } = changes[index];
    return then(repository.save(annotation), () =>
      then(revision ? revisionRepository?.save(revision) : null, () => step(index + 1))
    );
  };
  return step(0);
}

export function deriveInlineAnnotations(
  { repository, revisionRepository, now = () => new Date().toISOString(), before = null }: InlineDependencies,
  note: InlineNoteRecord,
  version: NoteVersionRecord
) {
  return then(repository.list({ noteId: note.id as string, includeDeleted: true }), list =>
    applyInlineAnnotationChanges(
      repository,
      revisionRepository,
      planInlineAnnotations(note as InlineNote, version as { id?: string | null }, list, now(), before)
    )
  );
}

/**
 * 只改了标记的保存不让旧版本上的证据和题目来源过期（正文没有变）。
 * 用同一个级联工厂换一组依赖实现，级联本身及其冻结的调用序列保持不变。
 */
export function marksOnlyDependencies<
  Dependencies extends {
    knowledgeItemService: Pick<AsyncNoteDependencyOptions['knowledgeItemService'], 'markEvidenceByNoteVersionIds'>;
    questionService: AsyncNoteDependencyOptions['questionService'];
  }
>(dependencies: Dependencies) {
  const { knowledgeItemService, questionService } = dependencies;
  return {
    ...dependencies,
    knowledgeItemService: {
      ...knowledgeItemService,
      markEvidenceByNoteVersionIds: (ids: unknown[], status: 'stale', sourceType: 'noteVersion') =>
        sourceType === 'noteVersion' ? [] : knowledgeItemService.markEvidenceByNoteVersionIds(ids, status, sourceType)
    },
    questionService: {
      ...questionService,
      markSourcesStale: (sourceType: 'knowledgeEvidence' | 'noteVersion', ids: unknown[]) =>
        sourceType === 'noteVersion' ? undefined : questionService.markSourcesStale(sourceType, ids)
    }
  };
}

/**
 * 装配层包装：只改标记时走 marksOnlyLifecycle；级联完成后派生内联重点行。
 * 原文变化时先找出原文被改或被删的重点，派生完成后交给 onSourceChanged 把以它们为来源的证据降级。
 */
export function withInlineAnnotations<Result, Lifecycle extends InlineLifecycle<Result>>(
  lifecycle: Lifecycle & InlineLifecycle<Result>,
  {
    repository,
    revisionRepository,
    marksOnlyLifecycle = null,
    onSourceChanged = null,
    now = undefined
  }: InlineLifecycleDependencies<Result>
) {
  return {
    ...lifecycle,
    onNoteContentChanged: (
      note: InlineNoteRecord,
      version: NoteVersionRecord,
      annotationChange: { before?: string | null } | null | undefined
    ) => {
      const marksOnly = isMarksOnlyChange(annotationChange?.before, note.rawMarkdown);
      const target = marksOnlyLifecycle && marksOnly ? marksOnlyLifecycle : lifecycle;
      const result = target.onNoteContentChanged(note, version, annotationChange);
      const watch = onSourceChanged && typeof annotationChange?.before === 'string';
      return then(result, value =>
        then(watch ? repository.list({ noteId: note.id as string, includeDeleted: true }) : null, rows => {
          const sources = rows ? inlineSourceChanges(note, rows, annotationChange!.before) : null;
          return then(
            deriveInlineAnnotations(
              { repository, revisionRepository, now, before: annotationChange?.before },
              note,
              version
            ),
            () =>
              then(
                sources && (sources.changed.length || sources.removed.length) ? onSourceChanged!(sources) : null,
                () => value
              )
          );
        })
      );
    }
  };
}

/** 逐条重算重点证据及题目来源；恢复健康不会自动确认知识或题目。 */
export function degradeInlineSourceEvidence({
  knowledgeItemService,
  questionService,
  questionSourceRepository
}: InlineEvidenceDependencies) {
  return ({ changed, removed }: SourceChanges) => {
    const ids = [...new Set([...changed, ...removed])];
    const evidence = knowledgeItemService.reconcileEvidenceByAnnotationIds(ids);
    questionSourceRepository.markBySourceIds(
      'knowledgeEvidence',
      evidence.filter(isEvidenceUsable).map(item => item.id),
      'active'
    );
    return questionService.markSourcesStale(
      'knowledgeEvidence',
      evidence.filter(item => !isEvidenceUsable(item)).map(item => item.id)
    );
  };
}

/** PostgreSQL 版：依赖都是异步的，逐条等待以保持事务内的顺序。 */
export function degradeInlineSourceEvidenceAsync({
  knowledgeItemService,
  questionService,
  questionSourceRepository
}: AsyncInlineEvidenceDependencies) {
  return async ({ changed, removed }: SourceChanges) => {
    const ids = [...new Set([...changed, ...removed])];
    const evidence = await knowledgeItemService.reconcileEvidenceByAnnotationIds(ids);
    await questionSourceRepository.markBySourceIds(
      'knowledgeEvidence',
      evidence.filter(isEvidenceUsable).map(item => item.id),
      'active'
    );
    await questionService.markSourcesStale(
      'knowledgeEvidence',
      evidence.filter(item => !isEvidenceUsable(item)).map(item => item.id)
    );
  };
}
