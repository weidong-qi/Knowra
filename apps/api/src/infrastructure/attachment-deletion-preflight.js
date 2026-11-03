import { hasAttachmentReference } from '@study-accelerator/shared/attachments';
import { LOCAL_DATA_COLLECTIONS } from './local-data-schema.js';
import { validateKnowledgeArtifactProvenance } from '../modules/knowledge/domain/knowledge-artifact-provenance-contract.js';

// Only persisted business records are scanned here. Offline copies, backups and
// in-flight work need their own lifecycle protocol before general purge is opened.
const REFERENCE_COLLECTIONS = LOCAL_DATA_COLLECTIONS.filter(collection => collection !== 'attachments');

const POSTGRES_MODELS = Object.freeze({
  spaces: 'knowledgeSpace',
  folders: 'folder',
  tags: 'tag',
  tagGroups: 'tagGroup',
  notes: 'note',
  noteVersions: 'noteVersion',
  knowledgeItems: 'knowledgeItem',
  knowledgeEvidence: 'knowledgeEvidence',
  knowledgeArtifactProvenance: 'knowledgeArtifactProvenance',
  learningObjectives: 'learningObjective',
  examProfiles: 'examProfile',
  examFocuses: 'examFocus',
  questions: 'question',
  questionObjectives: 'questionObjective',
  questionSources: 'questionSource',
  pdfAnnotations: 'pdfAnnotation',
  contentAnnotations: 'contentAnnotation',
  annotationExclusions: 'annotationExclusion',
  annotationRevisions: 'annotationRevision',
  analysisScopeSnapshots: 'analysisScopeSnapshot'
});

function referenceCategory(collection) {
  if (collection === 'noteVersions' || collection === 'analysisScopeSnapshots' || collection === 'annotationRevisions')
    return 'history';
  if (collection === 'notes') return 'shared';
  if (collection === 'knowledgeEvidence' || collection === 'questionSources') return 'independent';
  return 'exclusive';
}

export function inspectAttachmentDeletion(attachmentId, state) {
  const references = [];
  for (const collection of REFERENCE_COLLECTIONS) {
    for (const record of state[collection] ?? []) {
      const content =
        collection === 'knowledgeArtifactProvenance'
          ? (validateKnowledgeArtifactProvenance(record).sources?.map(source => source.quoteText) ?? [])
          : record;
      if (!hasAttachmentReference(content, attachmentId)) continue;
      const knowledgeItemId =
        collection === 'knowledgeItems'
          ? record.id
          : collection === 'knowledgeArtifactProvenance'
            ? record.artifactId
            : record.knowledgeItemId;
      const item = state.knowledgeItems?.find(item => item.id === knowledgeItemId && !item.deletedAt);
      references.push({
        category: referenceCategory(collection),
        collection,
        id: record.id,
        title: String(
          record.title ||
            record.fileName ||
            record.name ||
            item?.title ||
            (record.noteId && state.notes?.find(note => note.id === record.noteId)?.title) ||
            record.id
        ),
        ...(item ? { knowledgeItemId: item.id } : {}),
        ...(record.noteId ? { noteId: record.noteId } : {}),
        ...(collection === 'notes' && (record.deleted || record.deletedAt) ? { retention: 'recycle-bin' } : {}),
        reasonCode: 'ATTACHMENT_REFERENCED'
      });
    }
  }
  return {
    asset: { type: 'attachment', id: attachmentId },
    operation: 'delete-unreferenced-file',
    decision: references.length ? 'requires-dependency-action' : 'can-purge-no-history',
    references,
    reasonCodes: references.length ? ['ATTACHMENT_REFERENCED'] : [],
    coverage: {
      persistedCurrentAndHistory: true,
      offlineDevices: 'unverified',
      backups: 'unverified',
      runningTasks: 'unverified'
    }
  };
}

export async function loadPostgresAttachmentReferenceState(db) {
  const entries = await Promise.all(
    REFERENCE_COLLECTIONS.map(async collection => {
      const model = POSTGRES_MODELS[collection];
      if (!db[model]?.findMany) {
        throw new TypeError(`Attachment reference scan requires ${model}.findMany`);
      }
      const rows = await db[model].findMany();
      return [
        collection,
        ['knowledgeArtifactProvenance', 'pdfAnnotations'].includes(collection) ? rows.map(row => row.payload) : rows
      ];
    })
  );
  return Object.fromEntries(entries);
}
