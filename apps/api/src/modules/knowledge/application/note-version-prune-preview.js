import { calculateContentHash } from '../domain/note-version.ts';
import { resolveAnalysisScopeNoteVersion } from '../domain/analysis-scope-version-alias.ts';

export function buildNoteVersionPrunePreview({
  note,
  versions,
  evidence,
  provenance = [],
  questionSources,
  annotations,
  exclusions,
  analysisScopes
}) {
  const currentHash = calculateContentHash(note.rawMarkdown);
  const evidenceByVersion = new Map();
  const versionsByEvidence = new Map();
  for (const record of evidence) {
    if (!record.noteVersionId) continue;
    append(evidenceByVersion, record.noteVersionId, record.id);
    const ids = versionsByEvidence.get(record.id) ?? new Set();
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
  const resolvedScopes = new Map();
  const provenanceMatches = new Map();
  return {
    noteId: note.id,
    mode: 'preview-only',
    retentionPointMetadataAvailable: false,
    versions: versions.map(version => {
      const references = [];
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
                  : new Set()
              );
            }
            return provenanceMatches.get(source).has(version.id);
          })
        )
          references.push({ type: 'knowledgeArtifactProvenance', id: record.id });
      }
      for (const id of questionReferences(version.id)) references.push({ type: 'questionSource', id });
      for (const id of annotationReferences(version.id)) references.push({ type: 'contentAnnotation', id });
      for (const id of exclusionReferences(version.id)) references.push({ type: 'annotationExclusion', id });
      for (const scope of analysisScopes)
        if (
          scope.noteVersions?.some(binding => {
            if (binding.noteId !== note.id) return false;
            const resolved = resolvedScopes.get(scope) ?? new Map();
            resolvedScopes.set(scope, resolved);
            if (!resolved.has(binding))
              resolved.set(binding, resolveAnalysisScopeNoteVersion(scope, binding, versions).id);
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
function lazyReferenceIndex(records, targetIds) {
  let index;
  return id => {
    if (!index) {
      index = new Map();
      for (const record of records) for (const targetId of targetIds(record)) append(index, targetId, record.id);
    }
    return index.get(id) ?? [];
  };
}

function append(index, key, value) {
  const values = index.get(key) ?? [];
  values.push(value);
  index.set(key, values);
}
