import { calculateContentHash } from '../domain/note-version.ts';
import { resolveAnalysisScopeNoteVersion } from '../domain/analysis-scope-version-alias.ts';

import type { SyncMappedEntityMap } from '../../sync/postgres-state-types.ts';
import type { NoteVersion } from '../domain/note-version.ts';
import type {
  AnalysisScopeAliasSnapshot,
  AnalysisScopeAliasVersion,
  AnalysisScopeVersionBinding
} from '../domain/analysis-scope-version-alias.ts';

export interface VersionReferenceRecord {
  id: string;
  noteVersionId?: string | null;
}
export interface PruneProvenanceSource {
  noteId?: string;
  originNoteVersionId?: string;
  evidenceId?: string;
}
export interface PruneAnalysisScope extends AnalysisScopeAliasSnapshot {
  id: string;
  noteVersions?: AnalysisScopeVersionBinding[] | null;
}
type PruneScopeInput =
  | PruneAnalysisScope
  | Pick<SyncMappedEntityMap['analysisScopeSnapshots'], 'id' | 'noteVersions' | 'segments' | 'contextSegments'>;

export interface NoteVersionPruneInput {
  note: { id: string; rawMarkdown: string };
  versions: (AnalysisScopeAliasVersion & Partial<Pick<NoteVersion, 'createdAt' | 'createdBy'>>)[];
  evidence: VersionReferenceRecord[];
  provenance?: { id: string; sources?: PruneProvenanceSource[] | null }[];
  questionSources: { id: string; sourceType?: string; sourceId?: string | null }[];
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
  id: string;
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
  const evidenceByVersion = new Map<string, string[]>();
  const versionsByEvidence = new Map<string | null | undefined, Set<string>>();
  for (const record of evidence) {
    if (!record.noteVersionId) continue;
    append(evidenceByVersion, record.noteVersionId, record.id);
    const ids = versionsByEvidence.get(record.id) ?? new Set<string>();
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
  const resolvedScopes = new Map<PruneScopeInput, Map<AnalysisScopeVersionBinding, string>>();
  const provenanceMatches = new Map<PruneProvenanceSource, Set<string | undefined>>();
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
                  : new Set<string | undefined>()
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
            const resolved = resolvedScopes.get(scope) ?? new Map<AnalysisScopeVersionBinding, string>();
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
function lazyReferenceIndex<Record extends { id: string }>(
  records: Record[],
  targetIds: (record: Record) => Iterable<string | null | undefined>
) {
  let index: Map<string | null | undefined, string[]> | undefined;
  return (id: string) => {
    if (!index) {
      index = new Map();
      for (const record of records) for (const targetId of targetIds(record)) append(index, targetId, record.id);
    }
    return index.get(id) ?? [];
  };
}

function append<Key>(index: Map<Key, string[]>, key: Key, value: string) {
  const values = index.get(key) ?? [];
  values.push(value);
  index.set(key, values);
}
