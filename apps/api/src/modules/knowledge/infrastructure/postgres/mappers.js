import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { createAppError } from '../../../../errors/app-error.js';
import { validateKnowledgeArtifactProvenance } from '../../domain/knowledge-artifact-provenance-contract.js';

export function toDate(value, fallback = new Date()) {
  if (value instanceof Date) {
    return value;
  }
  const date = new Date(value ?? fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
}

export function toIso(value, fallback = new Date()) {
  return toDate(value, fallback).toISOString();
}

export function mapUser(row) {
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

export function mapSpace(row) {
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

export function mapFolder(row) {
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

export function mapTag(row) {
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

export function mapTagGroup(row) {
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

export const mapPdfAnnotation = row => (row ? structuredClone(row.payload) : null);

export function mapNote(row) {
  if (!row) return null;
  const internalLinks = Array.isArray(row.internalLinks) ? row.internalLinks : [];
  return {
    id: row.id,
    spaceId: row.spaceId,
    folderId: row.folderId ?? null,
    title: row.title,
    rawMarkdown: row.rawMarkdown,
    contentKind: row.contentKind ?? 'markdown',
    pdfSource: row.pdfSource ?? null,
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

export function mapAttachment(row) {
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

export function mapAnnotation(row) {
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

export function mapNoteVersion(row) {
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

export function mapKnowledgeItem(row) {
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

export function mapKnowledgeEvidence(row) {
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

export function mapLearningObjective(row) {
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

export function mapExamProfile(row) {
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

export function mapExamFocus(row) {
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

export function mapQuestion(row) {
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

export function mapQuestionObjective(row) {
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

export function mapQuestionSource(row) {
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

export function buildNoteData(note) {
  const rawMarkdown = String(note.rawMarkdown ?? '');
  const contentHash = note.contentHash ?? crypto.createHash('sha256').update(rawMarkdown).digest('hex');
  return {
    id: note.id,
    spaceId: note.spaceId,
    folderId: note.folderId ?? null,
    title: note.title,
    rawMarkdown,
    contentKind: note.contentKind ?? 'markdown',
    pdfSource: note.pdfSource ?? Prisma.DbNull,
    annotationStructure: note.annotationStructure ?? Prisma.DbNull,
    plainText: String(note.plainText ?? ''),
    internalLinks: Array.isArray(note.internalLinks) ? note.internalLinks : [],
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
export function mapKnowledgeArtifactProvenance(row) {
  if (!row) return null;
  const record = validateKnowledgeArtifactProvenance(row.payload);
  if (['id', 'artifactId', 'schemaVersion', 'state', 'provenanceHash'].some(key => row[key] !== record[key])) {
    throw createAppError('KNOWLEDGE_ARTIFACT_PROVENANCE_INVALID', '来源摘要索引与内容不一致。', 422);
  }
  return structuredClone(record);
}
