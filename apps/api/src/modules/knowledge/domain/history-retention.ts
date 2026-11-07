import { INLINE_ANNOTATION_SCHEMA } from './content-annotation.ts';
import { createNoteVersionReferenceIndex } from './note-version-references.ts';
import { calculateContentHash } from './note-version.ts';
import { NOTE_VERSION_RETENTION, selectVersionsToPrune } from './note-version-retention.ts';
import type {
  HistoryAnnotation,
  HistoryChangedState,
  HistoryCollection,
  HistoryExclusion,
  HistoryRetentionOptions,
  HistoryRetentionPlan,
  HistoryRetentionState,
  HistoryRevision,
  HistoryVersion,
  HistoryWritableState,
  AnnotationRevisionRetentionPolicy
} from './history-retention-types.ts';
import type { RetentionJsonValue } from './note-version-retention.ts';

const DAY = 24 * 60 * 60 * 1000;
export const ANNOTATION_REVISION_RETENTION: Readonly<AnnotationRevisionRetentionPolicy> = Object.freeze({
  maxPerAnnotation: 10,
  maxAgeMs: 7 * DAY,
  sampleMs: 10 * 60 * 1000,
  maxBytesPerAnnotation: 128 * 1024
});
/** 已取消旧重点的最短留存期；到期仅可预演，不自动取得删除授权。 */
export const DELETED_ANNOTATION_RETENTION_MS = 7 * DAY;
/** 回收可能改动的全部集合：调用方据此回写，不要只回写其中一部分。 */
export const HISTORY_RETENTION_COLLECTIONS = Object.freeze([
  'noteVersions',
  'annotationRevisions',
  'contentAnnotations',
  'annotationExclusions'
] as const);
const references = [
  'contentAnnotations',
  'annotationExclusions',
  'knowledgeEvidence',
  'knowledgeArtifactProvenance',
  'questionSources',
  'analysisScopeSnapshots'
] as const;
/** 能让一条重点免于回收的引用方：重点自身的排除区间与修订随它一起处理，不算外部引用。 */
export const ANNOTATION_RETENTION_REFERENCE_COLLECTIONS = Object.freeze([
  'knowledgeEvidence',
  'knowledgeArtifactProvenance',
  'questionSources',
  'analysisScopeSnapshots'
] as const);
const pair = (id: string, revision: RetentionJsonValue | undefined) => JSON.stringify([id, revision]);
const size = (record: object) => Buffer.byteLength(JSON.stringify(record));
const newestFirst = (a: HistoryRevision, b: HistoryRevision) =>
  Date.parse(b.createdAt as string) - Date.parse(a.createdAt as string) || b.id.localeCompare(a.id);

/** 来源凭证、分析范围和私有任务中的确切修订引用；过程历史自身不是保留根。 */
export function referencedAnnotationRevisions(
  state: HistoryRetentionState,
  externalReferences: readonly unknown[] = []
): (revision: HistoryRevision) => boolean {
  const ids = new Set<string>(),
    pairs = new Set<string>();
  const mentioned = createNoteVersionReferenceIndex({ external: externalReferences });
  function visit(value: unknown) {
    if (typeof value === 'string') {
      if (value.startsWith('annotation-revision-')) ids.add(value);
      // 私有任务的 JSON 载荷也可能以字符串存放。
      if (/^\s*[[{]/.test(value)) {
        try {
          visit(JSON.parse(value));
        } catch {
          /* 普通正文不是 JSON。 */
        }
      }
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof (value as { annotationRevisionId?: unknown }).annotationRevisionId === 'string')
      ids.add((value as { annotationRevisionId: string }).annotationRevisionId);
    if (
      typeof (value as { annotationId?: unknown }).annotationId === 'string' &&
      Number.isSafeInteger((value as { revision?: unknown }).revision)
    )
      pairs.add(pair((value as { annotationId: string }).annotationId, (value as { revision: number }).revision));
    for (const child of Object.values(value)) visit(child);
  }
  for (const name of references) visit(state[name] ?? []);
  visit(externalReferences);
  for (const annotation of state.contentAnnotations ?? []) pairs.add(pair(annotation.id, annotation.revision));
  // 旧 Evidence 可能只记录标注、版本和摘录。保留足以证明它的一个修订，而非该标注的全部过程历史。
  const annotations = new Map<string | null | undefined, HistoryAnnotation>(
    (state.contentAnnotations ?? []).map(item => [item.id, item])
  );
  const witnesses = new Map<string, HistoryRevision>();
  for (const revision of state.annotationRevisions ?? []) {
    const key = JSON.stringify([
      revision.annotationId,
      (revision.newAnchor as { noteVersionId?: unknown } | null | undefined)?.noteVersionId,
      String((revision.rangeSummary as { quoteText?: unknown } | null | undefined)?.quoteText ?? '').trim()
    ]);
    const previous = witnesses.get(key);
    if (!previous || revision.revision > previous.revision) witnesses.set(key, revision);
  }
  for (const evidence of state.knowledgeEvidence ?? []) {
    if (evidence.sourceType !== 'annotation') continue;
    const annotation = annotations.get(evidence.annotationId);
    const quote = String(evidence.quoteText ?? '').trim();
    if (
      [annotation, annotation?.originSnapshot].some(
        item =>
          item &&
          (item as { noteVersionId?: unknown }).noteVersionId === evidence.noteVersionId &&
          String((item as { quoteText?: unknown }).quoteText ?? '').trim() === quote
      )
    )
      continue;
    const witness = witnesses.get(JSON.stringify([evidence.annotationId, evidence.noteVersionId, quote]));
    if (witness) ids.add(witness.id);
  }
  return revision =>
    ids.has(revision.id) || pairs.has(pair(revision.annotationId, revision.revision)) || mentioned(revision);
}

export function selectAnnotationRevisionsToPrune({
  revisions,
  protectedIds = new Set(),
  now = Date.now(),
  policy = ANNOTATION_REVISION_RETENTION
}: {
  revisions: readonly HistoryRevision[];
  protectedIds?: ReadonlySet<string>;
  now?: number;
  policy?: Readonly<AnnotationRevisionRetentionPolicy>;
}) {
  const buckets = new Set<number>(),
    removed: string[] = [];
  let kept = 0,
    bytes = 0;
  for (const record of [...revisions].sort((a, b) => b.revision - a.revision || newestFirst(a, b))) {
    if (protectedIds.has(record.id)) continue;
    const time = Date.parse(record.createdAt as string);
    // 无法确定年龄的旧记录不作自动删除。
    if (!Number.isFinite(time)) continue;
    const bucket = Math.floor(time / policy.sampleMs);
    const automatic = record.operation === 'sourceReconciled';
    const length = size(record);
    if (
      now - time > policy.maxAgeMs ||
      kept >= policy.maxPerAnnotation ||
      bytes + length > policy.maxBytesPerAnnotation ||
      (automatic && buckets.has(bucket))
    ) {
      removed.push(record.id);
      continue;
    }
    kept++;
    bytes += length;
    if (automatic) buckets.add(bucket);
  }
  return removed;
}

/**
 * 已取消超过保留期的重点：没有被证据、分析范围、题目来源、知识产物来源或私有任务引用，
 * 且它的排除区间和修订都能一起回收（任何一项必须保留时整条保留，不留下悬空引用）。
 */
function selectAnnotationsToPrune(
  state: HistoryRetentionState,
  {
    now,
    selected,
    externalReferences,
    protectedRevisionIds,
    canDiscard,
    retentionMs
  }: {
    now: number;
    selected: (id: string | null | undefined) => boolean;
    externalReferences: readonly unknown[];
    protectedRevisionIds: ReadonlySet<string>;
    canDiscard: NonNullable<HistoryRetentionOptions['canDiscard']>;
    retentionMs: number;
  }
) {
  // 与版本/修订引用采用同一 token 索引，包含自由文本和字符串化的私有任务载荷。
  const referenced = createNoteVersionReferenceIndex({
    ...Object.fromEntries(ANNOTATION_RETENTION_REFERENCE_COLLECTIONS.map(name => [name, state[name] ?? []])),
    external: externalReferences
  });
  const exclusionsByParent = new Map<string, HistoryExclusion[]>();
  for (const exclusion of state.annotationExclusions ?? []) {
    if (!exclusionsByParent.has(exclusion.parentAnnotationId)) exclusionsByParent.set(exclusion.parentAnnotationId, []);
    exclusionsByParent.get(exclusion.parentAnnotationId)!.push(exclusion);
  }
  const revisionsByAnnotation = new Map<string, HistoryRevision[]>();
  for (const revision of state.annotationRevisions ?? []) {
    if (!revisionsByAnnotation.has(revision.annotationId)) revisionsByAnnotation.set(revision.annotationId, []);
    revisionsByAnnotation.get(revision.annotationId)!.push(revision);
  }
  const candidates = new Set<string>();
  for (const annotation of state.contentAnnotations ?? []) {
    // v3 行的 ID 由正文标记确定：历史恢复会复用，不能生成禁止复活的永久删除事实。
    if (
      annotation.schemaVersion === INLINE_ANNOTATION_SCHEMA ||
      annotation.lifecycleStatus !== 'deleted' ||
      !selected(annotation.noteId) ||
      referenced(annotation)
    )
      continue;
    const time = Date.parse((annotation.deletedAt ?? annotation.updatedAt) as string);
    // 无法确定取消时间的旧记录不作自动删除。
    if (!Number.isFinite(time) || now - time <= retentionMs || !canDiscard('contentAnnotations', annotation)) continue;
    if (
      (exclusionsByParent.get(annotation.id) ?? []).some(
        exclusion => referenced(exclusion) || !canDiscard('annotationExclusions', exclusion)
      )
    )
      continue;
    candidates.add(annotation.id);
  }
  if (!candidates.size) return { annotations: candidates, exclusions: new Set<string>(), revisions: new Set<string>() };
  // 修订是否被引用要按回收后的状态判断：被回收的重点不再保护自己的当前修订。
  const after = {
    ...state,
    contentAnnotations: (state.contentAnnotations ?? []).filter(item => !candidates.has(item.id))
  };
  const isRevisionReferenced = referencedAnnotationRevisions(after, externalReferences);
  for (const id of [...candidates]) {
    if (
      (revisionsByAnnotation.get(id) ?? []).some(
        revision =>
          protectedRevisionIds.has(revision.id) ||
          isRevisionReferenced(revision) ||
          !canDiscard('annotationRevisions', revision)
      )
    )
      candidates.delete(id);
  }
  const exclusions = new Set(
    [...candidates].flatMap(id => (exclusionsByParent.get(id) ?? []).map(exclusion => exclusion.id))
  );
  const revisions = new Set(
    [...candidates].flatMap(id => (revisionsByAnnotation.get(id) ?? []).map(revision => revision.id))
  );
  return { annotations: candidates, exclusions, revisions };
}

/** 只规划，不改写输入；默认保全已取消旧重点及其历史，回收须单独确认与预演。 */
export function planHistoryRetention(
  input: HistoryRetentionState,
  {
    now = Date.now(),
    noteIds = null,
    externalReferences = [],
    protectedVersionIds = new Set<string>(),
    protectedRevisionIds = new Set<string>(),
    canDiscard = () => true,
    notePolicy = NOTE_VERSION_RETENTION,
    annotationPolicy = ANNOTATION_REVISION_RETENTION,
    deletedAnnotationRetentionMs = DELETED_ANNOTATION_RETENTION_MS,
    allowDeletedAnnotationPrune = false
  }: HistoryRetentionOptions = {}
): HistoryRetentionPlan {
  const notes = new Map((input.notes ?? []).map(note => [note.id, note]));
  const annotations = new Map((input.contentAnnotations ?? []).map(annotation => [annotation.id, annotation]));
  const selected = (id: string | null | undefined) => !noteIds || noteIds.has(id);
  // 普通业务与同步没有逐项清理授权，不因时间推进删除旧重点或裁掉其恢复依据。
  // 显式选项只供纯规划；它不提供维护执行入口，也不能替代调用方的单独授权。
  const retainedLegacyIds = new Set(
    (input.contentAnnotations ?? [])
      .filter(
        annotation =>
          !allowDeletedAnnotationPrune &&
          annotation.schemaVersion !== INLINE_ANNOTATION_SCHEMA &&
          annotation.lifecycleStatus === 'deleted'
      )
      .map(annotation => annotation.id)
  );
  const pruned = allowDeletedAnnotationPrune
    ? selectAnnotationsToPrune(input, {
        now,
        selected,
        externalReferences,
        protectedRevisionIds,
        canDiscard,
        retentionMs: deletedAnnotationRetentionMs
      })
    : { annotations: new Set<string>(), exclusions: new Set<string>(), revisions: new Set<string>() };
  const state = pruned.annotations.size
    ? {
        ...input,
        contentAnnotations: input.contentAnnotations!.filter(item => !pruned.annotations.has(item.id)),
        annotationExclusions: (input.annotationExclusions ?? []).filter(item => !pruned.exclusions.has(item.id)),
        annotationRevisions: (input.annotationRevisions ?? []).filter(item => !pruned.revisions.has(item.id))
      }
    : input;
  const isRevisionReferenced = referencedAnnotationRevisions(state, externalReferences);
  const revisionGroups = new Map<string, HistoryRevision[]>();
  for (const record of state.annotationRevisions ?? []) {
    if (!selected(annotations.get(record.annotationId)?.noteId)) continue;
    if (!revisionGroups.has(record.annotationId)) revisionGroups.set(record.annotationId, []);
    revisionGroups.get(record.annotationId)!.push(record);
  }
  const removedRevisions = new Set(pruned.revisions);
  for (const records of revisionGroups.values()) {
    const protectedIds = new Set(
      records
        .filter(
          record =>
            retainedLegacyIds.has(record.annotationId) ||
            protectedRevisionIds.has(record.id) ||
            isRevisionReferenced(record) ||
            !canDiscard('annotationRevisions', record)
        )
        .map(record => record.id)
    );
    for (const id of selectAnnotationRevisionsToPrune({
      revisions: records,
      protectedIds,
      now,
      policy: annotationPolicy
    }))
      removedRevisions.add(id);
  }
  const retainedRevisions = (state.annotationRevisions ?? []).filter(record => !removedRevisions.has(record.id));
  const isVersionReferenced = createNoteVersionReferenceIndex({
    ...Object.fromEntries(references.map(name => [name, state[name] ?? []])),
    annotationRevisions: retainedRevisions,
    external: externalReferences
  });
  const versionGroups = new Map<string, HistoryVersion[]>();
  for (const version of state.noteVersions ?? []) {
    if (!selected(version.noteId)) continue;
    if (!versionGroups.has(version.noteId)) versionGroups.set(version.noteId, []);
    versionGroups.get(version.noteId)!.push(version);
  }
  const removedVersions = new Set<string>();
  for (const [noteId, versions] of versionGroups) {
    const note = notes.get(noteId);
    if (!note) continue;
    const currentHash = calculateContentHash(note.rawMarkdown);
    const baselineId = versions.find(version => version.createdAt === note.createdAt)?.id;
    const protectedIds = new Set(
      versions
        .filter(
          version =>
            protectedVersionIds.has(version.id) ||
            version.contentHash === currentHash ||
            version.id === baselineId ||
            isVersionReferenced(version) ||
            !canDiscard('noteVersions', version)
        )
        .map(version => version.id)
    );
    for (const id of selectVersionsToPrune({ versions, now, protectedIds, policy: notePolicy }))
      removedVersions.add(id);
  }
  const summary = {} as HistoryRetentionPlan['summary'];
  for (const [collection, removed] of [
    ['annotationRevisions', removedRevisions],
    ['noteVersions', removedVersions],
    ['contentAnnotations', pruned.annotations],
    ['annotationExclusions', pruned.exclusions]
  ] as [HistoryCollection, Set<string>][]) {
    const records = input[collection] ?? [];
    summary[collection] = {
      before: records.length,
      after: records.length - removed.size,
      removed: removed.size,
      removedBytes: records.reduce((total, record) => total + (removed.has(record.id) ? size(record) : 0), 0)
    };
  }
  return {
    removedRevisions,
    removedVersions,
    removedAnnotations: pruned.annotations,
    removedExclusions: pruned.exclusions,
    summary
  };
}

export function applyHistoryRetentionPlan<State extends HistoryWritableState>(
  state: State,
  plan: Pick<HistoryRetentionPlan, 'removedRevisions' | 'removedVersions'> &
    Partial<Pick<HistoryRetentionPlan, 'removedAnnotations' | 'removedExclusions'>>
) {
  const removedAnnotations = plan.removedAnnotations ?? new Set();
  const removedExclusions = plan.removedExclusions ?? new Set();
  return {
    ...state,
    annotationRevisions: state.annotationRevisions.filter(record => !plan.removedRevisions.has(record.id)),
    noteVersions: state.noteVersions.filter(record => !plan.removedVersions.has(record.id)),
    contentAnnotations: (state.contentAnnotations ?? []).filter(record => !removedAnnotations.has(record.id)),
    annotationExclusions: (state.annotationExclusions ?? []).filter(record => !removedExclusions.has(record.id))
  };
}

/** 普通保存只处理被修改的笔记/标注，避免读取或 AI 状态写入触发整库清理。 */
export function changedHistoryNoteIds(before: HistoryChangedState, after: HistoryChangedState) {
  const notes = new Map((before.notes ?? []).map(note => [note.id, note]));
  const annotations = new Map((before.contentAnnotations ?? []).map(item => [item.id, item]));
  const touched = new Set<string | null | undefined>();
  for (const note of after.notes ?? []) {
    const previous = notes.get(note.id);
    if (
      !previous ||
      previous.updatedAt !== note.updatedAt ||
      (previous.historyContentHash ?? calculateContentHash(previous.rawMarkdown)) !==
        calculateContentHash(note.rawMarkdown)
    )
      touched.add(note.id);
  }
  for (const item of after.contentAnnotations ?? [])
    if (annotations.get(item.id)?.revision !== item.revision) touched.add(item.noteId);
  return touched;
}

export function historyRetentionBasis(state: Required<Pick<HistoryRetentionState, 'notes' | 'contentAnnotations'>>) {
  return {
    notes: state.notes.map(({ id, updatedAt, rawMarkdown }) => ({
      id,
      updatedAt,
      historyContentHash: calculateContentHash(rawMarkdown)
    })),
    contentAnnotations: state.contentAnnotations.map(({ id, noteId, revision }) => ({ id, noteId, revision }))
  };
}
