import { calculateContentHash } from '../domain/note-version.ts';
import { resolveAnalysisScopeNoteVersion } from '../domain/analysis-scope-version-alias.ts';

import type { NoteVersionRecord } from '../infrastructure/note-version-repository.ts';
import type {
  AnalysisScopeAliasSnapshot,
  AnalysisScopeVersionBinding
} from '../domain/analysis-scope-version-alias.ts';

/** 原始历史字段只用于比较、索引或透传；不保证是构造后的实体。 */
export interface VersionReferenceRecord {
  id?: unknown;
  noteVersionId?: unknown;
}
export interface PruneProvenanceSource {
  noteId?: unknown;
  originNoteVersionId?: unknown;
  evidenceId?: unknown;
}
export interface PruneAnalysisScope {
  id?: unknown;
  noteVersions?: unknown;
}
type PruneScopeInput = PruneAnalysisScope;
export interface NoteVersionPruneInput {
  note: { id: string; rawMarkdown: string };
  versions: NoteVersionRecord[];
  evidence: VersionReferenceRecord[];
  provenance?: { id?: unknown; sources?: PruneProvenanceSource[] | null }[];
  questionSources: { id?: unknown; sourceType?: unknown; sourceId?: unknown }[];
  annotations: VersionReferenceRecord[];
  exclusions: VersionReferenceRecord[];
  analysisScopes: PruneScopeInput[];
}
interface PruneReference {
  type:
    | 'current-content'
    | 'knowledgeEvidence'
    | 'knowledgeArtifactProvenance'
    | 'questionSource'
    | 'contentAnnotation'
    | 'annotationExclusion'
    | 'analysisScopeSnapshot';
  id: unknown;
}

export function buildNoteVersionPrunePreview({
  note,
  versions,
  evidence,
  provenance = [],
  questionSources,
  annotations,
  exclusions,
  analysisScopes
}: NoteVersionPruneInput) {
  const currentHash = calculateContentHash(note.rawMarkdown);
  const evidenceByVersion = new Map<unknown, unknown[]>();
  const versionsByEvidence = new Map<unknown, Set<unknown>>();
  for (const record of evidence) {
    if (!record.noteVersionId) continue;
    append(evidenceByVersion, record.noteVersionId, record.id);
    const ids = versionsByEvidence.get(record.id) ?? new Set<unknown>();
    ids.add(record.noteVersionId);
    versionsByEvidence.set(record.id, ids);
  }
  const questionReferences = lazyReferenceIndex(questionSources, source => {
    if (source.sourceType === 'noteVersion') return [source.sourceId];
    if (source.sourceType === 'knowledgeEvidence') return versionsByEvidence.get(source.sourceId) ?? [];
    return [];
  });
  const annotationReferences = lazyReferenceIndex(annotations, record => [record.noteVersionId]);
  const exclusionReferences = lazyReferenceIndex(exclusions, record => [record.noteVersionId]);
  // 缓存只属于本次预览；scope 和 binding 均按对象身份隔离，不能只按版本 ID 复用验证。
  const resolvedScopes = new Map<PruneScopeInput, Map<AnalysisScopeVersionBinding, unknown>>();
  const provenanceMatches = new Map<PruneProvenanceSource, Set<unknown>>();
  return {
    noteId: note.id,
    mode: 'preview-only',
    retentionPointMetadataAvailable: false,
    versions: versions.map(version => {
      const references: PruneReference[] = [];
      if (version.contentHash === currentHash) references.push({ type: 'current-content', id: note.id });
      for (const id of evidenceByVersion.get(version.id) ?? []) references.push({ type: 'knowledgeEvidence', id });
      for (const record of provenance) {
        // 保留 some 的原顺序和短路；未到达的来源不能因预建索引而提前报错。
        if (
          record.sources?.some(source => {
            if (!provenanceMatches.has(source)) {
              provenanceMatches.set(
                source,
                source.noteId === note.id
                  ? new Set([source.originNoteVersionId, ...(versionsByEvidence.get(source.evidenceId) ?? [])])
                  : new Set<unknown>()
              );
            }
            return provenanceMatches.get(source)!.has(version.id);
          })
        )
          references.push({ type: 'knowledgeArtifactProvenance', id: record.id });
      }
      for (const id of questionReferences(version.id)) references.push({ type: 'questionSource', id });
      for (const id of annotationReferences(version.id)) references.push({ type: 'contentAnnotation', id });
      for (const id of exclusionReferences(version.id)) references.push({ type: 'annotationExclusion', id });
      for (const scope of analysisScopes)
        if (
          (scope.noteVersions as AnalysisScopeVersionBinding[] | null | undefined)?.some(binding => {
            if (binding.noteId !== note.id) return false;
            const resolved = resolvedScopes.get(scope) ?? new Map<AnalysisScopeVersionBinding, unknown>();
            resolvedScopes.set(scope, resolved);
            if (!resolved.has(binding))
              resolved.set(
                binding,
                resolveAnalysisScopeNoteVersion(scope as AnalysisScopeAliasSnapshot, binding, versions).id
              );
            return resolved.get(binding) === version.id;
          })
        )
          references.push({ type: 'analysisScopeSnapshot', id: scope.id });
      return {
        id: version.id,
        createdAt: version.createdAt,
        createdBy: version.createdBy,
        references,
        candidateAfterRetentionReview: references.length === 0,
        canPruneNow: false,
        reason: references.length ? 'retained-reference' : 'retention-point-not-modeled'
      };
    })
  };
}

// 首次实际访问才建索引：空版本不读取引用，且保留各引用类别的错误优先级。
function lazyReferenceIndex<Record extends { id?: unknown }>(
  records: Record[],
  targetIds: (record: Record) => Iterable<unknown>
) {
  let index: Map<unknown, unknown[]> | undefined;
  return (id: unknown) => {
    if (!index) {
      index = new Map();
      for (const record of records) for (const targetId of targetIds(record)) append(index, targetId, record.id);
    }
    return index.get(id) ?? [];
  };
}

function append<Key>(index: Map<Key, unknown[]>, key: Key, value: unknown) {
  const values = index.get(key) ?? [];
  values.push(value);
  index.set(key, values);
}
