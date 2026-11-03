import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import type * as Models from '@prisma/client';
import type { SyncMappedEntityMap } from '../../../sync/postgres-state-types.ts';

export type NoteRow = Models.Note & { noteTags?: Pick<Models.NoteTag, 'tagId'>[] | null };
export type MappedUser = Omit<Models.User, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string };
type Mapped<Row, Output> = Row extends null | undefined ? null : Output;
import { createAppError } from '../../../../errors/app-error.js';
import { validateKnowledgeArtifactProvenance } from '../../domain/knowledge-artifact-provenance-contract.js';

export function toDate(value: unknown, fallback: unknown = new Date()): Date {
  if (value instanceof Date) {
    return value;
  }
  const date = new Date((value ?? fallback) as string);
  return Number.isNaN(date.getTime()) ? new Date(fallback as string) : date;
}

export function toIso(value: unknown, fallback: unknown = new Date()): string {
  return toDate(value, fallback).toISOString();
}

export function mapUser<Row extends Models.User | null | undefined>(row: Row): Mapped<Row, MappedUser>;
export function mapUser(row: Models.User): MappedUser;
export function mapUser(row: Models.User | null | undefined): MappedUser | null {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email ?? null,
    passwordHash: row.passwordHash ?? null,
    nickname: row.nickname ?? null,
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

export function mapSpace<Row extends Models.KnowledgeSpace | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['spaces']>;
export function mapSpace(row: Models.KnowledgeSpace): SyncMappedEntityMap['spaces'];
export function mapSpace(row: Models.KnowledgeSpace | null | undefined): SyncMappedEntityMap['spaces'] | null {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description ?? '',
    defaultFlag: Boolean(row.defaultFlag),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

export function mapFolder<Row extends Models.Folder | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['folders']>;
export function mapFolder(row: Models.Folder): SyncMappedEntityMap['folders'];
export function mapFolder(row: Models.Folder | null | undefined): SyncMappedEntityMap['folders'] | null {
  if (!row) return null;
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    parentId: row.parentId ?? null,
    pathCache: row.pathCache ?? '/',
    sortOrder: Number(row.sortOrder ?? 0),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    deletedAt: row.deletedAt ? toIso(row.deletedAt) : null,
    deletionPackage: row.deletionPackage ?? null
  };
}

export function mapTag<Row extends Models.Tag | null | undefined>(row: Row): Mapped<Row, SyncMappedEntityMap['tags']>;
export function mapTag(row: Models.Tag): SyncMappedEntityMap['tags'];
export function mapTag(row: Models.Tag | null | undefined): SyncMappedEntityMap['tags'] | null {
  if (!row) return null;
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    color: row.color ?? 'slate',
    groupId: row.groupId ?? null,
    code: row.code ?? null,
    isSystem: Boolean(row.isSystem),
    sortOrder: Number(row.sortOrder ?? 0),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

export function mapTagGroup<Row extends Models.TagGroup | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['tagGroups']>;
export function mapTagGroup(row: Models.TagGroup): SyncMappedEntityMap['tagGroups'];
export function mapTagGroup(row: Models.TagGroup | null | undefined): SyncMappedEntityMap['tagGroups'] | null {
  if (!row) return null;
  return {
    id: row.id,
    spaceId: row.spaceId,
    code: row.code ?? null,
    name: row.name,
    selectionMode: row.selectionMode ?? 'multiple',
    isSystem: Boolean(row.isSystem),
    sortOrder: Number(row.sortOrder ?? 0),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

export function mapNote<Row extends NoteRow | null | undefined>(row: Row): Mapped<Row, SyncMappedEntityMap['notes']>;
export function mapNote(row: NoteRow): SyncMappedEntityMap['notes'];
export function mapNote(row: NoteRow | null | undefined): SyncMappedEntityMap['notes'] | null {
  if (!row) return null;
  const internalLinks = Array.isArray(row.internalLinks) ? row.internalLinks : [];
  return {
    id: row.id,
    spaceId: row.spaceId,
    folderId: row.folderId ?? null,
    title: row.title,
    rawMarkdown: row.rawMarkdown,
    annotationStructure: row.annotationStructure ?? null,
    plainText: row.plainText ?? '',
    internalLinks: [...internalLinks],
    contentHash: row.contentHash ?? null,
    status: row.status,
    sourceType: row.sourceType,
    favorite: Boolean(row.favorite),
    aiVisibility: row.aiVisibility ?? 'normal',
    deleted: row.deletedAt !== null && row.deletedAt !== undefined,
    folderDeletionPackageId: row.folderDeletionPackageId ?? null,
    deletionPackage: row.deletionPackage ?? null,
    tagIds: (row.noteTags ?? []).map(relation => relation.tagId),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

export function mapAttachment<Row extends Models.Attachment | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['attachments']>;
export function mapAttachment(row: Models.Attachment): SyncMappedEntityMap['attachments'];
export function mapAttachment(row: Models.Attachment | null | undefined): SyncMappedEntityMap['attachments'] | null {
  if (!row) return null;
  return {
    id: row.id,
    noteId: row.noteId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    size: Number(row.size),
    sha256: row.sha256 ?? null,
    status: row.status ?? 'ready',
    storagePath: row.storagePath,
    verifiedAt: row.verifiedAt ? toIso(row.verifiedAt) : null,
    createdAt: toIso(row.createdAt)
  };
}

export function mapAnnotation<Row extends Models.ContentAnnotation | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['contentAnnotations']>;
export function mapAnnotation(row: Models.ContentAnnotation): SyncMappedEntityMap['contentAnnotations'];
export function mapAnnotation(
  row: Models.ContentAnnotation | null | undefined
): SyncMappedEntityMap['contentAnnotations'] | null {
  if (!row) return null;
  return {
    id: row.id,
    spaceId: row.spaceId,
    noteId: row.noteId,
    noteVersionId: row.noteVersionId ?? null,
    kind: row.kind,
    sourceMode: row.sourceMode,
    quoteText: row.quoteText,
    headingPath: Array.isArray(row.headingPath) ? [...row.headingPath] : [],
    fromPosition: row.fromPosition,
    toPosition: row.toPosition,
    prefixText: row.prefixText ?? '',
    suffixText: row.suffixText ?? '',
    anchorFingerprint: row.anchorFingerprint,
    noteContentHash: row.noteContentHash,
    idempotencyKey: row.idempotencyKey,
    schemaVersion: Number(row.schemaVersion ?? 1),
    scopeType: row.scopeType ?? 'selection',
    importance: row.importance ?? null,
    comment: row.comment ?? '',
    lifecycleStatus: row.lifecycleStatus ?? (row.status === 'archived' ? 'archived' : 'active'),
    anchorStatus: row.anchorStatus ?? (row.status === 'stale' ? 'needsReview' : 'resolved'),
    anchorReason: row.anchorReason ?? null,
    revision: Number(row.revision ?? 1),
    anchor: row.anchor ?? null,
    originSnapshot: row.originSnapshot ?? null,
    identityBinding: row.identityBinding ?? null,
    resolvedContentHash: row.resolvedContentHash ?? null,
    boundaryFingerprint: row.boundaryFingerprint ?? null,
    requestHash: row.requestHash ?? null,
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    deletedAt: row.deletedAt ? toIso(row.deletedAt) : null
  };
}

export function mapNoteVersion<Row extends Models.NoteVersion | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['noteVersions']>;
export function mapNoteVersion(row: Models.NoteVersion): SyncMappedEntityMap['noteVersions'];
export function mapNoteVersion(row: Models.NoteVersion | null | undefined): SyncMappedEntityMap['noteVersions'] | null {
  if (!row) return null;
  return {
    id: row.id,
    noteId: row.noteId,
    content: row.content,
    contentHash: row.contentHash,
    createdAt: toIso(row.createdAt),
    createdBy: row.createdBy
  };
}

export function mapKnowledgeItem<Row extends Models.KnowledgeItem | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['knowledgeItems']>;
export function mapKnowledgeItem(row: Models.KnowledgeItem): SyncMappedEntityMap['knowledgeItems'];
export function mapKnowledgeItem(
  row: Models.KnowledgeItem | null | undefined
): SyncMappedEntityMap['knowledgeItems'] | null {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    canonicalStatement: row.canonicalStatement,
    userExplanation: row.userExplanation ?? '',
    knowledgeType: row.knowledgeType ?? 'concept',
    importance: row.importance === null || row.importance === undefined ? null : Number(row.importance),
    reviewStatus: row.reviewStatus ?? 'candidate',
    sourceMode: row.sourceMode ?? 'manual',
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    deletedAt: row.deletedAt ? toIso(row.deletedAt) : null
  };
}

export function mapKnowledgeEvidence<Row extends Models.KnowledgeEvidence | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['knowledgeEvidence']>;
export function mapKnowledgeEvidence(row: Models.KnowledgeEvidence): SyncMappedEntityMap['knowledgeEvidence'];
export function mapKnowledgeEvidence(
  row: Models.KnowledgeEvidence | null | undefined
): SyncMappedEntityMap['knowledgeEvidence'] | null {
  if (!row) return null;
  return {
    id: row.id,
    knowledgeItemId: row.knowledgeItemId,
    sourceType: row.sourceType,
    sourceId: row.sourceId ?? null,
    noteId: row.noteId ?? null,
    noteVersionId: row.noteVersionId ?? null,
    annotationId: row.annotationId ?? null,
    quoteText: row.quoteText ?? '',
    headingPath: Array.isArray(row.headingPath) ? [...row.headingPath] : [],
    relationType: row.relationType ?? 'supports',
    status: row.status ?? 'valid',
    applicabilityStatus: row.applicabilityStatus ?? (row.status === 'invalid' ? 'needsReview' : 'active'),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

export function mapLearningObjective<Row extends Models.LearningObjective | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['learningObjectives']>;
export function mapLearningObjective(row: Models.LearningObjective): SyncMappedEntityMap['learningObjectives'];
export function mapLearningObjective(
  row: Models.LearningObjective | null | undefined
): SyncMappedEntityMap['learningObjectives'] | null {
  if (!row) return null;
  return {
    id: row.id,
    knowledgeItemId: row.knowledgeItemId,
    objective: row.objective ?? '',
    actionVerb: row.actionVerb ?? '',
    cognitiveLevel: row.cognitiveLevel ?? '',
    difficultyHint: row.difficultyHint ?? null,
    reviewStatus: row.reviewStatus ?? 'candidate',
    reviewNote: row.reviewNote ?? null,
    deletedAt: row.deletedAt ? toIso(row.deletedAt) : null,
    order: Number(row.order ?? 0),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

export function mapExamProfile<Row extends Models.ExamProfile | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['examProfiles']>;
export function mapExamProfile(row: Models.ExamProfile): SyncMappedEntityMap['examProfiles'];
export function mapExamProfile(row: Models.ExamProfile | null | undefined): SyncMappedEntityMap['examProfiles'] | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    scope: Array.isArray(row.scope) ? [...row.scope] : [],
    language: row.language ?? 'zh-CN',
    commonQuestionTypes: Array.isArray(row.commonQuestionTypes) ? [...row.commonQuestionTypes] : [],
    difficultyProfile:
      row.difficultyProfile && typeof row.difficultyProfile === 'object' ? structuredClone(row.difficultyProfile) : {},
    archivedAt: row.archivedAt ? toIso(row.archivedAt) : null,
    deletedAt: row.deletedAt ? toIso(row.deletedAt) : null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

export function mapExamFocus<Row extends Models.ExamFocus | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['examFocuses']>;
export function mapExamFocus(row: Models.ExamFocus): SyncMappedEntityMap['examFocuses'];
export function mapExamFocus(row: Models.ExamFocus | null | undefined): SyncMappedEntityMap['examFocuses'] | null {
  if (!row) return null;
  return {
    id: row.id,
    examProfileId: row.examProfileId,
    learningObjectiveId: row.learningObjectiveId,
    description: row.description ?? '',
    priority: Number(row.priority ?? 1),
    difficultyHint: row.difficultyHint ?? null,
    questionTypeSuggestions: Array.isArray(row.questionTypeSuggestions) ? [...row.questionTypeSuggestions] : [],
    sourceType: row.sourceType ?? 'manual',
    reviewStatus: row.reviewStatus ?? 'candidate',
    deletedAt: row.deletedAt ? toIso(row.deletedAt) : null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

export function mapQuestion<Row extends Models.Question | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['questions']>;
export function mapQuestion(row: Models.Question): SyncMappedEntityMap['questions'];
export function mapQuestion(row: Models.Question | null | undefined): SyncMappedEntityMap['questions'] | null {
  if (!row) return null;
  return {
    id: row.id,
    questionType: row.questionType,
    stem: row.stem ?? '',
    options: row.options === null || row.options === undefined ? null : structuredClone(row.options),
    referenceAnswer:
      row.referenceAnswer === null || row.referenceAnswer === undefined ? null : structuredClone(row.referenceAnswer),
    rubric: row.rubric === null || row.rubric === undefined ? null : structuredClone(row.rubric),
    explanation: row.explanation ?? '',
    difficulty: row.difficulty ?? null,
    reviewStatus: row.reviewStatus ?? 'draft',
    sourceMode: row.sourceMode ?? 'manual',
    version: Number(row.version ?? 1),
    deletedAt: row.deletedAt ? toIso(row.deletedAt) : null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

export function mapQuestionObjective<Row extends Models.QuestionObjective | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['questionObjectives']>;
export function mapQuestionObjective(row: Models.QuestionObjective): SyncMappedEntityMap['questionObjectives'];
export function mapQuestionObjective(
  row: Models.QuestionObjective | null | undefined
): SyncMappedEntityMap['questionObjectives'] | null {
  if (!row) return null;
  return {
    id: row.id,
    questionId: row.questionId,
    learningObjectiveId: row.learningObjectiveId,
    isPrimary: Boolean(row.isPrimary),
    order: Number(row.order ?? 0),
    createdAt: toIso(row.createdAt)
  };
}

export function mapQuestionSource<Row extends Models.QuestionSource | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['questionSources']>;
export function mapQuestionSource(row: Models.QuestionSource): SyncMappedEntityMap['questionSources'];
export function mapQuestionSource(
  row: Models.QuestionSource | null | undefined
): SyncMappedEntityMap['questionSources'] | null {
  if (!row) return null;
  return {
    id: row.id,
    questionId: row.questionId,
    sourceType: row.sourceType,
    sourceId: row.sourceId ?? null,
    quote: row.quote ?? '',
    locator: row.locator === null || row.locator === undefined ? null : structuredClone(row.locator),
    contentHash: row.contentHash ?? null,
    status: row.status ?? 'active',
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

export interface NoteWriteInput {
  id?: unknown;
  spaceId?: unknown;
  folderId?: unknown;
  title?: unknown;
  rawMarkdown?: unknown;
  annotationStructure?: unknown;
  plainText?: unknown;
  internalLinks?: unknown;
  contentHash?: unknown;
  status?: unknown;
  sourceType?: unknown;
  favorite?: unknown;
  aiVisibility?: unknown;
  deleted?: unknown;
  folderDeletionPackageId?: unknown;
  deletionPackage?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}
type WriteField<Input, Key extends PropertyKey> = Key extends keyof Input ? Input[Key] : unknown;
export interface NoteWriteData<Input extends NoteWriteInput = NoteWriteInput> {
  id: WriteField<Input, 'id'>;
  spaceId: WriteField<Input, 'spaceId'>;
  folderId: NonNullable<WriteField<Input, 'folderId'>> | null;
  title: WriteField<Input, 'title'>;
  rawMarkdown: string;
  annotationStructure: NonNullable<WriteField<Input, 'annotationStructure'>> | Prisma.NullTypes.DbNull;
  plainText: string;
  internalLinks: WriteField<Input, 'internalLinks'> | [];
  contentHash: NonNullable<WriteField<Input, 'contentHash'>> | string;
  status: NonNullable<WriteField<Input, 'status'>> | 'draft';
  sourceType: NonNullable<WriteField<Input, 'sourceType'>> | 'manual';
  favorite: boolean;
  aiVisibility: NonNullable<WriteField<Input, 'aiVisibility'>> | 'normal';
  deletedAt: Date | null;
  folderDeletionPackageId: NonNullable<WriteField<Input, 'folderDeletionPackageId'>> | null;
  deletionPackage: NonNullable<WriteField<Input, 'deletionPackage'>> | Prisma.NullTypes.DbNull;
  createdAt: Date;
  updatedAt: Date;
}
export function buildNoteData<Input extends NoteWriteInput>(note: Input): NoteWriteData<Input>;
export function buildNoteData(note: NoteWriteInput): NoteWriteData {
  const rawMarkdown = String(note.rawMarkdown ?? '');
  const contentHash = note.contentHash ?? crypto.createHash('sha256').update(rawMarkdown).digest('hex');
  return {
    id: note.id,
    spaceId: note.spaceId,
    folderId: note.folderId ?? null,
    title: note.title,
    rawMarkdown,
    annotationStructure: note.annotationStructure ?? Prisma.DbNull,
    plainText: String(note.plainText ?? ''),
    internalLinks: Array.isArray(note.internalLinks) ? (note.internalLinks as unknown) : [],
    contentHash,
    status: note.status ?? 'draft',
    sourceType: note.sourceType ?? 'manual',
    favorite: Boolean(note.favorite),
    aiVisibility: note.aiVisibility ?? 'normal',
    deletedAt: note.deleted ? toDate(note.updatedAt) : null,
    folderDeletionPackageId: note.folderDeletionPackageId ?? null,
    deletionPackage: note.deletionPackage ?? Prisma.DbNull,
    createdAt: toDate(note.createdAt),
    updatedAt: toDate(note.updatedAt)
  };
}
export function mapKnowledgeArtifactProvenance<Row extends Models.KnowledgeArtifactProvenance | null | undefined>(
  row: Row
): Mapped<Row, SyncMappedEntityMap['knowledgeArtifactProvenance']>;
export function mapKnowledgeArtifactProvenance(
  row: Models.KnowledgeArtifactProvenance
): SyncMappedEntityMap['knowledgeArtifactProvenance'];
export function mapKnowledgeArtifactProvenance(
  row: Models.KnowledgeArtifactProvenance | null | undefined
): SyncMappedEntityMap['knowledgeArtifactProvenance'] | null {
  if (!row) return null;
  const record = validateKnowledgeArtifactProvenance(row.payload);
  if (
    (['id', 'artifactId', 'schemaVersion', 'state', 'provenanceHash'] as const).some(key => row[key] !== record[key])
  ) {
    throw createAppError('KNOWLEDGE_ARTIFACT_PROVENANCE_INVALID', '来源摘要索引与内容不一致。', 422);
  }
  return structuredClone(record);
}
