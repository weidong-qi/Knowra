import { hasAttachmentReference } from '@study-accelerator/shared/attachments';
import { LOCAL_DATA_COLLECTIONS } from './local-data-schema.js';
import { validateKnowledgeArtifactProvenance } from '../modules/knowledge/domain/knowledge-artifact-provenance-contract.js';
import type { AttachmentDeletionPreflight } from '../../../../packages/web-core/src/workspace/types.ts';
import type { AttachmentFileMetadata } from './local-attachment-types.ts';

interface AttachmentReferenceRecord {
  id: string;
  title?: string | null;
  fileName?: string | null;
  name?: string | null;
  knowledgeItemId?: string | null;
  artifactId?: string;
  noteId?: string | null;
  deleted?: boolean;
  deletedAt?: string | Date | null;
}
type ReferenceCollection = keyof typeof POSTGRES_MODELS;
export type AttachmentReferenceState = Partial<{
  [K in ReferenceCollection]: K extends 'knowledgeArtifactProvenance' ? unknown[] : AttachmentReferenceRecord[];
}> & { attachments?: AttachmentFileMetadata[] };
interface AttachmentReferenceModel {
  findMany(): Promise<AttachmentReferenceRecord[]>;
}
interface ProvenanceReferenceModel {
  findMany(): Promise<{ payload: unknown }[]>;
}
export type AttachmentReferenceDatabase = Partial<{
  [M in (typeof POSTGRES_MODELS)[ReferenceCollection]]: M extends 'knowledgeArtifactProvenance'
    ? ProvenanceReferenceModel
    : AttachmentReferenceModel;
}>;

// Only persisted business records are scanned here. Offline copies, backups and
// in-flight work need their own lifecycle protocol before general purge is opened.
const REFERENCE_COLLECTIONS = LOCAL_DATA_COLLECTIONS.filter(
  collection => collection !== 'attachments'
) as ReferenceCollection[];

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
  contentAnnotations: 'contentAnnotation',
  annotationExclusions: 'annotationExclusion',
  annotationRevisions: 'annotationRevision',
  analysisScopeSnapshots: 'analysisScopeSnapshot'
});

function referenceCategory(collection: ReferenceCollection) {
  if (collection === 'noteVersions' || collection === 'analysisScopeSnapshots' || collection === 'annotationRevisions')
    return 'history';
  if (collection === 'notes') return 'shared';
  if (collection === 'knowledgeEvidence' || collection === 'questionSources') return 'independent';
  return 'exclusive';
}

export function inspectAttachmentDeletion(
  attachmentId: string,
  state: AttachmentReferenceState
): AttachmentDeletionPreflight {
  const references: AttachmentDeletionPreflight['references'] = [];
  for (const collection of REFERENCE_COLLECTIONS) {
    for (const record of state[collection] ?? []) {
      const content =
        collection === 'knowledgeArtifactProvenance'
          ? (validateKnowledgeArtifactProvenance(record).sources?.map(source => source.quoteText) ?? [])
          : record;
      if (!hasAttachmentReference(content, attachmentId)) continue;
      const knowledgeItemId =
        collection === 'knowledgeItems'
          ? (record as AttachmentReferenceRecord).id
          : collection === 'knowledgeArtifactProvenance'
            ? (record as AttachmentReferenceRecord).artifactId
            : (record as AttachmentReferenceRecord).knowledgeItemId;
      const item = state.knowledgeItems?.find(item => item.id === knowledgeItemId && !item.deletedAt);
      references.push({
        category: referenceCategory(collection),
        collection,
        id: (record as AttachmentReferenceRecord).id,
        title: String(
          (record as AttachmentReferenceRecord).title ||
            (record as AttachmentReferenceRecord).fileName ||
            (record as AttachmentReferenceRecord).name ||
            item?.title ||
            ((record as AttachmentReferenceRecord).noteId &&
              state.notes?.find(note => note.id === (record as AttachmentReferenceRecord).noteId)?.title) ||
            (record as AttachmentReferenceRecord).id
        ),
        ...(item ? { knowledgeItemId: item.id } : {}),
        ...((record as AttachmentReferenceRecord).noteId
          ? { noteId: (record as AttachmentReferenceRecord).noteId as string }
          : {}),
        ...(collection === 'notes' &&
        ((record as AttachmentReferenceRecord).deleted || (record as AttachmentReferenceRecord).deletedAt)
          ? { retention: 'recycle-bin' }
          : {}),
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

export async function loadPostgresAttachmentReferenceState(
  db: AttachmentReferenceDatabase
): Promise<AttachmentReferenceState> {
  const entries = await Promise.all(
    REFERENCE_COLLECTIONS.map(async collection => {
      const model = POSTGRES_MODELS[collection];
      if (!db[model]?.findMany) {
        throw new TypeError(`Attachment reference scan requires ${model}.findMany`);
      }
      const rows = await db[model]!.findMany();
      return [
        collection,
        collection === 'knowledgeArtifactProvenance' ? (rows as { payload: unknown }[]).map(row => row.payload) : rows
      ];
    })
  );
  return Object.fromEntries(entries) as AttachmentReferenceState;
}
