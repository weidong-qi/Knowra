import { Prisma } from '@prisma/client';
import { validateKnowledgeArtifactProvenance } from '../../modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';

export function dbUser(user) {
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    nickname: user.nickname,
    status: user.status,
    createdAt: new Date(user.createdAt),
    updatedAt: new Date(user.updatedAt)
  };
}

export function dbSpace(space) {
  return {
    id: space.id,
    userId: space.userId,
    name: space.name,
    description: space.description,
    defaultFlag: space.defaultFlag,
    createdAt: new Date(space.createdAt),
    updatedAt: new Date(space.updatedAt)
  };
}

export function dbFolder(folder) {
  return {
    id: folder.id,
    spaceId: folder.spaceId,
    parentId: folder.parentId,
    name: folder.name,
    sortOrder: folder.sortOrder,
    pathCache: folder.pathCache,
    createdAt: new Date(folder.createdAt),
    updatedAt: new Date(folder.updatedAt),
    deletedAt: folder.deletedAt ? new Date(folder.deletedAt) : null,
    deletionPackage: folder.deletionPackage ?? undefined
  };
}

export function dbTag(tag) {
  return {
    id: tag.id,
    spaceId: tag.spaceId,
    name: tag.name,
    color: tag.color,
    groupId: tag.groupId,
    code: tag.code,
    isSystem: tag.isSystem,
    sortOrder: tag.sortOrder,
    createdAt: new Date(tag.createdAt),
    updatedAt: new Date(tag.updatedAt)
  };
}

export function dbNote(note) {
  return {
    id: note.id,
    spaceId: note.spaceId,
    folderId: note.folderId,
    title: note.title,
    annotationStructure: note.annotationStructure ?? undefined,
    rawMarkdown: note.rawMarkdown,
    plainText: note.plainText,
    internalLinks: note.internalLinks,
    contentHash: note.contentHash,
    status: note.status,
    sourceType: note.sourceType,
    favorite: note.favorite,
    deletedAt: note.deletedAt ? new Date(note.deletedAt) : null,
    folderDeletionPackageId: note.folderDeletionPackageId ?? null,
    deletionPackage: note.deletionPackage ?? undefined,
    createdAt: new Date(note.createdAt),
    updatedAt: new Date(note.updatedAt)
  };
}

export function dbAnnotation(annotation) {
  return {
    id: annotation.id,
    spaceId: annotation.spaceId,
    noteId: annotation.noteId,
    noteVersionId: annotation.noteVersionId ?? null,
    kind: annotation.kind,
    sourceMode: annotation.sourceMode,
    quoteText: annotation.quoteText,
    headingPath: annotation.headingPath,
    fromPosition: annotation.fromPosition,
    toPosition: annotation.toPosition,
    prefixText: annotation.prefixText,
    suffixText: annotation.suffixText,
    anchorFingerprint: annotation.anchorFingerprint,
    noteContentHash: annotation.noteContentHash,
    idempotencyKey: annotation.idempotencyKey,
    status: annotation.status,
    schemaVersion: annotation.schemaVersion ?? 1,
    scopeType: annotation.scopeType ?? 'selection',
    importance: annotation.importance ?? null,
    comment: annotation.comment ?? '',
    lifecycleStatus: annotation.lifecycleStatus ?? (annotation.status === 'archived' ? 'archived' : 'active'),
    anchorStatus: annotation.anchorStatus ?? (annotation.status === 'stale' ? 'needsReview' : 'resolved'),
    anchorReason: annotation.anchorReason ?? null,
    revision: annotation.revision ?? 1,
    anchor: annotation.anchor ?? null,
    originSnapshot: annotation.originSnapshot ?? null,
    identityBinding: annotation.identityBinding ?? Prisma.DbNull,
    resolvedContentHash: annotation.resolvedContentHash ?? null,
    boundaryFingerprint: annotation.boundaryFingerprint ?? null,
    requestHash: annotation.requestHash ?? null,
    createdAt: new Date(annotation.createdAt),
    updatedAt: new Date(annotation.updatedAt),
    deletedAt: annotation.deletedAt ? new Date(annotation.deletedAt) : null
  };
}

export function dbAnnotationExclusion(record) {
  return {
    ...record,
    noteVersionId: record.noteVersionId ?? null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt)
  };
}

export function dbAnnotationRevision(record) {
  return {
    ...record,
    oldAnchor: record.oldAnchor ?? null,
    newAnchor: record.newAnchor ?? null,
    rangeSummary: record.rangeSummary ?? null,
    reason: record.reason ?? null,
    createdAt: new Date(record.createdAt)
  };
}

export function dbAnalysisScopeSnapshot(record) {
  return {
    ...record,
    mode: record.mode ?? 'marked',
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt ?? record.createdAt),
    deletedAt: record.deletedAt ? new Date(record.deletedAt) : null
  };
}

export function dbNoteVersion(version) {
  return {
    id: version.id,
    noteId: version.noteId,
    content: version.content,
    contentHash: version.contentHash,
    createdAt: new Date(version.createdAt),
    createdBy: version.createdBy
  };
}

export function dbKnowledgeItem(item) {
  return {
    id: item.id,
    title: item.title ?? '',
    canonicalStatement: item.canonicalStatement ?? '',
    userExplanation: item.userExplanation ?? '',
    knowledgeType: item.knowledgeType ?? 'concept',
    importance: item.importance === null || item.importance === undefined ? null : Number(item.importance),
    reviewStatus: item.reviewStatus ?? 'candidate',
    sourceMode: item.sourceMode ?? 'manual',
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
    deletedAt: item.deletedAt ? new Date(item.deletedAt) : null
  };
}

export function dbKnowledgeEvidence(evidence) {
  return {
    id: evidence.id,
    knowledgeItemId: evidence.knowledgeItemId,
    sourceType: evidence.sourceType,
    sourceId: evidence.sourceId ?? null,
    noteId: evidence.noteId ?? null,
    noteVersionId: evidence.noteVersionId ?? null,
    annotationId: evidence.annotationId ?? null,
    quoteText: evidence.quoteText ?? '',
    headingPath: evidence.headingPath ?? [],
    relationType: evidence.relationType ?? 'supports',
    status: evidence.status ?? 'valid',
    applicabilityStatus: evidence.applicabilityStatus ?? (evidence.status === 'invalid' ? 'needsReview' : 'active'),
    createdAt: new Date(evidence.createdAt),
    updatedAt: new Date(evidence.updatedAt)
  };
}

export function dbLearningObjective(objective) {
  return {
    id: objective.id,
    knowledgeItemId: objective.knowledgeItemId,
    objective: objective.objective,
    actionVerb: objective.actionVerb,
    cognitiveLevel: objective.cognitiveLevel,
    difficultyHint: objective.difficultyHint ?? null,
    reviewStatus: objective.reviewStatus ?? 'candidate',
    reviewNote: objective.reviewNote ?? null,
    deletedAt: objective.deletedAt ? new Date(objective.deletedAt) : null,
    order: objective.order ?? 0,
    createdAt: new Date(objective.createdAt),
    updatedAt: new Date(objective.updatedAt)
  };
}

export function dbExamProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description ?? '',
    scope: profile.scope ?? [],
    language: profile.language ?? 'zh-CN',
    commonQuestionTypes: profile.commonQuestionTypes ?? [],
    difficultyProfile: profile.difficultyProfile ?? {},
    archivedAt: profile.archivedAt ? new Date(profile.archivedAt) : null,
    deletedAt: profile.deletedAt ? new Date(profile.deletedAt) : null,
    createdAt: new Date(profile.createdAt),
    updatedAt: new Date(profile.updatedAt)
  };
}

export function dbExamFocus(focus) {
  return {
    id: focus.id,
    examProfileId: focus.examProfileId,
    learningObjectiveId: focus.learningObjectiveId,
    description: focus.description ?? '',
    priority: focus.priority ?? 1,
    difficultyHint: focus.difficultyHint ?? null,
    questionTypeSuggestions: focus.questionTypeSuggestions ?? [],
    sourceType: focus.sourceType ?? 'manual',
    reviewStatus: focus.reviewStatus ?? 'candidate',
    deletedAt: focus.deletedAt ? new Date(focus.deletedAt) : null,
    createdAt: new Date(focus.createdAt),
    updatedAt: new Date(focus.updatedAt)
  };
}

export function dbQuestion(question) {
  return {
    id: question.id,
    questionType: question.questionType,
    stem: question.stem ?? '',
    options: question.options ?? null,
    referenceAnswer: question.referenceAnswer ?? null,
    rubric: question.rubric ?? null,
    explanation: question.explanation ?? '',
    difficulty: question.difficulty ?? null,
    reviewStatus: question.reviewStatus ?? 'draft',
    sourceMode: question.sourceMode ?? 'manual',
    version: question.version ?? 1,
    deletedAt: question.deletedAt ? new Date(question.deletedAt) : null,
    createdAt: new Date(question.createdAt),
    updatedAt: new Date(question.updatedAt)
  };
}

export function dbQuestionObjective(relation) {
  return {
    id: relation.id,
    questionId: relation.questionId,
    learningObjectiveId: relation.learningObjectiveId,
    isPrimary: Boolean(relation.isPrimary),
    order: relation.order ?? 0,
    createdAt: new Date(relation.createdAt)
  };
}

export function dbQuestionSource(source) {
  return {
    id: source.id,
    questionId: source.questionId,
    sourceType: source.sourceType,
    sourceId: source.sourceId ?? null,
    quote: source.quote ?? '',
    locator: source.locator ?? null,
    contentHash: source.contentHash ?? null,
    status: source.status ?? 'active',
    createdAt: new Date(source.createdAt),
    updatedAt: new Date(source.updatedAt)
  };
}

export function dbAttachment(attachment) {
  return {
    id: attachment.id,
    noteId: attachment.noteId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    sha256: attachment.sha256 ?? null,
    status: attachment.status ?? 'ready',
    storagePath: attachment.storagePath,
    verifiedAt: attachment.verifiedAt ? new Date(attachment.verifiedAt) : null,
    createdAt: new Date(attachment.createdAt)
  };
}

export function dbTagGroup(group) {
  return {
    id: group.id,
    spaceId: group.spaceId,
    code: group.code,
    name: group.name,
    selectionMode: group.selectionMode,
    isSystem: group.isSystem,
    sortOrder: group.sortOrder,
    createdAt: new Date(group.createdAt),
    updatedAt: new Date(group.updatedAt)
  };
}
/**
 * @param {unknown} input
 * @returns {import('../../modules/knowledge/infrastructure/postgres/knowledge-graph-repository-types.ts').ProvenanceWriteData}
 */
export function dbKnowledgeArtifactProvenance(input) {
  const record = validateKnowledgeArtifactProvenance(input);
  return {
    id: record.id,
    artifactId: record.artifactId,
    schemaVersion: record.schemaVersion,
    state: record.state,
    provenanceHash: record.provenanceHash,
    payload: structuredClone(record)
  };
}
