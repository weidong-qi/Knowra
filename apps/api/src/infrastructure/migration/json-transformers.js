import { stripKnowraMarks } from '@study-accelerator/shared/knowra-marks';
import crypto from 'node:crypto';
import { validateKnowledgeArtifactProvenanceRelations } from '../../modules/knowledge/domain/knowledge-artifact-provenance-state.js';
import { resolveAnalysisScopeNoteVersion } from '../../modules/knowledge/domain/analysis-scope-version-alias.js';
import fs from 'node:fs';
import path from 'node:path';
import { ATTACHMENT_STATUS } from '../attachment-status.ts';
import {
  looksPosixAbsolute,
  looksWindowsAbsolute,
  sanitizeFileName,
  toPortablePath
} from '../local-attachment-store-utils.js';

export function transformSpace(space, fallbackTimestamp) {
  const createdAt = normalizeTimestamp(space.createdAt ?? fallbackTimestamp, fallbackTimestamp);
  return {
    ...space,
    description: space.description ?? '',
    defaultFlag: space.defaultFlag ?? true,
    createdAt,
    updatedAt: normalizeTimestamp(space.updatedAt ?? createdAt, createdAt)
  };
}

export function transformFolder(folder, fallbackTimestamp) {
  const createdAt = normalizeTimestamp(folder.createdAt ?? fallbackTimestamp, fallbackTimestamp);
  return {
    ...folder,
    parentId: folder.parentId ?? null,
    pathCache: folder.pathCache ?? '/',
    sortOrder: Number(folder.sortOrder ?? 0),
    deletedAt: folder.deletedAt ? normalizeTimestamp(folder.deletedAt, createdAt) : null,
    deletionPackage: folder.deletionPackage ?? null,
    createdAt,
    updatedAt: normalizeTimestamp(folder.updatedAt ?? createdAt, createdAt)
  };
}

export function transformTagGroup(group, fallbackTimestamp) {
  const createdAt = normalizeTimestamp(group.createdAt ?? fallbackTimestamp, fallbackTimestamp);
  return {
    ...group,
    code: group.code ?? null,
    selectionMode: group.selectionMode ?? 'multiple',
    isSystem: Boolean(group.isSystem),
    sortOrder: Number(group.sortOrder ?? 0),
    createdAt,
    updatedAt: normalizeTimestamp(group.updatedAt ?? createdAt, createdAt)
  };
}

export function transformTag(tag, fallbackTimestamp) {
  const createdAt = normalizeTimestamp(tag.createdAt ?? fallbackTimestamp, fallbackTimestamp);
  return {
    ...tag,
    color: tag.color ?? 'slate',
    groupId: tag.groupId ?? null,
    code: tag.code ?? null,
    isSystem: Boolean(tag.isSystem),
    sortOrder: Number(tag.sortOrder ?? 0),
    createdAt,
    updatedAt: normalizeTimestamp(tag.updatedAt ?? createdAt, createdAt)
  };
}

export function transformNote(note, fallbackTimestamp, reportTools) {
  const createdAt = normalizeTimestamp(note.createdAt ?? fallbackTimestamp, fallbackTimestamp);
  const expectedHash = sha256(String(note.rawMarkdown ?? ''));
  if (!note.createdAt)
    reportTools.repair('NOTE_CREATED_AT_DEFAULTED', 'Note createdAt was missing; fallback timestamp used', {
      noteId: note.id
    });
  if (!note.updatedAt)
    reportTools.repair('NOTE_UPDATED_AT_DEFAULTED', 'Note updatedAt was missing; createdAt used', { noteId: note.id });
  if (note.contentHash && note.contentHash.toLowerCase() !== expectedHash) {
    reportTools.error('NOTE_CONTENT_HASH_MISMATCH', 'Note contentHash does not match rawMarkdown', {
      noteId: note.id,
      expectedHash,
      actualHash: note.contentHash
    });
  }
  const internalLinks = Array.isArray(note.internalLinks)
    ? [...new Set(note.internalLinks)]
    : extractInternalLinks(note.rawMarkdown);
  if (!Array.isArray(note.internalLinks))
    reportTools.repair('NOTE_INTERNAL_LINKS_DERIVED', 'Note internalLinks was missing; derived from Markdown', {
      noteId: note.id
    });
  return {
    ...note,
    folderId: note.folderId ?? null,
    plainText: typeof note.plainText === 'string' ? note.plainText : stripMarkdown(note.rawMarkdown),
    internalLinks,
    contentHash: expectedHash,
    status: note.status ?? 'draft',
    sourceType: note.sourceType ?? 'manual',
    favorite: Boolean(note.favorite),
    deletedAt: note.deleted ? normalizeTimestamp(note.updatedAt ?? createdAt, createdAt) : null,
    folderDeletionPackageId: note.folderDeletionPackageId ?? null,
    deletionPackage: note.deletionPackage ?? null,
    createdAt,
    updatedAt: normalizeTimestamp(note.updatedAt ?? createdAt, createdAt),
    tagIds: [...new Set(note.tagIds ?? [])]
  };
}

export function transformAnnotation(annotation, fallbackTimestamp, reportTools) {
  const createdAt = normalizeTimestamp(annotation.createdAt ?? fallbackTimestamp, fallbackTimestamp);
  const schemaVersion = Number(annotation.schemaVersion ?? 1);
  const requiredFields = ['anchorFingerprint', 'noteContentHash', 'idempotencyKey'];
  requiredFields.forEach(field => {
    if (!String(annotation[field] ?? '').trim()) {
      reportTools.error('ANNOTATION_FIELD_MISSING', `Annotation ${annotation.id} is missing ${field}`, {
        annotationId: annotation.id,
        field
      });
    }
  });
  if (!['important', 'question', 'supplement', 'pitfall', 'temporary'].includes(annotation.kind ?? 'important'))
    reportTools.error('ANNOTATION_KIND_INVALID', `Annotation ${annotation.id} kind is invalid`, {
      annotationId: annotation.id
    });
  if (!['manual', 'ai'].includes(annotation.sourceMode ?? 'manual'))
    reportTools.error('ANNOTATION_SOURCE_MODE_INVALID', `Annotation ${annotation.id} sourceMode is invalid`, {
      annotationId: annotation.id
    });
  if (!['active', 'stale', 'archived'].includes(annotation.status ?? 'active'))
    reportTools.error('ANNOTATION_STATUS_INVALID', `Annotation ${annotation.id} status is invalid`, {
      annotationId: annotation.id
    });
  const fromPosition = Number(annotation.fromPosition);
  const toPosition = Number(annotation.toPosition);
  if (
    !Number.isInteger(fromPosition) ||
    !Number.isInteger(toPosition) ||
    fromPosition < 0 ||
    fromPosition >= toPosition
  )
    reportTools.error('ANNOTATION_RANGE_INVALID', `Annotation ${annotation.id} has an invalid range`, {
      annotationId: annotation.id
    });
  return {
    ...annotation,
    kind: annotation.kind ?? 'important',
    sourceMode: annotation.sourceMode ?? 'manual',
    headingPath: Array.isArray(annotation.headingPath) ? annotation.headingPath : [],
    fromPosition,
    toPosition,
    prefixText: annotation.prefixText ?? '',
    suffixText: annotation.suffixText ?? '',
    status: annotation.status ?? 'active',
    schemaVersion,
    scopeType: annotation.scopeType ?? 'selection',
    importance: annotation.importance ?? null,
    comment: annotation.comment ?? '',
    lifecycleStatus: annotation.lifecycleStatus ?? (annotation.status === 'archived' ? 'archived' : 'active'),
    anchorStatus:
      annotation.anchorStatus ?? (schemaVersion === 1 || annotation.status === 'stale' ? 'needsReview' : 'resolved'),
    anchorReason: annotation.anchorReason ?? (schemaVersion === 1 ? 'legacyUnverified' : null),
    revision: Number(annotation.revision ?? 1),
    anchor: annotation.anchor ?? null,
    originSnapshot: annotation.originSnapshot ?? null,
    resolvedContentHash: annotation.resolvedContentHash ?? null,
    boundaryFingerprint: annotation.boundaryFingerprint ?? null,
    requestHash: annotation.requestHash ?? null,
    deletedAt: annotation.deletedAt ? normalizeTimestamp(annotation.deletedAt, createdAt) : null,
    createdAt,
    updatedAt: normalizeTimestamp(annotation.updatedAt ?? createdAt, createdAt)
  };
}

export function transformNoteVersion(version, fallbackTimestamp, reportTools) {
  const createdAt = normalizeTimestamp(version.createdAt ?? fallbackTimestamp, fallbackTimestamp);
  if (!version.createdAt)
    reportTools.repair(
      'NOTE_VERSION_CREATED_AT_DEFAULTED',
      'NoteVersion createdAt was missing; fallback timestamp used',
      { noteVersionId: version.id }
    );
  const expectedHash = sha256(String(version.content ?? ''));
  if (version.contentHash && version.contentHash.toLowerCase() !== expectedHash) {
    reportTools.error('NOTE_VERSION_HASH_MISMATCH', 'NoteVersion contentHash does not match its content', {
      noteVersionId: version.id,
      expectedHash,
      actualHash: version.contentHash
    });
  }
  return {
    ...version,
    content: String(version.content ?? ''),
    contentHash: version.contentHash?.toLowerCase() ?? expectedHash,
    createdAt,
    createdBy: version.createdBy ?? 'system-migration'
  };
}

export function transformKnowledgeItem(item, fallbackTimestamp, reportTools) {
  const createdAt = normalizeTimestamp(item.createdAt ?? fallbackTimestamp, fallbackTimestamp);
  return {
    ...item,
    title: String(item.title ?? ''),
    canonicalStatement: String(item.canonicalStatement ?? ''),
    userExplanation: String(item.userExplanation ?? ''),
    knowledgeType: item.knowledgeType ?? 'concept',
    importance: item.importance === null || item.importance === undefined ? null : Number(item.importance),
    reviewStatus: item.reviewStatus ?? 'candidate',
    sourceMode: item.sourceMode ?? 'manual',
    createdAt,
    updatedAt: normalizeTimestamp(item.updatedAt ?? createdAt, createdAt),
    deletedAt: item.deletedAt ? normalizeTimestamp(item.deletedAt, createdAt) : null
  };
}

export function transformKnowledgeEvidence(evidence, fallbackTimestamp) {
  const createdAt = normalizeTimestamp(evidence.createdAt ?? fallbackTimestamp, fallbackTimestamp);
  return {
    ...evidence,
    sourceType: evidence.sourceType ?? 'manual',
    sourceId: evidence.sourceId ?? null,
    noteId: evidence.noteId ?? null,
    noteVersionId:
      evidence.noteVersionId ?? (evidence.sourceType === 'noteVersion' ? (evidence.sourceId ?? null) : null),
    annotationId: evidence.annotationId ?? (evidence.sourceType === 'annotation' ? (evidence.sourceId ?? null) : null),
    quoteText: String(evidence.quoteText ?? ''),
    headingPath: Array.isArray(evidence.headingPath) ? evidence.headingPath : [],
    relationType: evidence.relationType ?? 'supports',
    status: evidence.status ?? 'valid',
    applicabilityStatus: evidence.applicabilityStatus ?? (evidence.status === 'invalid' ? 'needsReview' : 'active'),
    createdAt,
    updatedAt: normalizeTimestamp(evidence.updatedAt ?? createdAt, createdAt)
  };
}

export function transformLearningObjective(objective, fallbackTimestamp) {
  const createdAt = normalizeTimestamp(objective.createdAt ?? fallbackTimestamp, fallbackTimestamp);
  return {
    ...objective,
    objective: String(objective.objective ?? ''),
    actionVerb: String(objective.actionVerb ?? ''),
    cognitiveLevel: String(objective.cognitiveLevel ?? ''),
    difficultyHint: objective.difficultyHint || null,
    reviewStatus: objective.reviewStatus ?? 'candidate',
    reviewNote: objective.reviewNote ?? null,
    deletedAt: objective.deletedAt ? normalizeTimestamp(objective.deletedAt, createdAt) : null,
    order: Number(objective.order ?? 0),
    createdAt,
    updatedAt: normalizeTimestamp(objective.updatedAt ?? createdAt, createdAt)
  };
}

export function transformExamProfile(profile, fallbackTimestamp) {
  const createdAt = normalizeTimestamp(profile.createdAt ?? fallbackTimestamp, fallbackTimestamp);
  return {
    ...profile,
    description: String(profile.description ?? ''),
    scope: Array.isArray(profile.scope) ? profile.scope : [],
    language: String(profile.language ?? 'zh-CN'),
    commonQuestionTypes: Array.isArray(profile.commonQuestionTypes) ? profile.commonQuestionTypes : [],
    difficultyProfile:
      profile.difficultyProfile &&
      typeof profile.difficultyProfile === 'object' &&
      !Array.isArray(profile.difficultyProfile)
        ? profile.difficultyProfile
        : {},
    archivedAt: profile.archivedAt ? normalizeTimestamp(profile.archivedAt, createdAt) : null,
    deletedAt: profile.deletedAt ? normalizeTimestamp(profile.deletedAt, createdAt) : null,
    createdAt,
    updatedAt: normalizeTimestamp(profile.updatedAt ?? createdAt, createdAt)
  };
}

export function transformExamFocus(focus, fallbackTimestamp) {
  const createdAt = normalizeTimestamp(focus.createdAt ?? fallbackTimestamp, fallbackTimestamp);
  return {
    ...focus,
    description: String(focus.description ?? ''),
    priority: Number(focus.priority ?? 1),
    difficultyHint: focus.difficultyHint || null,
    questionTypeSuggestions: Array.isArray(focus.questionTypeSuggestions) ? focus.questionTypeSuggestions : [],
    sourceType: focus.sourceType ?? 'manual',
    reviewStatus: focus.reviewStatus ?? 'candidate',
    deletedAt: focus.deletedAt ? normalizeTimestamp(focus.deletedAt, createdAt) : null,
    createdAt,
    updatedAt: normalizeTimestamp(focus.updatedAt ?? createdAt, createdAt)
  };
}

export function transformQuestion(question, fallbackTimestamp) {
  const createdAt = normalizeTimestamp(question.createdAt ?? fallbackTimestamp, fallbackTimestamp);
  return {
    ...question,
    questionType: question.questionType ?? 'shortAnswer',
    stem: String(question.stem ?? ''),
    options: question.options ?? null,
    referenceAnswer: question.referenceAnswer ?? null,
    rubric: question.rubric ?? null,
    explanation: String(question.explanation ?? ''),
    difficulty: question.difficulty || null,
    reviewStatus: question.reviewStatus ?? 'draft',
    sourceMode: question.sourceMode ?? 'manual',
    version: Number(question.version ?? 1),
    deletedAt: question.deletedAt ? normalizeTimestamp(question.deletedAt, createdAt) : null,
    createdAt,
    updatedAt: normalizeTimestamp(question.updatedAt ?? createdAt, createdAt)
  };
}

export function transformQuestionObjective(relation, fallbackTimestamp) {
  return {
    ...relation,
    isPrimary: Boolean(relation.isPrimary),
    order: Number(relation.order ?? 0),
    createdAt: normalizeTimestamp(relation.createdAt ?? fallbackTimestamp, fallbackTimestamp)
  };
}

export function transformQuestionSource(source, fallbackTimestamp) {
  const createdAt = normalizeTimestamp(source.createdAt ?? fallbackTimestamp, fallbackTimestamp);
  return {
    ...source,
    sourceType: source.sourceType ?? 'manual',
    sourceId: source.sourceId ?? null,
    quote: String(source.quote ?? ''),
    locator: source.locator ?? null,
    contentHash: source.contentHash ?? null,
    status: source.status ?? 'active',
    createdAt,
    updatedAt: normalizeTimestamp(source.updatedAt ?? createdAt, createdAt)
  };
}

export function transformAttachment(
  attachment,
  {
    storageRootDir,
    uploadsDir = path.join(storageRootDir, process.env.STORAGE_UPLOADS_DIR || 'storage/uploads'),
    noteIds,
    allowMissingAttachments,
    fallbackTimestamp,
    reportTools
  }
) {
  if (!noteIds.has(attachment.noteId)) {
    reportTools.error('ATTACHMENT_NOTE_NOT_FOUND', `Attachment references unknown note: ${attachment.id}`, {
      attachmentId: attachment.id
    });
    return null;
  }
  const pathResolution = resolveAttachmentPath(attachment, storageRootDir, uploadsDir);
  const filePath = pathResolution.filePath;
  if (pathResolution.error) {
    reportTools.error(pathResolution.error.code, pathResolution.error.message, {
      attachmentId: attachment.id,
      storagePath: attachment.storagePath ?? null,
      filePath
    });
  }
  const exists = !pathResolution.error && isSafeAttachmentFile(filePath, uploadsDir);
  let actualSize = Number(attachment.size ?? 0);
  let contentSha256 = null;
  if (exists) {
    const stats = fs.statSync(filePath);
    actualSize = stats.size;
    contentSha256 = sha256(fs.readFileSync(filePath));
    if (Number(attachment.size) !== stats.size)
      reportTools.repair('ATTACHMENT_SIZE_REPAIRED', 'Attachment size was aligned to the file on disk', {
        attachmentId: attachment.id,
        previousSize: attachment.size,
        size: stats.size
      });
    if (attachment.sha256 && attachment.sha256.toLowerCase() !== contentSha256)
      reportTools.error('ATTACHMENT_HASH_MISMATCH', 'Attachment hash does not match the file on disk', {
        attachmentId: attachment.id,
        expectedSha256: attachment.sha256,
        actualSha256: contentSha256
      });
  } else if (!pathResolution.error) {
    const details = { attachmentId: attachment.id, filePath };
    if (allowMissingAttachments)
      reportTools.warn(
        'ATTACHMENT_FILE_MISSING',
        'Attachment metadata will be migrated although its file is missing',
        details
      );
    else reportTools.error('ATTACHMENT_FILE_MISSING', 'Attachment file is missing; apply is blocked', details);
  }
  reportTools.report.attachmentFiles.push({
    attachmentId: attachment.id,
    filePath,
    exists,
    size: actualSize,
    contentSha256
  });
  return {
    ...attachment,
    size: actualSize,
    sha256: contentSha256 ?? attachment.sha256 ?? null,
    status: exists ? ATTACHMENT_STATUS.READY : ATTACHMENT_STATUS.MISSING,
    verifiedAt: exists ? normalizeTimestamp(attachment.verifiedAt ?? fallbackTimestamp, fallbackTimestamp) : null,
    createdAt: normalizeTimestamp(attachment.createdAt, fallbackTimestamp),
    filePath,
    fileExists: exists,
    contentSha256
  };
}

export function checksumPlan(plan) {
  return sha256(JSON.stringify(plan, (_, value) => (value === undefined ? null : value)));
}

export function validateDatabaseConstraints(plan, reportTools) {
  try {
    validateKnowledgeArtifactProvenanceRelations(plan);
  } catch (error) {
    reportTools.error(error.code ?? 'KNOWLEDGE_ARTIFACT_PROVENANCE_INVALID', error.message);
  }
  assertUniqueBy(
    plan.tagGroups,
    group => `${group.spaceId}\u0000${group.name}`,
    'TAG_GROUP_NAME_CONFLICT',
    'Tag group names must be unique within a space',
    reportTools
  );
  assertUniqueBy(
    plan.tagGroups.filter(group => group.code !== null),
    group => `${group.spaceId}\u0000${group.code}`,
    'TAG_GROUP_CODE_CONFLICT',
    'Tag group codes must be unique within a space',
    reportTools
  );
  assertUniqueBy(
    plan.tags,
    tag => `${tag.spaceId}\u0000${tag.name}`,
    'TAG_NAME_CONFLICT',
    'Tag names must be unique within a space',
    reportTools
  );
  assertUniqueBy(
    plan.annotations,
    annotation => `${annotation.noteId}\u0000${annotation.idempotencyKey}`,
    'ANNOTATION_IDEMPOTENCY_CONFLICT',
    'Annotation idempotency keys must be unique within a note',
    reportTools
  );
  assertUniqueBy(
    plan.noteVersions,
    version => `${version.noteId}\u0000${version.contentHash}`,
    'NOTE_VERSION_HASH_CONFLICT',
    'Note versions must be unique by note and content hash',
    reportTools
  );
  assertUniqueBy(
    plan.folders,
    folder => `${folder.spaceId}\u0000${folder.parentId ?? ''}\u0000${folder.name}`,
    'FOLDER_NAME_CONFLICT',
    'Folder names must be unique among siblings',
    reportTools
  );
  assertUniqueBy(
    plan.notes.filter(note => !note.deleted),
    note => `${note.spaceId}\u0000${note.folderId ?? ''}\u0000${note.title}`,
    'NOTE_NAME_CONFLICT',
    'Active note names must be unique within a folder',
    reportTools
  );
  const noteVersions = new Map(plan.noteVersions.map(version => [version.id, version]));
  const annotations = new Map(plan.annotations.map(annotation => [annotation.id, annotation]));
  const spaces = new Set(plan.spaces.map(space => space.id));
  const knowledgeItems = new Set(plan.knowledgeItems.map(item => item.id));
  const learningObjectives = new Set(plan.learningObjectives.map(objective => objective.id));
  const examProfiles = new Set(plan.examProfiles.map(profile => profile.id));
  const questions = new Set(plan.questions.map(question => question.id));
  for (const evidence of plan.knowledgeEvidence) {
    if (!knowledgeItems.has(evidence.knowledgeItemId)) {
      reportTools.error('KNOWLEDGE_ITEM_NOT_FOUND', 'KnowledgeEvidence references an unknown KnowledgeItem', {
        evidenceId: evidence.id,
        knowledgeItemId: evidence.knowledgeItemId
      });
    }
    if (evidence.noteVersionId && !noteVersions.has(evidence.noteVersionId)) {
      reportTools.error('NOTE_VERSION_NOT_FOUND', 'KnowledgeEvidence references an unknown NoteVersion', {
        evidenceId: evidence.id,
        noteVersionId: evidence.noteVersionId
      });
    }
    if (evidence.annotationId && !annotations.has(evidence.annotationId)) {
      reportTools.error('ANNOTATION_NOT_FOUND', 'KnowledgeEvidence references an unknown annotation', {
        evidenceId: evidence.id,
        annotationId: evidence.annotationId
      });
    }
    if (evidence.sourceType === 'noteVersion' && !evidence.noteVersionId) {
      reportTools.error('NOTE_VERSION_REQUIRED', 'NoteVersion evidence requires a NoteVersion reference', {
        evidenceId: evidence.id
      });
    }
    if (evidence.sourceType === 'annotation' && !evidence.annotationId) {
      reportTools.error('ANNOTATION_REQUIRED', 'Annotation evidence requires an annotation reference', {
        evidenceId: evidence.id
      });
    }
  }
  assertUniqueBy(
    plan.annotationRevisions ?? [],
    revision => `${revision.annotationId}\u0000${revision.revision}`,
    'ANNOTATION_REVISION_CONFLICT',
    'Annotation revisions must be unique',
    reportTools
  );
  assertUniqueBy(
    plan.analysisScopeSnapshots ?? [],
    snapshot => `${snapshot.spaceId}\u0000${snapshot.idempotencyKey}`,
    'ANALYSIS_SCOPE_IDEMPOTENCY_CONFLICT',
    'Analysis scope idempotency keys must be unique per space',
    reportTools
  );
  for (const exclusion of plan.annotationExclusions ?? []) {
    const parent = annotations.get(exclusion.parentAnnotationId);
    if (!parent)
      reportTools.error('ANNOTATION_NOT_FOUND', 'AnnotationExclusion references an unknown annotation', {
        exclusionId: exclusion.id
      });
    else if (!['section', 'list'].includes(parent.scopeType))
      reportTools.error('ANNOTATION_EXCLUSION_CONFLICT', 'AnnotationExclusion requires a section or list annotation', {
        exclusionId: exclusion.id
      });
    if (exclusion.noteVersionId && !noteVersions.has(exclusion.noteVersionId))
      reportTools.error('NOTE_VERSION_NOT_FOUND', 'AnnotationExclusion references an unknown NoteVersion', {
        exclusionId: exclusion.id
      });
  }
  for (const revision of plan.annotationRevisions ?? []) {
    if (!annotations.has(revision.annotationId))
      reportTools.error('ANNOTATION_NOT_FOUND', 'AnnotationRevision references an unknown annotation', {
        revisionId: revision.id
      });
  }
  for (const snapshot of plan.analysisScopeSnapshots ?? []) {
    if (!spaces.has(snapshot.spaceId))
      reportTools.error('KNOWLEDGE_SPACE_NOT_FOUND', 'AnalysisScopeSnapshot references an unknown space', {
        snapshotId: snapshot.id
      });
    for (const version of snapshot.noteVersions ?? []) {
      try {
        resolveAnalysisScopeNoteVersion(snapshot, version, noteVersions);
      } catch {
        reportTools.error(
          'ANALYSIS_SCOPE_VERSION_MISMATCH',
          'AnalysisScopeSnapshot references an unresolvable NoteVersion',
          { snapshotId: snapshot.id }
        );
      }
    }
  }
  assertUniqueBy(
    plan.examFocuses,
    focus => `${focus.examProfileId}\u0000${focus.learningObjectiveId}`,
    'EXAM_FOCUS_CONFLICT',
    'ExamProfile and LearningObjective can only have one ExamFocus',
    reportTools
  );
  assertUniqueBy(
    plan.questionObjectives,
    relation => `${relation.questionId}\u0000${relation.learningObjectiveId}`,
    'QUESTION_OBJECTIVE_CONFLICT',
    'QuestionObjective relation must be unique',
    reportTools
  );
  for (const objective of plan.learningObjectives) {
    if (!knowledgeItems.has(objective.knowledgeItemId))
      reportTools.error('KNOWLEDGE_ITEM_NOT_FOUND', 'LearningObjective references an unknown KnowledgeItem', {
        objectiveId: objective.id,
        knowledgeItemId: objective.knowledgeItemId
      });
  }
  for (const focus of plan.examFocuses) {
    if (!examProfiles.has(focus.examProfileId))
      reportTools.error('EXAM_PROFILE_NOT_FOUND', 'ExamFocus references an unknown ExamProfile', {
        focusId: focus.id,
        examProfileId: focus.examProfileId
      });
    if (!learningObjectives.has(focus.learningObjectiveId))
      reportTools.error('LEARNING_OBJECTIVE_NOT_FOUND', 'ExamFocus references an unknown LearningObjective', {
        focusId: focus.id,
        learningObjectiveId: focus.learningObjectiveId
      });
  }
  for (const relation of plan.questionObjectives) {
    if (!questions.has(relation.questionId))
      reportTools.error('QUESTION_NOT_FOUND', 'QuestionObjective references an unknown Question', {
        relationId: relation.id,
        questionId: relation.questionId
      });
    if (!learningObjectives.has(relation.learningObjectiveId))
      reportTools.error('LEARNING_OBJECTIVE_NOT_FOUND', 'QuestionObjective references an unknown LearningObjective', {
        relationId: relation.id,
        learningObjectiveId: relation.learningObjectiveId
      });
  }
  for (const source of plan.questionSources) {
    if (!questions.has(source.questionId))
      reportTools.error('QUESTION_NOT_FOUND', 'QuestionSource references an unknown Question', {
        sourceId: source.id,
        questionId: source.questionId
      });
  }
}

function assertUniqueBy(items, keyOf, code, message, reportTools) {
  const seen = new Set();
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) reportTools.error(code, message, { key });
    seen.add(key);
  }
}

function resolveAttachmentPath(attachment, storageRootDir, uploadsDir) {
  const storagePath = String(attachment.storagePath ?? '').trim();
  if (!storagePath) {
    return attachmentPathError(null, 'ATTACHMENT_PATH_MISSING', 'Attachment storagePath is required for migration');
  }
  if (path.isAbsolute(storagePath) || looksPosixAbsolute(storagePath) || looksWindowsAbsolute(storagePath)) {
    return attachmentPathError(
      null,
      'ATTACHMENT_PATH_UNSAFE',
      'Attachment storagePath must be a canonical relative managed path'
    );
  }

  const rawAttachmentId = String(attachment.id ?? '');
  const attachmentId = rawAttachmentId.trim();
  if (
    !attachmentId ||
    rawAttachmentId !== attachmentId ||
    attachmentId === '.' ||
    attachmentId === '..' ||
    /[/\\\0]/.test(attachmentId)
  ) {
    return attachmentPathError(null, 'ATTACHMENT_PATH_UNSAFE', 'Attachment id cannot form a safe managed file name');
  }

  const normalizedStorageRoot = path.resolve(storageRootDir);
  const normalizedUploadsDir = path.resolve(uploadsDir);
  const expectedFileName = `${attachmentId}-${sanitizeFileName(attachment.fileName || 'attachment.bin')}`;
  const expectedFilePath = path.resolve(normalizedUploadsDir, expectedFileName);
  const expectedStoragePath = toPortablePath(path.relative(normalizedStorageRoot, expectedFilePath));
  const portableStoragePath = toPortablePath(storagePath);
  const resolvedFilePath = path.resolve(normalizedStorageRoot, ...portableStoragePath.split('/').filter(Boolean));

  if (
    portableStoragePath !== expectedStoragePath ||
    path.dirname(expectedFilePath) !== normalizedUploadsDir ||
    path.normalize(resolvedFilePath) !== path.normalize(expectedFilePath) ||
    !isPathWithin(normalizedUploadsDir, resolvedFilePath)
  ) {
    return attachmentPathError(
      resolvedFilePath,
      'ATTACHMENT_PATH_UNSAFE',
      'Attachment storagePath escapes or does not match its canonical managed path'
    );
  }

  try {
    const stats = fs.lstatSync(resolvedFilePath);
    if (stats.isSymbolicLink()) {
      return attachmentPathError(
        resolvedFilePath,
        'ATTACHMENT_PATH_SYMLINK',
        'Attachment migration does not follow symbolic links'
      );
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  return { filePath: resolvedFilePath, error: null };
}

function attachmentPathError(filePath, code, message) {
  return {
    filePath,
    error: { code, message }
  };
}

function isSafeAttachmentFile(filePath, uploadsDir) {
  if (!filePath || !isPathWithin(uploadsDir, filePath)) {
    return false;
  }

  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    return false;
  }

  try {
    return isPathWithin(fs.realpathSync(uploadsDir), fs.realpathSync(filePath));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function isPathWithin(rootPath, targetPath) {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return (
    relativePath === '' ||
    (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath))
  );
}

function normalizeTimestamp(value, fallback) {
  const date = new Date(value ?? fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback).toISOString() : date.toISOString();
}

function extractInternalLinks(markdown) {
  return [
    ...new Set(
      (String(markdown ?? '').match(/\[\[([^\]]+)\]\]/g) ?? []).map(value => value.slice(2, -2).trim()).filter(Boolean)
    )
  ];
}

function stripMarkdown(markdown) {
  return stripKnowraMarks(String(markdown ?? ''))
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
