import { validatePdfAnnotation } from '@study-accelerator/shared/pdf';
import { createAppError } from '../errors/app-error.js';
import { cloneJsonData } from './json-clone.ts';
import {
  normalizeLegacyNoteReferences,
  reconcileSyncedSourceStates,
  validateLocalDataRelations
} from './local-data-relations.js';
import { isAttachmentStatus } from './attachment-status.ts';
import { validateKnowledgeArtifactProvenance } from '../modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';
import { migrateLegacyKnowledgeArtifactProvenance } from '../modules/knowledge/domain/knowledge-artifact-provenance-state.ts';

export const LOCAL_DATA_SCHEMA_VERSION = 8;
export const LOCAL_SNAPSHOT_VERSION = 'v1-local-json';

export const LOCAL_DATA_COLLECTIONS = Object.freeze([
  'spaces',
  'folders',
  'tags',
  'tagGroups',
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
  'attachments',
  'contentAnnotations',
  'pdfAnnotations',
  'annotationExclusions',
  'annotationRevisions',
  'analysisScopeSnapshots'
]);

const REQUIRED_COLLECTIONS = Object.freeze(['spaces', 'folders', 'tags', 'notes']);

export function createEmptyLocalState() {
  return Object.fromEntries(LOCAL_DATA_COLLECTIONS.map(collectionName => [collectionName, []]));
}

export function validatePersistedLocalState(input) {
  return validatePersistedDocument(input);
}

// 批量同步已隔离可变实体；旧历史只读，新历史也经过完整字段、哈希和引用校验。
// 保留不可变记录，避免每个小批次再复制整库版本与标注修订。
export function validateSyncBatchState(input) {
  return validatePersistedDocument(input, true);
}

// 写盘前的只读断言不向业务暴露共享记录；所有字段、哈希和跨记录引用仍完整校验。
export function assertPersistedLocalState(input) {
  validatePersistedDocument(input, true);
}

function validatePersistedDocument(input, reuseImmutableHistory = false) {
  const document = assertRecord(input, 'Local data file');
  assertSchemaVersion(document.schemaVersion);
  assertProvenanceSchemaVersion(document, document.schemaVersion);
  const state = validateCollections(document, {
    allowMissingOptionalCollections: true,
    reuseImmutableHistory: reuseImmutableHistory && document.schemaVersion === LOCAL_DATA_SCHEMA_VERSION
  });
  if ((document.schemaVersion ?? 1) < 7) {
    // validateCollections 已初始化全部集合并验证每条记录；保留旧 JS 校验器的推断边界。
    migrateLegacyKnowledgeArtifactProvenance(
      /** @type {typeof state & import('../modules/knowledge/domain/knowledge-artifact-provenance-state.ts').ProvenanceMigrationState} */ (
        state
      )
    );
  }
  normalizeLegacyNoteReferences(state, {
    repairBrokenReferences: document.schemaVersion === undefined
  });
  // 旧版重选标注没有降级知识：保留历史证据并修复派生状态，避免升级后拒绝打开资料库。
  // 导入入口仍严格校验；同步显式确认由批量领域门槛验证。
  const annotations = new Map(state.contentAnnotations.map(annotation => [annotation.id, annotation]));
  if (
    state.knowledgeEvidence.some(evidence => {
      const annotation = annotations.get(evidence.annotationId);
      return annotation && String(evidence.quoteText ?? '').trim() !== String(annotation.quoteText ?? '').trim();
    })
  )
    reconcileSyncedSourceStates(state);
  return validateLocalDataRelations(state);
}

export function validateLocalSnapshot(snapshot) {
  const document = assertRecord(snapshot, 'Import payload');
  assertSnapshotVersion(document.version);
  assertSchemaVersion(document.schemaVersion);

  const data = Object.hasOwn(document, 'data') ? assertRecord(document.data, 'Import payload data') : document;
  assertProvenanceSchemaVersion(data, document.schemaVersion);

  const state = validateCollections(data, {
    allowMissingOptionalCollections: true
  });
  if ((document.schemaVersion ?? 1) < 7) {
    // validateCollections 已初始化全部集合并验证每条记录；保留旧 JS 校验器的推断边界。
    migrateLegacyKnowledgeArtifactProvenance(
      /** @type {typeof state & import('../modules/knowledge/domain/knowledge-artifact-provenance-state.ts').ProvenanceMigrationState} */ (
        state
      )
    );
  }
  normalizeLegacyNoteReferences(state, {
    repairBrokenReferences: document.schemaVersion === undefined
  });
  validateLocalDataRelations(state);

  return {
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    data: state
  };
}

export function createPersistedLocalDocument(state) {
  return {
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    ...cloneLocalState(state)
  };
}

export function cloneLocalState(state) {
  return Object.fromEntries(
    LOCAL_DATA_COLLECTIONS.map(collectionName => [collectionName, cloneJsonData(state[collectionName])])
  );
}

function validateCollections(input, { allowMissingOptionalCollections, reuseImmutableHistory = false }) {
  for (const collectionName of REQUIRED_COLLECTIONS) {
    if (!Array.isArray(input[collectionName])) {
      invalidSnapshot(`${collectionName} must be an array`);
    }
  }

  const state = createEmptyLocalState();
  for (const collectionName of LOCAL_DATA_COLLECTIONS) {
    const value = input[collectionName];
    if (value === undefined && allowMissingOptionalCollections) {
      continue;
    }
    if (!Array.isArray(value)) {
      invalidSnapshot(`${collectionName} must be an array`);
    }
    assertUniqueIds(value, collectionName);
    value.forEach((item, index) => {
      validateEntity(collectionName, item, index);
    });
    state[collectionName] =
      reuseImmutableHistory && ['noteVersions', 'annotationRevisions'].includes(collectionName)
        ? value
        : cloneJsonData(value);
  }

  return state;
}

function validateEntity(collectionName, item, index) {
  const location = `${collectionName}[${index}]`;
  assertRecord(item, location);
  assertNonEmptyString(item.id, `${location}.id`);

  if (collectionName === 'spaces') {
    assertNonEmptyString(item.userId, `${location}.userId`);
    assertNonEmptyString(item.name, `${location}.name`);
  } else if (collectionName === 'folders') {
    assertNonEmptyString(item.spaceId, `${location}.spaceId`);
    assertNonEmptyString(item.name, `${location}.name`);
    if (item.deletedAt && Number.isNaN(Date.parse(item.deletedAt))) invalidSnapshot(`${location}.deletedAt is invalid`);
    if (
      item.deletionPackage &&
      (!Array.isArray(item.deletionPackage.folderIds) || !Array.isArray(item.deletionPackage.noteIds))
    )
      invalidSnapshot(`${location}.deletionPackage is invalid`);
  } else if (collectionName === 'tags') {
    assertNonEmptyString(item.spaceId, `${location}.spaceId`);
    assertNonEmptyString(item.name, `${location}.name`);
  } else if (collectionName === 'tagGroups') {
    assertNonEmptyString(item.spaceId, `${location}.spaceId`);
    assertNonEmptyString(item.name, `${location}.name`);
  } else if (collectionName === 'notes') {
    assertNonEmptyString(item.title, `${location}.title`);
    if (item.aiVisibility !== undefined && !['normal', 'private'].includes(item.aiVisibility))
      invalidSnapshot(`${location}.aiVisibility is invalid`);
    if (item.deletionPackage && (!Array.isArray(item.deletionPackage.annotationStates) || !item.deletionPackage.id))
      invalidSnapshot(`${location}.deletionPackage is invalid`);
    if (typeof item.rawMarkdown !== 'string') {
      invalidSnapshot(`${location}.rawMarkdown must be a string`);
    }
    if (item.tagIds !== undefined && !Array.isArray(item.tagIds)) {
      invalidSnapshot(`${location}.tagIds must be an array`);
    }
    (item.tagIds ?? []).forEach((tagId, tagIndex) => {
      assertNonEmptyString(tagId, `${location}.tagIds[${tagIndex}]`);
    });
    if (item.internalLinks !== undefined && !Array.isArray(item.internalLinks)) {
      invalidSnapshot(`${location}.internalLinks must be an array`);
    }
    (item.internalLinks ?? []).forEach((noteId, linkIndex) => {
      assertNonEmptyString(noteId, `${location}.internalLinks[${linkIndex}]`);
    });
  } else if (collectionName === 'pdfAnnotations') {
    try {
      validatePdfAnnotation(item);
    } catch (error) {
      invalidSnapshot(error.message);
    }
  } else if (collectionName === 'noteVersions') {
    assertNonEmptyString(item.noteId, `${location}.noteId`);
    if (typeof item.content !== 'string') {
      invalidSnapshot(`${location}.content must be a string`);
    }
    assertSha256(item.contentHash, `${location}.contentHash`);
    assertNonEmptyString(item.createdBy, `${location}.createdBy`);
  } else if (collectionName === 'knowledgeItems') {
    if (item.title !== undefined && typeof item.title !== 'string') {
      invalidSnapshot(`${location}.title must be a string`);
    }
    if (item.canonicalStatement !== undefined && typeof item.canonicalStatement !== 'string') {
      invalidSnapshot(`${location}.canonicalStatement must be a string`);
    }
    assertAllowedValue(
      item.reviewStatus ?? 'candidate',
      ['candidate', 'confirmed', 'needsRevision', 'archived'],
      `${location}.reviewStatus`
    );
    assertAllowedValue(
      item.sourceMode ?? 'manual',
      ['manual', 'annotation', 'selection', 'ai'],
      `${location}.sourceMode`
    );
  } else if (collectionName === 'knowledgeEvidence') {
    assertNonEmptyString(item.knowledgeItemId, `${location}.knowledgeItemId`);
    assertAllowedValue(item.sourceType ?? 'manual', ['noteVersion', 'annotation', 'manual'], `${location}.sourceType`);
    assertAllowedValue(item.status ?? 'valid', ['valid', 'stale', 'invalid', 'insufficient'], `${location}.status`);
    assertAllowedValue(
      item.applicabilityStatus ?? (item.status === 'invalid' ? 'needsReview' : 'active'),
      ['active', 'withdrawn', 'needsReview'],
      `${location}.applicabilityStatus`
    );
    assertAllowedValue(item.relationType ?? 'supports', ['supports'], `${location}.relationType`);
  } else if (collectionName === 'knowledgeArtifactProvenance') {
    validateKnowledgeArtifactProvenance(item);
  } else if (collectionName === 'learningObjectives') {
    if (item.deletedAt != null && Number.isNaN(Date.parse(item.deletedAt)))
      invalidSnapshot(`${location}.deletedAt is invalid`);
    assertNonEmptyString(item.knowledgeItemId, `${location}.knowledgeItemId`);
    if (
      typeof item.objective !== 'string' ||
      typeof item.actionVerb !== 'string' ||
      typeof item.cognitiveLevel !== 'string'
    )
      invalidSnapshot(`${location} text fields are invalid`);
    assertAllowedValue(
      item.actionVerb ?? '',
      ['', 'identify', 'explain', 'apply', 'compare', 'analyze', 'calculate', 'design', 'evaluate'],
      `${location}.actionVerb`
    );
    assertAllowedValue(
      item.cognitiveLevel ?? '',
      ['', 'remember', 'understand', 'apply', 'analyze'],
      `${location}.cognitiveLevel`
    );
    assertAllowedValue(item.difficultyHint ?? '', ['', 'easy', 'medium', 'hard'], `${location}.difficultyHint`);
    assertAllowedValue(
      item.reviewStatus ?? 'candidate',
      ['candidate', 'confirmed', 'archived'],
      `${location}.reviewStatus`
    );
    if (!Number.isInteger(Number(item.order ?? 0)) || Number(item.order ?? 0) < 0)
      invalidSnapshot(`${location}.order is invalid`);
  } else if (collectionName === 'examProfiles') {
    if (item.deletedAt != null && Number.isNaN(Date.parse(item.deletedAt)))
      invalidSnapshot(`${location}.deletedAt is invalid`);
    assertNonEmptyString(item.name, `${location}.name`);
    if (
      !Array.isArray(item.scope ?? []) ||
      !Array.isArray(item.commonQuestionTypes ?? []) ||
      !item.difficultyProfile ||
      typeof item.difficultyProfile !== 'object' ||
      Array.isArray(item.difficultyProfile)
    )
      invalidSnapshot(`${location} structured fields are invalid`);
  } else if (collectionName === 'examFocuses') {
    if (item.deletedAt != null && Number.isNaN(Date.parse(item.deletedAt)))
      invalidSnapshot(`${location}.deletedAt is invalid`);
    assertNonEmptyString(item.examProfileId, `${location}.examProfileId`);
    assertNonEmptyString(item.learningObjectiveId, `${location}.learningObjectiveId`);
    assertAllowedValue(
      item.sourceType ?? 'manual',
      ['manual', 'ai', 'pastPaper', 'syllabus'],
      `${location}.sourceType`
    );
    assertAllowedValue(
      item.reviewStatus ?? 'candidate',
      ['candidate', 'confirmed', 'archived'],
      `${location}.reviewStatus`
    );
    if (!Number.isInteger(Number(item.priority ?? 1)) || Number(item.priority ?? 1) < 1)
      invalidSnapshot(`${location}.priority is invalid`);
    if (!Array.isArray(item.questionTypeSuggestions ?? []))
      invalidSnapshot(`${location}.questionTypeSuggestions must be an array`);
  } else if (collectionName === 'questions') {
    if (item.deletedAt != null && Number.isNaN(Date.parse(item.deletedAt)))
      invalidSnapshot(`${location}.deletedAt is invalid`);
    assertAllowedValue(
      item.questionType ?? 'shortAnswer',
      ['singleChoice', 'multipleChoice', 'trueFalse', 'shortAnswer'],
      `${location}.questionType`
    );
    assertAllowedValue(
      item.reviewStatus ?? 'draft',
      ['draft', 'validating', 'candidate', 'confirmed', 'archived'],
      `${location}.reviewStatus`
    );
    assertAllowedValue(item.sourceMode ?? 'manual', ['manual', 'ai', 'import'], `${location}.sourceMode`);
    if (item.options !== undefined && item.options !== null && !Array.isArray(item.options))
      invalidSnapshot(`${location}.options must be an array or null`);
    if (!Number.isInteger(Number(item.version ?? 1)) || Number(item.version ?? 1) < 1)
      invalidSnapshot(`${location}.version is invalid`);
  } else if (collectionName === 'questionObjectives') {
    assertNonEmptyString(item.questionId, `${location}.questionId`);
    assertNonEmptyString(item.learningObjectiveId, `${location}.learningObjectiveId`);
    if (!Number.isInteger(Number(item.order ?? 0)) || Number(item.order ?? 0) < 0)
      invalidSnapshot(`${location}.order is invalid`);
  } else if (collectionName === 'questionSources') {
    assertNonEmptyString(item.questionId, `${location}.questionId`);
    assertAllowedValue(
      item.sourceType ?? 'manual',
      ['knowledgeItem', 'learningObjective', 'noteVersion', 'knowledgeEvidence', 'manual', 'pastPaper', 'ai'],
      `${location}.sourceType`
    );
    assertAllowedValue(item.status ?? 'active', ['active', 'stale', 'reanchored'], `${location}.status`);
    if (
      item.locator !== undefined &&
      item.locator !== null &&
      (typeof item.locator !== 'object' || Array.isArray(item.locator))
    )
      invalidSnapshot(`${location}.locator is invalid`);
  } else if (collectionName === 'attachments') {
    assertNonEmptyString(item.noteId, `${location}.noteId`);
    assertNonEmptyString(item.fileName, `${location}.fileName`);
    if (item.status !== undefined && !isAttachmentStatus(item.status)) {
      invalidSnapshot(`${location}.status is invalid`);
    }
    if (item.sha256 !== undefined && (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256))) {
      invalidSnapshot(`${location}.sha256 is invalid`);
    }
  } else if (collectionName === 'contentAnnotations') {
    assertNonEmptyString(item.spaceId, `${location}.spaceId`);
    assertNonEmptyString(item.noteId, `${location}.noteId`);
    const emptyTrackedBlock =
      item.schemaVersion === 2 &&
      ['blocks', 'list'].includes(item.scopeType) &&
      item.anchor?.tracking?.empty === true &&
      item.anchor.quoteText === '' &&
      Array.isArray(item.anchor.segments) &&
      item.anchor.segments.length === 0;
    if (!emptyTrackedBlock || item.quoteText !== '') assertNonEmptyString(item.quoteText, `${location}.quoteText`);
    assertAllowedValue(item.schemaVersion ?? 1, [1, 2, 3], `${location}.schemaVersion`);
    assertAllowedValue(
      item.scopeType ?? 'selection',
      ['selection', 'blocks', 'section', 'list'],
      `${location}.scopeType`
    );
    assertAllowedValue(
      item.lifecycleStatus ?? (item.status === 'archived' ? 'archived' : 'active'),
      ['active', 'archived', 'deleted'],
      `${location}.lifecycleStatus`
    );
    assertAllowedValue(
      item.anchorStatus ?? (item.status === 'stale' ? 'needsReview' : 'resolved'),
      ['resolved', 'needsReview', 'missing'],
      `${location}.anchorStatus`
    );
    if (item.schemaVersion === 2 && (!item.anchor || typeof item.anchor !== 'object' || Array.isArray(item.anchor)))
      invalidSnapshot(`${location}.anchor is invalid`);
    // v3：重点内联化，位置在正文标记里，锚点只记标记 ID。
    if (item.schemaVersion === 3 && (item.anchor?.format !== 'knowra-inline' || typeof item.anchor.markId !== 'string'))
      invalidSnapshot(`${location}.anchor is invalid`);
    if (
      item.scopeType === 'list' &&
      item.schemaVersion !== 3 &&
      (item.schemaVersion !== 2 ||
        item.anchor?.scopeType !== 'list' ||
        !item.anchor.list ||
        typeof item.anchor.tracking?.rootId !== 'string')
    )
      invalidSnapshot(`${location}.list identity is invalid`);
  } else if (collectionName === 'annotationExclusions') {
    assertNonEmptyString(item.parentAnnotationId, `${location}.parentAnnotationId`);
    if (!item.anchor || typeof item.anchor !== 'object' || Array.isArray(item.anchor))
      invalidSnapshot(`${location}.anchor is invalid`);
  } else if (collectionName === 'annotationRevisions') {
    assertNonEmptyString(item.annotationId, `${location}.annotationId`);
    assertNonEmptyString(item.operation, `${location}.operation`);
    if (!Number.isInteger(item.revision) || item.revision < 1) invalidSnapshot(`${location}.revision is invalid`);
  } else if (collectionName === 'analysisScopeSnapshots') {
    assertNonEmptyString(item.spaceId, `${location}.spaceId`);
    assertNonEmptyString(item.inputHash, `${location}.inputHash`);
    assertNonEmptyString(item.idempotencyKey, `${location}.idempotencyKey`);
    if (item.deletedAt !== undefined && item.deletedAt !== null && Number.isNaN(Date.parse(item.deletedAt)))
      invalidSnapshot(`${location}.deletedAt is invalid`);
    for (const field of [
      'noteVersions',
      'selections',
      'segments',
      'contextSegments',
      'exclusions',
      'omittedItems',
      'annotationRevisions'
    ]) {
      if (!Array.isArray(item[field])) invalidSnapshot(`${location}.${field} must be an array`);
    }
  }
}

function assertUniqueIds(items, collectionName) {
  const ids = new Set();
  for (const item of items) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (id && ids.has(id)) {
      invalidSnapshot(`${collectionName} contains duplicate id: ${id}`);
    }
    ids.add(id);
  }
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    invalidSnapshot(`${label} must be a SHA-256 hash`);
  }
}

function assertAllowedValue(value, allowedValues, label) {
  if (!allowedValues.includes(value)) {
    invalidSnapshot(`${label} is invalid`);
  }
}

function assertSnapshotVersion(version) {
  if (version === undefined || version === LOCAL_SNAPSHOT_VERSION || version === 'v2-local-json') {
    return;
  }
  throw createAppError('STORAGE_SNAPSHOT_VERSION_UNSUPPORTED', `Unsupported storage snapshot version: ${version}`, 422);
}

function assertSchemaVersion(schemaVersion) {
  if (
    schemaVersion === undefined ||
    schemaVersion === 1 ||
    schemaVersion === 2 ||
    schemaVersion === 3 ||
    schemaVersion === 4 ||
    schemaVersion === 5 ||
    schemaVersion === 6 ||
    schemaVersion === 7 ||
    schemaVersion === LOCAL_DATA_SCHEMA_VERSION
  ) {
    return;
  }
  throw createAppError(
    'STORAGE_SCHEMA_VERSION_UNSUPPORTED',
    `Unsupported local data schema version: ${schemaVersion}`,
    422
  );
}

function assertProvenanceSchemaVersion(data, schemaVersion) {
  if (
    (schemaVersion ?? 1) < 8 &&
    ((data.pdfAnnotations?.length ?? 0) ||
      (Array.isArray(data.notes) && data.notes.some(note => note?.contentKind === 'pdf' || note?.pdfSource)))
  )
    invalidSnapshot('PDF 资料需要新版快照格式');
  if (
    (schemaVersion ?? 1) < 7 &&
    Array.isArray(data.knowledgeArtifactProvenance) &&
    data.knowledgeArtifactProvenance.length
  ) {
    throw createAppError('STORAGE_SCHEMA_VERSION_UNSUPPORTED', '来源摘要必须使用业务 schema7。', 422);
  }
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidSnapshot(`${label} must be an object`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    invalidSnapshot(`${label} must be a non-empty string`);
  }
}

function invalidSnapshot(message) {
  throw createAppError('STORAGE_SNAPSHOT_INVALID', message, 422);
}
