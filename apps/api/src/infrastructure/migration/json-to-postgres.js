import fs from 'node:fs';
import path from 'node:path';
import { createAppError } from '../../errors/app-error.js';
import { LOCAL_DATA_SCHEMA_VERSION, validateLocalSnapshot, validatePersistedLocalState } from '../local-data-schema.js';
import { createMigrationReport } from './migration-report.js';
import {
  dbAnnotation,
  dbAnnotationExclusion,
  dbAnnotationRevision,
  dbAnalysisScopeSnapshot,
  dbAttachment,
  dbFolder,
  dbKnowledgeEvidence,
  dbKnowledgeArtifactProvenance,
  dbKnowledgeItem,
  dbLearningObjective,
  dbExamProfile,
  dbExamFocus,
  dbQuestion,
  dbQuestionObjective,
  dbQuestionSource,
  dbNote,
  dbNoteVersion,
  dbSpace,
  dbTag,
  dbTagGroup,
  dbUser
} from './db-mappers.js';
import {
  checksumPlan,
  transformAnnotation,
  transformAttachment,
  transformFolder,
  transformKnowledgeEvidence,
  transformKnowledgeItem,
  transformLearningObjective,
  transformExamProfile,
  transformExamFocus,
  transformQuestion,
  transformQuestionObjective,
  transformQuestionSource,
  transformNote,
  transformNoteVersion,
  transformSpace,
  transformTag,
  transformTagGroup,
  validateDatabaseConstraints
} from './json-transformers.js';
import { createPostgresAdvisoryLock } from '../postgres-advisory-lock.ts';
import { findInsecureImageUrls } from '../../modules/knowledge/application/note-content-policy.js';
import { createJournal, loadJournal, syncKey } from '../../modules/sync/journal.ts';
import {
  backfillKnowledgeArtifactProvenance,
  legacyKnowledgeExtractionReceipts
} from './knowledge-artifact-provenance-backfill.js';
import { assertNoKnowledgeArtifactProvenanceDowngrade } from '../../modules/knowledge/domain/knowledge-artifact-provenance-state.js';
import { mapKnowledgeArtifactProvenance } from '../../modules/knowledge/infrastructure/postgres/mappers.js';

const syncPlanCollections = Object.freeze({
  spaces: 'spaces',
  folders: 'folders',
  tags: 'tags',
  tagGroups: 'tagGroups',
  notes: 'notes',
  noteVersions: 'noteVersions',
  knowledgeItems: 'knowledgeItems',
  knowledgeEvidence: 'knowledgeEvidence',
  knowledgeArtifactProvenance: 'knowledgeArtifactProvenance',
  learningObjectives: 'learningObjectives',
  examProfiles: 'examProfiles',
  examFocuses: 'examFocuses',
  questions: 'questions',
  questionObjectives: 'questionObjectives',
  questionSources: 'questionSources',
  pdfAnnotations: 'pdfAnnotations',
  attachments: 'attachments',
  contentAnnotations: 'annotations',
  annotationExclusions: 'annotationExclusions',
  annotationRevisions: 'annotationRevisions',
  analysisScopeSnapshots: 'analysisScopeSnapshots'
});
const syncDbModels = Object.freeze({
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
  attachments: 'attachment',
  contentAnnotations: 'contentAnnotation',
  annotationExclusions: 'annotationExclusion',
  annotationRevisions: 'annotationRevision',
  analysisScopeSnapshots: 'analysisScopeSnapshot'
});

export function loadJsonMigrationSource(filePath) {
  const absolutePath = path.resolve(filePath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw createAppError('MIGRATION_SOURCE_INVALID', 'JSON migration source is invalid', 422, { cause: error });
  }
  return { absolutePath, raw, parsed };
}

/** @param {import('./migration-types.ts').JsonMigrationOptions} options */
export function buildJsonMigrationPlan({
  input,
  sourceFile = null,
  storageRootDir = process.cwd(),
  uploadsDir = null,
  fallbackTimestamp = new Date().toISOString(),
  allowMissingAttachments = false,
  ownerId = null
} = {}) {
  const reportTools = createMigrationReport({ sourceFile, storageRootDir });
  const { report } = reportTools;
  let state;
  try {
    state = Object.hasOwn(input ?? {}, 'data') ? validateLocalSnapshot(input).data : validatePersistedLocalState(input);
    if (!Object.hasOwn(input ?? {}, 'data') && (input.schemaVersion ?? 1) < LOCAL_DATA_SCHEMA_VERSION) {
      backfillKnowledgeArtifactProvenance(state, {
        receipts: legacyKnowledgeExtractionReceipts(input.knowledgeExtractionCommits),
        getTombstone: (collection, id) => input.sync?.tombstones?.[syncKey(collection, id)]
      });
    }
  } catch (error) {
    reportTools.error(error.code ?? 'MIGRATION_SOURCE_INVALID', error.message);
    return { plan: null, report: reportTools.finish(), canApply: false };
  }

  const original = input?.data ?? input ?? {};
  if (input?.schemaVersion === undefined && original.schemaVersion === undefined) {
    reportTools.repair('SCHEMA_VERSION_DEFAULTED', 'Source JSON has no schemaVersion; treated as local schema v1');
  }
  for (const note of state.notes) {
    const insecureUrls = findInsecureImageUrls(note.rawMarkdown);
    if (insecureUrls.length > 0) {
      reportTools.error(
        'INSECURE_IMAGE_URL',
        'Note contains insecure HTTP image sources and must be repaired before migration',
        { noteId: note.id, count: insecureUrls.length }
      );
    }
  }
  const plan = {
    users: [],
    spaces: state.spaces.map(space => transformSpace(space, fallbackTimestamp)),
    folders: state.folders.map(folder => transformFolder(folder, fallbackTimestamp)),
    tagGroups: state.tagGroups.map(group => transformTagGroup(group, fallbackTimestamp)),
    tags: state.tags.map(tag => transformTag(tag, fallbackTimestamp)),
    notes: state.notes.map(note => transformNote(note, fallbackTimestamp, reportTools)),
    pdfAnnotations: structuredClone(state.pdfAnnotations),
    noteVersions: [],
    knowledgeItems: state.knowledgeItems.map(item => transformKnowledgeItem(item, fallbackTimestamp, reportTools)),
    knowledgeEvidence: state.knowledgeEvidence.map(evidence => transformKnowledgeEvidence(evidence, fallbackTimestamp)),
    knowledgeArtifactProvenance: structuredClone(state.knowledgeArtifactProvenance),
    learningObjectives: state.learningObjectives.map(objective =>
      transformLearningObjective(objective, fallbackTimestamp)
    ),
    examProfiles: state.examProfiles.map(profile => transformExamProfile(profile, fallbackTimestamp)),
    examFocuses: state.examFocuses.map(focus => transformExamFocus(focus, fallbackTimestamp)),
    questions: state.questions.map(question => transformQuestion(question, fallbackTimestamp)),
    questionObjectives: state.questionObjectives.map(relation =>
      transformQuestionObjective(relation, fallbackTimestamp)
    ),
    questionSources: state.questionSources.map(source => transformQuestionSource(source, fallbackTimestamp)),
    noteTags: [],
    annotations: state.contentAnnotations.map(annotation =>
      transformAnnotation(annotation, fallbackTimestamp, reportTools)
    ),
    annotationExclusions: state.annotationExclusions.map(record => ({
      ...record,
      createdAt: record.createdAt ?? fallbackTimestamp,
      updatedAt: record.updatedAt ?? fallbackTimestamp
    })),
    annotationRevisions: state.annotationRevisions.map(record => ({
      ...record,
      createdAt: record.createdAt ?? fallbackTimestamp
    })),
    analysisScopeSnapshots: state.analysisScopeSnapshots.map(record => ({
      ...record,
      createdAt: record.createdAt ?? fallbackTimestamp
    })),
    attachments: []
  };

  const users = new Map();
  for (const space of plan.spaces) {
    if (!users.has(space.userId)) {
      users.set(space.userId, {
        id: space.userId,
        email: null,
        passwordHash: null,
        nickname: null,
        status: 'active',
        createdAt: space.createdAt,
        updatedAt: space.updatedAt
      });
    }
  }
  if (ownerId) {
    const normalizedOwnerId = String(ownerId).trim();
    const foreignSpaces = plan.spaces.filter(space => space.userId !== normalizedOwnerId);
    if (foreignSpaces.length > 0) {
      reportTools.error(
        'OWNER_BOUNDARY_VIOLATION',
        'Migration source contains knowledge spaces owned by another user',
        {
          ownerId: normalizedOwnerId,
          spaceIds: foreignSpaces.map(space => space.id)
        }
      );
    }
    if (normalizedOwnerId && !users.has(normalizedOwnerId)) {
      users.set(normalizedOwnerId, {
        id: normalizedOwnerId,
        email: null,
        passwordHash: null,
        nickname: null,
        status: 'active',
        createdAt: fallbackTimestamp,
        updatedAt: fallbackTimestamp
      });
    }
  }
  plan.users = [...users.values()];
  const versionsByNoteAndHash = new Map();
  for (const note of plan.notes) {
    const versions = state.noteVersions.filter(version => version.noteId === note.id);
    const sourceVersions =
      versions.length > 0
        ? versions.map(version => transformNoteVersion(version, fallbackTimestamp, reportTools))
        : [
            {
              id: `note-version-baseline-${note.id}`,
              noteId: note.id,
              content: note.rawMarkdown,
              contentHash: note.contentHash,
              createdAt: note.updatedAt,
              createdBy: 'system-migration'
            }
          ];
    for (const version of sourceVersions) {
      const key = `${version.noteId}\u0000${version.contentHash}`;
      if (!versionsByNoteAndHash.has(key)) {
        versionsByNoteAndHash.set(key, version);
        plan.noteVersions.push(version);
      }
    }
  }
  const versionByKey = new Map(
    plan.noteVersions.map(version => [`${version.noteId}\u0000${version.contentHash}`, version])
  );
  const versionAliases = new Map(
    state.noteVersions.map(version => [
      version.id,
      versionByKey.get(`${version.noteId}\u0000${version.contentHash}`)?.id ?? version.id
    ])
  );
  plan.annotations = plan.annotations.map(annotation => {
    if (annotation.noteVersionId)
      return { ...annotation, noteVersionId: versionAliases.get(annotation.noteVersionId) ?? annotation.noteVersionId };
    const version = versionByKey.get(`${annotation.noteId}\u0000${annotation.noteContentHash}`);
    if (version) return { ...annotation, noteVersionId: version.id };
    reportTools.warn('ANNOTATION_VERSION_UNRESOLVED', 'Annotation could not be safely bound to a NoteVersion', {
      annotationId: annotation.id
    });
    return { ...annotation, status: annotation.status === 'archived' ? annotation.status : 'stale' };
  });
  const annotationById = new Map(plan.annotations.map(annotation => [annotation.id, annotation]));
  const versionById = new Map(plan.noteVersions.map(version => [version.id, version]));
  plan.knowledgeEvidence = plan.knowledgeEvidence.map(evidence => {
    const annotation = evidence.annotationId ? annotationById.get(evidence.annotationId) : null;
    const resolvedVersionId = versionAliases.get(evidence.noteVersionId) ?? evidence.noteVersionId;
    const version = resolvedVersionId ? versionById.get(resolvedVersionId) : null;
    return {
      ...evidence,
      noteId: evidence.noteId ?? annotation?.noteId ?? version?.noteId ?? null,
      noteVersionId: resolvedVersionId ?? annotation?.noteVersionId ?? null,
      sourceId:
        evidence.sourceType === 'noteVersion'
          ? (version?.id ?? evidence.sourceId ?? null)
          : (evidence.sourceId ?? annotation?.id ?? version?.id ?? null),
      status:
        evidence.sourceType === 'annotation' && !annotation?.noteVersionId && evidence.status === 'valid'
          ? 'stale'
          : evidence.status
    };
  });
  plan.annotationExclusions = plan.annotationExclusions.map(record => ({
    ...record,
    noteVersionId: versionAliases.get(record.noteVersionId) ?? record.noteVersionId
  }));
  plan.questionSources = plan.questionSources.map(record =>
    record.sourceType === 'noteVersion'
      ? { ...record, sourceId: versionAliases.get(record.sourceId) ?? record.sourceId }
      : record
  );
  plan.noteTags = plan.notes.flatMap(note => note.tagIds.map(tagId => ({ noteId: note.id, tagId })));

  const noteIds = new Set(plan.notes.map(note => note.id));
  for (const attachment of state.attachments) {
    const transformed = transformAttachment(attachment, {
      storageRootDir,
      uploadsDir: uploadsDir ?? undefined,
      noteIds,
      allowMissingAttachments,
      fallbackTimestamp,
      reportTools
    });
    if (transformed) plan.attachments.push(transformed);
  }

  for (const collection of [
    'users',
    'spaces',
    'folders',
    'tagGroups',
    'tags',
    'notes',
    'noteVersions',
    'knowledgeItems',
    'knowledgeEvidence',
    'knowledgeArtifactProvenance',
    'learningObjectives',
    'examProfiles',
    'examFocuses',
    'questions',
    'questionObjectives',
    'questionSources',
    'noteTags',
    'annotations',
    'annotationExclusions',
    'annotationRevisions',
    'analysisScopeSnapshots',
    'pdfAnnotations',
    'attachments'
  ]) {
    reportTools.count(collection, plan[collection].length);
  }
  report.checksum = checksumPlan(plan);
  validateDatabaseConstraints(plan, reportTools);
  return {
    plan,
    report: reportTools.finish(),
    canApply: report.errors.length === 0
  };
}

/** @param {import('./migration-types.ts').ApplyJsonMigrationOptions} options */
export async function applyJsonMigration({
  client,
  plan,
  report,
  requireEmptyTarget = true,
  replaceExisting = false
} = {}) {
  if (!client) throw new TypeError('JSON migration requires a Prisma client');
  if (!plan || report?.errors?.length) {
    throw createAppError('MIGRATION_PRECHECK_FAILED', 'JSON migration preflight did not pass', 422, { report });
  }

  /** @param {import('./migration-client.ts').MigrationTransaction} tx */
  const applyPlan = async tx => {
    const existingProvenance = await tx.knowledgeArtifactProvenance.findMany();
    assertNoKnowledgeArtifactProvenanceDowngrade(
      { knowledgeArtifactProvenance: existingProvenance.map(mapKnowledgeArtifactProvenance) },
      plan
    );
    const previousJournals = tx.syncJournal ? await tx.syncJournal.findMany() : [];
    const presentIds = previousJournals.length
      ? Object.fromEntries(
          await Promise.all(
            Object.entries(syncDbModels).map(async ([collection, model]) => [
              collection,
              await tx[model].findMany({ select: { id: true } })
            ])
          )
        )
      : {};
    const normalizedJournals = previousJournals.map(old => ({ ...old, payload: loadJournal(old.payload, presentIds) }));
    for (const old of normalizedJournals) {
      for (const [collection, planCollection] of Object.entries(syncPlanCollections)) {
        for (const item of plan[planCollection] ?? []) {
          if (old.payload?.tombstones?.[syncKey(collection, item.id)]) {
            throw createAppError('IMPORT_DELETED_ID', '旧备份包含已经永久删除的对象，请使用新的资产 ID 导入。', 409, {
              collection,
              id: item.id
            });
          }
        }
      }
    }
    if (tx.syncJournal) await tx.syncJournal.deleteMany();
    if (requireEmptyTarget) await assertEmptyTarget(tx);
    if (replaceExisting) {
      await tx.analysisScopeSnapshot.deleteMany();
      await tx.annotationRevision.deleteMany();
      await tx.annotationExclusion.deleteMany();
      await tx.questionSource.deleteMany();
      await tx.questionObjective.deleteMany();
      await tx.question.deleteMany();
      await tx.examFocus.deleteMany();
      await tx.examProfile.deleteMany();
      await tx.learningObjective.deleteMany();
      await tx.knowledgeEvidence.deleteMany();
      await tx.knowledgeArtifactProvenance.deleteMany();
      await tx.knowledgeItem.deleteMany();
      await tx.contentAnnotation.deleteMany();
      await tx.noteVersion.deleteMany();
      await tx.attachment.deleteMany();
      await tx.noteTag.deleteMany();
      await tx.note.deleteMany();
      await tx.tag.deleteMany();
      await tx.tagGroup.deleteMany();
      await tx.folder.deleteMany();
      await tx.knowledgeSpace.deleteMany();
      await tx.user.deleteMany();
    }
    if (plan.users.length) await tx.user.createMany({ data: plan.users.map(dbUser) });
    if (plan.spaces.length) await tx.knowledgeSpace.createMany({ data: plan.spaces.map(dbSpace) });
    if (plan.folders.length) await tx.folder.createMany({ data: plan.folders.map(dbFolder) });
    if (plan.tagGroups.length) await tx.tagGroup.createMany({ data: plan.tagGroups.map(dbTagGroup) });
    if (plan.tags.length) await tx.tag.createMany({ data: plan.tags.map(dbTag) });
    if (plan.notes.length) await tx.note.createMany({ data: plan.notes.map(dbNote) });
    if (plan.noteVersions.length) await tx.noteVersion.createMany({ data: plan.noteVersions.map(dbNoteVersion) });
    if (plan.noteTags.length) await tx.noteTag.createMany({ data: plan.noteTags });
    if (plan.annotations.length) await tx.contentAnnotation.createMany({ data: plan.annotations.map(dbAnnotation) });
    if (plan.annotationExclusions.length)
      await tx.annotationExclusion.createMany({ data: plan.annotationExclusions.map(dbAnnotationExclusion) });
    if (plan.pdfAnnotations?.length)
      await tx.pdfAnnotation.createMany({
        data: plan.pdfAnnotations.map(value => ({
          id: value.id,
          noteId: value.noteId,
          revision: value.revision,
          payload: value
        }))
      });
    if (plan.annotationRevisions.length)
      await tx.annotationRevision.createMany({ data: plan.annotationRevisions.map(dbAnnotationRevision) });
    if (plan.analysisScopeSnapshots.length)
      await tx.analysisScopeSnapshot.createMany({ data: plan.analysisScopeSnapshots.map(dbAnalysisScopeSnapshot) });
    if (plan.knowledgeItems.length)
      await tx.knowledgeItem.createMany({ data: plan.knowledgeItems.map(dbKnowledgeItem) });
    if (plan.knowledgeEvidence.length)
      await tx.knowledgeEvidence.createMany({ data: plan.knowledgeEvidence.map(dbKnowledgeEvidence) });
    if (plan.knowledgeArtifactProvenance.length)
      await tx.knowledgeArtifactProvenance.createMany({
        data: plan.knowledgeArtifactProvenance.map(dbKnowledgeArtifactProvenance)
      });
    if (plan.learningObjectives.length)
      await tx.learningObjective.createMany({ data: plan.learningObjectives.map(dbLearningObjective) });
    if (plan.examProfiles.length) await tx.examProfile.createMany({ data: plan.examProfiles.map(dbExamProfile) });
    if (plan.examFocuses.length) await tx.examFocus.createMany({ data: plan.examFocuses.map(dbExamFocus) });
    if (plan.questions.length) await tx.question.createMany({ data: plan.questions.map(dbQuestion) });
    if (plan.questionObjectives.length)
      await tx.questionObjective.createMany({ data: plan.questionObjectives.map(dbQuestionObjective) });
    if (plan.questionSources.length)
      await tx.questionSource.createMany({ data: plan.questionSources.map(dbQuestionSource) });
    if (plan.attachments.length) {
      await tx.attachment.createMany({ data: plan.attachments.map(dbAttachment) });
    }
    if (tx.syncJournal) {
      const state = Object.fromEntries(
        Object.entries(syncPlanCollections).map(([collection, source]) => [collection, plan[source] ?? []])
      );
      const previous = normalizedJournals.find(row => row.ownerId === plan.users[0]?.id);
      const journal = createJournal(state);
      journal.tombstones = structuredClone(previous?.payload?.tombstones ?? {});
      for (const [key, tombstone] of Object.entries(journal.tombstones)) journal.revisions[key] = tombstone.revision;
      await tx.syncJournal.create({ data: { ownerId: plan.users[0]?.id ?? 'demo', payload: journal } });
    }
  };
  const advisoryLock = createPostgresAdvisoryLock(client);
  if (typeof client.$transaction === 'function') {
    await advisoryLock.runExclusive(applyPlan);
  } else {
    await applyPlan(client);
  }
  report.status = 'applied';
  report.appliedAt = new Date().toISOString();
  return report;
}

export async function assertEmptyTarget(client) {
  const models = [
    'user',
    'knowledgeSpace',
    'folder',
    'tagGroup',
    'tag',
    'note',
    'noteTag',
    'pdfAnnotation',
    'attachment',
    'contentAnnotation',
    'annotationExclusion',
    'annotationRevision',
    'analysisScopeSnapshot',
    'noteVersion',
    'knowledgeItem',
    'knowledgeEvidence',
    'knowledgeArtifactProvenance',
    'learningObjective',
    'examProfile',
    'examFocus',
    'question',
    'questionObjective',
    'questionSource'
  ];
  for (const model of models) {
    const count = await client[model].count();
    if (count > 0) {
      throw createAppError('MIGRATION_TARGET_NOT_EMPTY', `PostgreSQL target is not empty: ${model}`, 409, {
        model,
        count
      });
    }
  }
}

export const migrationSchemaVersion = LOCAL_DATA_SCHEMA_VERSION;
