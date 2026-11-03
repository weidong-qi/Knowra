import { syncKey } from '../../api/src/modules/sync/journal.ts';
import { createNoteVersionReferenceIndex } from '../../api/src/modules/knowledge/domain/note-version-references.ts';
import { referencedAnnotationRevisions } from '../../api/src/modules/knowledge/domain/history-retention.ts';
import { readPrivateHistoryReferences } from './note-version-discard-gate.mjs';
import { hasDeletionFact } from './sqlite-deletion-facts.mjs';

/** 云端看不到设备私有任务：它们需要的历史只保留为本机副本，不恢复云端已退休的 ID。 */
export function preserveLocalHistoryCopies(db, local, merged, remote) {
  let privateReferences;
  const privateRecords = () => (privateReferences ??= readPrivateHistoryReferences(db));
  const retired = (collection, id) =>
    remote.get(syncKey(collection, id))?.value === null || hasDeletionFact(db, collection, id);
  const annotationIds = new Set(merged.contentAnnotations.map(item => item.id));
  const revisionIds = new Set(merged.annotationRevisions.map(item => item.id));
  let isRevisionReferenced;
  for (const record of local.annotationRevisions) {
    if (
      revisionIds.has(record.id) ||
      !annotationIds.has(record.annotationId) ||
      !retired('annotationRevisions', record.id)
    )
      continue;
    isRevisionReferenced ??= referencedAnnotationRevisions(merged, privateRecords());
    if (isRevisionReferenced(record)) merged.annotationRevisions.push(record);
  }
  const versionIds = new Set(merged.noteVersions.map(item => item.id));
  const noteIds = new Set(merged.notes.map(item => item.id));
  let isVersionReferenced;
  for (const version of local.noteVersions) {
    if (versionIds.has(version.id) || !noteIds.has(version.noteId)) continue;
    if (retired('noteVersions', version.id)) {
      isVersionReferenced ??= createNoteVersionReferenceIndex({
        ...Object.fromEntries(
          [
            'contentAnnotations',
            'annotationRevisions',
            'annotationExclusions',
            'knowledgeEvidence',
            'knowledgeArtifactProvenance',
            'questionSources',
            'analysisScopeSnapshots'
          ].map(name => [name, merged[name]])
        ),
        external: privateRecords()
      });
      if (!isVersionReferenced(version)) continue;
    }
    merged.noteVersions.push(version);
  }
}
