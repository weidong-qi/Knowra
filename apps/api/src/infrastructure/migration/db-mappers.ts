import type { MigrationPlan } from './migration-records.ts';
import type { Todo } from '../../../../../packages/web-core/src/personal-todos/types.ts';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import type { ProvenanceWriteData } from '../../modules/knowledge/infrastructure/postgres/knowledge-graph-repository-types.ts';
import { Prisma } from '@prisma/client';
import { validateKnowledgeArtifactProvenance } from '../../modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';

// 日期断言仅保留旧 JSON 的 Date 调用，不执行字符串转换或提前校验。
export function dbUser(user: MigrationPlan['users'][number]) {
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    nickname: user.nickname,
    status: user.status,
    createdAt: new Date(user.createdAt as string),
    updatedAt: new Date(user.updatedAt as string)
  };
}

export function dbSpace(space: MigrationPlan['spaces'][number]) {
  return {
    id: space.id,
    userId: space.userId,
    name: space.name,
    description: space.description,
    defaultFlag: space.defaultFlag,
    createdAt: new Date(space.createdAt as string),
    updatedAt: new Date(space.updatedAt as string)
  };
}

export function dbFolder(folder: MigrationPlan['folders'][number]) {
  return {
    id: folder.id,
    spaceId: folder.spaceId,
    parentId: folder.parentId,
    name: folder.name,
    sortOrder: folder.sortOrder,
    pathCache: folder.pathCache,
    createdAt: new Date(folder.createdAt as string),
    updatedAt: new Date(folder.updatedAt as string),
    deletedAt: folder.deletedAt ? new Date(folder.deletedAt as string) : null,
    deletionPackage: folder.deletionPackage ?? undefined
  };
}

export function dbTag(tag: MigrationPlan['tags'][number]) {
  return {
    id: tag.id,
    spaceId: tag.spaceId,
    name: tag.name,
    color: tag.color,
    groupId: tag.groupId,
    code: tag.code,
    isSystem: tag.isSystem,
    sortOrder: tag.sortOrder,
    createdAt: new Date(tag.createdAt as string),
    updatedAt: new Date(tag.updatedAt as string)
  };
}

export function dbNote(note: MigrationPlan['notes'][number]) {
  return {
    id: note.id,
    spaceId: note.spaceId,
    folderId: note.folderId,
    title: note.title,
    annotationStructure: note.annotationStructure ?? undefined,
    rawMarkdown: note.rawMarkdown,
    contentKind: note.contentKind ?? 'markdown',
    pdfSource: note.pdfSource ?? undefined,
    plainText: note.plainText,
    internalLinks: note.internalLinks,
    contentHash: note.contentHash,
    status: note.status,
    sourceType: note.sourceType,
    favorite: note.favorite,
    deletedAt: note.deletedAt ? new Date(note.deletedAt as string) : null,
    folderDeletionPackageId: note.folderDeletionPackageId ?? null,
    deletionPackage: note.deletionPackage ?? undefined,
    createdAt: new Date(note.createdAt as string),
    updatedAt: new Date(note.updatedAt as string)
  };
}

export function dbAnnotation(annotation: MigrationPlan['annotations'][number]) {
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
    createdAt: new Date(annotation.createdAt as string),
    updatedAt: new Date(annotation.updatedAt as string),
    deletedAt: annotation.deletedAt ? new Date(annotation.deletedAt as string) : null
  };
}

export function dbAnnotationExclusion(record: MigrationPlan['annotationExclusions'][number]) {
  return {
    ...record,
    noteVersionId: record.noteVersionId ?? null,
    createdAt: new Date(record.createdAt as string),
    updatedAt: new Date(record.updatedAt as string)
  };
}

export function dbAnnotationRevision(record: MigrationPlan['annotationRevisions'][number]) {
  return {
    ...record,
    oldAnchor: record.oldAnchor ?? null,
    newAnchor: record.newAnchor ?? null,
    rangeSummary: record.rangeSummary ?? null,
    reason: record.reason ?? null,
    createdAt: new Date(record.createdAt as string)
  };
}

export function dbAnalysisScopeSnapshot(record: MigrationPlan['analysisScopeSnapshots'][number]) {
  return {
    ...record,
    mode: record.mode ?? 'marked',
    createdAt: new Date(record.createdAt as string),
    updatedAt: new Date((record.updatedAt ?? record.createdAt) as string),
    deletedAt: record.deletedAt ? new Date(record.deletedAt as string) : null
  };
}

export function dbNoteVersion(version: MigrationPlan['noteVersions'][number]) {
  return {
    id: version.id,
    noteId: version.noteId,
    content: version.content,
    contentHash: version.contentHash,
    createdAt: new Date(version.createdAt as string),
    createdBy: version.createdBy
  };
}

export function dbKnowledgeItem(item: MigrationPlan['knowledgeItems'][number]) {
  return {
    id: item.id,
    title: item.title ?? '',
    canonicalStatement: item.canonicalStatement ?? '',
    userExplanation: item.userExplanation ?? '',
    knowledgeType: item.knowledgeType ?? 'concept',
    importance: item.importance === null || item.importance === undefined ? null : Number(item.importance),
    reviewStatus: item.reviewStatus ?? 'candidate',
    sourceMode: item.sourceMode ?? 'manual',
    createdAt: new Date(item.createdAt as string),
    updatedAt: new Date(item.updatedAt as string),
    deletedAt: item.deletedAt ? new Date(item.deletedAt as string) : null
  };
}

export function dbKnowledgeEvidence(evidence: MigrationPlan['knowledgeEvidence'][number]) {
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
    createdAt: new Date(evidence.createdAt as string),
    updatedAt: new Date(evidence.updatedAt as string)
  };
}

export function dbLearningObjective(objective: MigrationPlan['learningObjectives'][number]) {
  return {
    id: objective.id,
    knowledgeItemId: objective.knowledgeItemId,
    objective: objective.objective,
    actionVerb: objective.actionVerb,
    cognitiveLevel: objective.cognitiveLevel,
    difficultyHint: objective.difficultyHint ?? null,
    reviewStatus: objective.reviewStatus ?? 'candidate',
    reviewNote: objective.reviewNote ?? null,
    deletedAt: objective.deletedAt ? new Date(objective.deletedAt as string) : null,
    order: objective.order ?? 0,
    createdAt: new Date(objective.createdAt as string),
    updatedAt: new Date(objective.updatedAt as string)
  };
}

export function dbExamProfile(profile: MigrationPlan['examProfiles'][number]) {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description ?? '',
    scope: profile.scope ?? [],
    language: profile.language ?? 'zh-CN',
    commonQuestionTypes: profile.commonQuestionTypes ?? [],
    difficultyProfile: profile.difficultyProfile ?? {},
    archivedAt: profile.archivedAt ? new Date(profile.archivedAt as string) : null,
    deletedAt: profile.deletedAt ? new Date(profile.deletedAt as string) : null,
    createdAt: new Date(profile.createdAt as string),
    updatedAt: new Date(profile.updatedAt as string)
  };
}

export function dbExamFocus(focus: MigrationPlan['examFocuses'][number]) {
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
    deletedAt: focus.deletedAt ? new Date(focus.deletedAt as string) : null,
    createdAt: new Date(focus.createdAt as string),
    updatedAt: new Date(focus.updatedAt as string)
  };
}

export function dbQuestion(question: MigrationPlan['questions'][number]) {
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
    deletedAt: question.deletedAt ? new Date(question.deletedAt as string) : null,
    createdAt: new Date(question.createdAt as string),
    updatedAt: new Date(question.updatedAt as string)
  };
}

export function dbQuestionObjective(relation: MigrationPlan['questionObjectives'][number]) {
  return {
    id: relation.id,
    questionId: relation.questionId,
    learningObjectiveId: relation.learningObjectiveId,
    isPrimary: Boolean(relation.isPrimary),
    order: relation.order ?? 0,
    createdAt: new Date(relation.createdAt as string)
  };
}

export function dbQuestionSource(source: MigrationPlan['questionSources'][number]) {
  return {
    id: source.id,
    questionId: source.questionId,
    sourceType: source.sourceType,
    sourceId: source.sourceId ?? null,
    quote: source.quote ?? '',
    locator: source.locator ?? null,
    contentHash: source.contentHash ?? null,
    status: source.status ?? 'active',
    createdAt: new Date(source.createdAt as string),
    updatedAt: new Date(source.updatedAt as string)
  };
}

export function dbAttachment(attachment: MigrationPlan['attachments'][number]) {
  return {
    id: attachment.id,
    noteId: attachment.noteId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    sha256: attachment.sha256 ?? null,
    status: attachment.status ?? 'ready',
    storagePath: attachment.storagePath,
    verifiedAt: attachment.verifiedAt ? new Date(attachment.verifiedAt as string) : null,
    createdAt: new Date(attachment.createdAt as string)
  };
}

export function dbTagGroup(group: MigrationPlan['tagGroups'][number]) {
  return {
    id: group.id,
    spaceId: group.spaceId,
    code: group.code,
    name: group.name,
    selectionMode: group.selectionMode,
    isSystem: group.isSystem,
    sortOrder: group.sortOrder,
    createdAt: new Date(group.createdAt as string),
    updatedAt: new Date(group.updatedAt as string)
  };
}
export function dbKnowledgeArtifactProvenance(input: unknown): ProvenanceWriteData {
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

export const dbPdfAnnotation = (value: PdfAnnotation) => ({
  id: value.id,
  noteId: value.noteId,
  revision: value.revision,
  payload: value
});

export function dbPersonalTodo(todo: Todo) {
  return {
    id: todo.id,
    data: JSON.parse(JSON.stringify(todo)),
    updatedAt: new Date(todo.updatedAt as string)
  };
}

export function dbKnowledgeConcept(
  record: import('../../../../../packages/web-core/src/knowledge-concepts/types.ts').KnowledgeConcept
) {
  return { id: record.id, data: JSON.parse(JSON.stringify(record)), updatedAt: new Date(record.updatedAt) };
}

export function dbKnowledgeConceptLink(
  record: import('../../../../../packages/web-core/src/knowledge-concepts/types.ts').KnowledgeConceptLink
) {
  return { id: record.id, data: JSON.parse(JSON.stringify(record)), updatedAt: new Date(record.updatedAt) };
}

export function dbKnowledgeConceptRelation(
  record: import('../../../../../packages/web-core/src/knowledge-concepts/types.ts').KnowledgeConceptRelation
) {
  return { id: record.id, data: JSON.parse(JSON.stringify(record)), updatedAt: new Date(record.updatedAt) };
}
