import { applyIdentityBindings } from '../knowledge/application/annotation-identity-binding.js';
import {
  calculateContentHash as trackingHash,
  updateStructure,
  validIdentityTable
} from '@study-accelerator/content-anchor';
import {
  normalizeKnowledgeChange,
  validateKnowledgeBatch,
  validateKnowledgeLifecycleChange
} from './knowledge-batch-domain.js';
import { normalizeTrainingChange, reconcileTrainingChanges, validateTrainingBatch } from './training-batch-domain.js';
import { buildCreateNoteDto } from '../knowledge/application/dto/note.dto.js';
import { buildCreateFolderDto } from '../knowledge/application/dto/folder.dto.js';
import { buildCreateTagDto } from '../knowledge/application/dto/tag.dto.js';
import { buildCreateTagGroupDto } from '../knowledge/application/dto/tag-group.dto.js';
import { reconcileSyncedSourceStates } from '../../infrastructure/local-data-relations.js';
import { createHash } from 'node:crypto';
import { Note } from '../knowledge/domain/note.js';
import { Folder } from '../knowledge/domain/folder.js';
import { Tag } from '../knowledge/domain/tag.js';
import { TagGroup } from '../knowledge/domain/tag-group.js';
import { ContentAnnotation } from '../knowledge/domain/content-annotation.js';
import { createContentAnnotationService } from '../knowledge/application/content-annotation-service.js';
import { createInMemoryContentAnnotationRepository } from '../knowledge/infrastructure/content-annotation-repository.js';
import { createInMemoryNoteRepository } from '../knowledge/infrastructure/note-repository.js';
import { createInMemoryNoteVersionRepository } from '../knowledge/infrastructure/note-version-repository.js';
import { createInMemoryAnnotationRevisionRepository } from '../knowledge/infrastructure/annotation-support-repositories.js';
import { validateSyncBatchState, LOCAL_DATA_SCHEMA_VERSION } from '../../infrastructure/local-data-schema.js';
import { cloneJsonData } from '../../infrastructure/json-clone.ts';
import { assertNoInsecureImageUrls } from '../knowledge/application/note-content-policy.js';
import { inspectAttachmentDeletion } from '../../infrastructure/attachment-deletion-preflight.js';
import { calculateContentHash, resolveAnchor } from '@study-accelerator/content-anchor';
import { sameEntity, IMMUTABLE_COLLECTIONS, referencesFor } from './entity-contract.ts';
import { syncError } from './journal.ts';
import { validateKnowledgeArtifactProvenance } from '../knowledge/domain/knowledge-artifact-provenance-contract.js';
import { addedNoteLinkTargets } from '../knowledge/application/note-link-relations.js';
import {
  applyInlineAnnotationChanges,
  INLINE_KEY_PREFIX,
  inlineAnnotationId,
  inlineMarksOf,
  planInlineAnnotations
} from '../knowledge/application/inline-annotations.js';

const sha = text => createHash('sha256').update(text).digest('hex');
const builders = {
  notes: buildCreateNoteDto,
  folders: buildCreateFolderDto,
  tags: buildCreateTagDto,
  tagGroups: buildCreateTagGroupDto
};
const constructors = {
  notes: Note,
  folders: Folder,
  tags: Tag,
  tagGroups: TagGroup,
  contentAnnotations: ContentAnnotation
};
const replace = (state, collection, id, value) => {
  const index = state[collection].findIndex(item => item.id === id);
  if (index >= 0) state[collection].splice(index, 1);
  if (value) state[collection].push(value);
};

/** 只在内存中构造并校验完整事务后像；不做文件或网络 IO。 */
export function prepareBatchState(before, changes, ownerId, preparedAttachments = {}) {
  // 不可变历史只复制集合；领域流程与最终校验均不修改旧版本/修订。
  let state = Object.fromEntries(
    Object.entries(before).map(([collection, items]) => [
      collection,
      ['noteVersions', 'annotationRevisions'].includes(collection) ? [...items] : cloneJsonData(items)
    ])
  );
  const aliases = {};
  const now = new Date().toISOString();
  for (const change of changes) {
    const { collection, id } = change;
    const old = before[collection].find(item => item.id === id);
    validateKnowledgeLifecycleChange(change, old);
    if (collection === 'analysisScopeSnapshots' && old) {
      const action =
        !old.deletedAt && change.value?.deletedAt
          ? 'trash'
          : old.deletedAt && change.value && !change.value.deletedAt
            ? 'restore'
            : null;
      if (
        action !== (change.lifecycleAction ?? null) ||
        !change.value ||
        old.createdAt !== change.value.createdAt ||
        !sameEntity(collection, { ...old, deletedAt: null }, { ...change.value, deletedAt: null })
      )
        throw syncError('SYNC_LIFECYCLE_ACTION_REQUIRED', '分析范围只能通过显式回收站操作修改。', 422);
    }
    if (collection === 'folders' && old) {
      const action =
        !old.deletedAt && change.value?.deletedAt
          ? 'trash'
          : old.deletedAt && change.value && !change.value.deletedAt
            ? 'restore'
            : null;
      if (
        action !== (change.lifecycleAction ?? null) ||
        (action &&
          (old.createdAt !== change.value.createdAt ||
            !sameEntity(
              collection,
              { ...old, deletedAt: null, deletionPackage: null },
              { ...change.value, deletedAt: null, deletionPackage: null }
            )))
      ) {
        throw syncError('SYNC_LIFECYCLE_ACTION_REQUIRED', '文件夹回收站操作需要显式动作与稳定内容。', 422);
      }
    }
    if (collection === 'notes' && old && !old.deleted && change.value?.deleted) {
      const packet = change.value.deletionPackage;
      const priorStates = before.contentAnnotations
        .filter(annotation => annotation.noteId === id)
        .map(annotation => {
          const incoming = changes.find(
            entry => entry.collection === 'contentAnnotations' && entry.id === annotation.id
          )?.value;
          return [annotation.id, incoming?.lifecycleStatus ?? annotation.lifecycleStatus ?? 'active'];
        });
      if (
        !packet?.id ||
        !Array.isArray(packet.annotationStates) ||
        priorStates.some(
          ([annotationId, status]) =>
            !packet.annotationStates.some(item => item.id === annotationId && item.lifecycleStatus === status)
        )
      ) {
        throw syncError('SYNC_NOTE_DELETE_PACKAGE_REQUIRED', '笔记删除缺少子标注状态快照，请升级应用后重试。', 422);
      }
    }
    let value = cloneJsonData(change.value);
    value = normalizeKnowledgeChange(collection, value, old);
    value = normalizeTrainingChange({ ...change, value }, old, changes);
    if (collection === 'knowledgeArtifactProvenance') {
      if (!value) throw syncError('SYNC_PROVENANCE_DELETE_UNSUPPORTED', '来源摘要只能随受控知识清理删除。', 422);
      value = validateKnowledgeArtifactProvenance(value);
      if (
        old &&
        !sameEntity(collection, old, value) &&
        !(old.state === 'legacy-unavailable' && value.state === 'recorded' && old.artifactId === value.artifactId)
      ) {
        throw syncError('SYNC_IMMUTABLE', '已保存的生成来源事实不可覆盖或降级。', 422);
      }
    }
    if (
      collection === 'notes' &&
      old &&
      ((old.contentKind ?? 'markdown') !== (value?.contentKind ?? 'markdown') ||
        ['attachmentId', 'sha256', 'importRequestHash'].some(
          key => old.pdfSource?.[key] !== value?.pdfSource?.[key]
        )) &&
      value
    )
      throw syncError('PDF_SOURCE_IMMUTABLE', '不能改换资料类型或 PDF 主文件。', 422);
    if (collection === 'pdfAnnotations' && old && value) {
      const fixed = item =>
        Object.fromEntries(
          ['noteId', 'spaceId', 'attachmentId', 'sha256', 'type', 'segments', 'quoteText'].map(key => [key, item[key]])
        );
      if (!sameEntity(collection, fixed(old), fixed(value)))
        throw syncError('PDF_SOURCE_IMMUTABLE', 'PDF 标注的原文与位置不能改换。', 422);
      if (value.revision < old.revision) throw syncError('PDF_ANNOTATION_CONFLICT', 'PDF 标注修订不能倒退。', 409);
    }
    if (value && value.id !== id) throw syncError('SYNC_ENTITY_INVALID', '实体 ID 与操作不一致。', 422);
    if (
      IMMUTABLE_COLLECTIONS.has(collection) &&
      old &&
      !sameEntity(collection, old, value) &&
      !['knowledgeEvidence', 'analysisScopeSnapshots', 'knowledgeArtifactProvenance'].includes(collection)
    )
      throw syncError('SYNC_IMMUTABLE', '历史版本与修订记录不可覆盖或删除。', 422);
    if (
      old &&
      value &&
      ['tags', 'tagGroups'].includes(collection) &&
      (Boolean(value.isSystem) !== Boolean(old.isSystem) || (value.code ?? null) !== (old.code ?? null))
    )
      throw syncError('SYSTEM_TAG_PROTECTED', '标签的系统标识不能改写。', 422);
    if (
      old?.isSystem &&
      (!value ||
        value.spaceId !== old.spaceId ||
        value.isSystem !== old.isSystem ||
        value.code !== old.code ||
        (collection === 'tags' && value.groupId !== old.groupId))
    )
      throw syncError('SYSTEM_TAG_PROTECTED', '系统标签和分组不能删除或改换归属。', 422);
    if (collection === 'spaces' && (!value || value.userId !== ownerId || (old && old.userId !== ownerId)))
      throw syncError('SYNC_OWNER_INVALID', '空间不属于当前资料库。', 422);
    if (old && value)
      for (const field of ['spaceId', 'noteId', 'annotationId', 'parentAnnotationId']) {
        if (field in old && value[field] !== old[field])
          throw syncError('SYNC_IDENTITY_CHANGED', '不能更改实体所属对象。', 422);
      }
    if (value) {
      if (collection === 'notes' && !Object.hasOwn(value, 'aiVisibility'))
        value = { ...value, aiVisibility: old?.aiVisibility ?? 'normal' };
      if (builders[collection]) value = { ...value, ...builders[collection](value) };
      if (collection === 'notes') {
        assertNoInsecureImageUrls(value.rawMarkdown);
        if (value.annotationStructure?.contentHash !== trackingHash(value.rawMarkdown)) {
          value.annotationStructure = updateStructure(
            old?.rawMarkdown ?? '',
            value.rawMarkdown,
            old?.annotationStructure
          );
        }
        // 块身份表只是可选的诊断与迁移数据：与正文不对应时丢弃，不能拒绝整批同步。
        else if (
          value.annotationStructure?.identity &&
          !validIdentityTable(value.rawMarkdown, value.annotationStructure.identity)
        ) {
          const { identity: _invalid, ...structure } = value.annotationStructure;
          value = { ...value, annotationStructure: structure };
        }
        value = { ...value, plainText: undefined, internalLinks: undefined, contentHash: sha(value.rawMarkdown) };
      }
      if (constructors[collection]) value = { ...new constructors[collection](value) };
      if (!IMMUTABLE_COLLECTIONS.has(collection)) {
        value.createdAt = old?.createdAt ?? now;
        if ('updatedAt' in value)
          value.updatedAt = new Date(Math.max(Date.now(), Date.parse(old?.updatedAt ?? 0) + 1 || 0)).toISOString();
      }
      if (collection === 'attachments') {
        if (old && (old.sha256 !== value.sha256 || old.noteId !== value.noteId))
          throw syncError('SYNC_ATTACHMENT_IMMUTABLE', '附件内容不可覆盖，请插入新附件。', 422);
        const prepared = preparedAttachments[id];
        if (
          !prepared ||
          prepared.sha256 !== value.sha256 ||
          prepared.size !== value.size ||
          prepared.fileName !== value.fileName
        )
          throw syncError('ATTACHMENT_NOT_READY', '附件尚未完成传输与校验。', 409);
        value = { ...value, storagePath: prepared.storagePath, status: 'ready', verifiedAt: now };
      }
    }
    replace(state, collection, id, value);
  }
  // 同正文的版本沿用云端稳定 ID，重写本批标注中的版本引用。
  const byHash = new Map(before.noteVersions.map(version => [`${version.noteId}:${version.contentHash}`, version.id]));
  state.noteVersions = state.noteVersions.filter(version => {
    const key = `${version.noteId}:${version.contentHash}`;
    const canonical = byHash.get(key);
    if (canonical && canonical !== version.id) {
      aliases[version.id] = canonical;
      return false;
    }
    byHash.set(key, version.id);
    return true;
  });
  function remap(value) {
    if (!value || typeof value !== 'object') return value;
    let result = value;
    for (const [key, child] of Object.entries(value)) {
      const next =
        (key === 'noteVersionId' || (key === 'sourceId' && value.sourceType === 'noteVersion')) && aliases[child]
          ? aliases[child]
          : remap(child);
      if (next === child) continue;
      if (result === value) result = Array.isArray(value) ? [...value] : { ...value };
      Object.defineProperty(result, key, { value: next, enumerable: true, configurable: true, writable: true });
    }
    return result;
  }
  if (Object.keys(aliases).length) {
    for (const collection of [
      'contentAnnotations',
      'annotationExclusions',
      'annotationRevisions',
      'knowledgeEvidence',
      'questionSources'
    ])
      state[collection] = state[collection].map(remap);
  }
  for (const change of changes.filter(item => item.collection === 'contentAnnotations' && item.value)) {
    const annotation = state.contentAnnotations.find(item => item.id === change.id);
    const note = state.notes.find(item => item.id === annotation.noteId);
    const origin = annotation.originSnapshot;
    const originVersion = state.noteVersions.find(item => item.id === origin?.noteVersionId);
    if (
      !originVersion ||
      originVersion.noteId !== annotation.noteId ||
      originVersion.contentHash !== origin?.contentHash
    )
      throw syncError('ANNOTATION_VERSION_CONFLICT', '原始标注快照缺少对应版本。', 422);
    const old = before.contentAnnotations.find(item => item.id === annotation.id);
    if (old && annotation.revision < old.revision)
      throw syncError('ANNOTATION_REVISION_CONFLICT', '标注修订不能倒退。');
    if (old && !sameEntity('contentAnnotations', { originSnapshot: old.originSnapshot }, { originSnapshot: origin }))
      throw syncError('SYNC_IMMUTABLE', '标注原始快照不可改写。', 422);
    if (annotation.schemaVersion === 3) {
      // 内联重点：ID 与幂等键由标记 ID 确定性推出；活跃且已定位的重点，其来源版本正文里必须有这个标记。
      const markId = annotation.anchor?.markId;
      if (
        annotation.id !== inlineAnnotationId(annotation.noteId, markId) ||
        annotation.idempotencyKey !== `${INLINE_KEY_PREFIX}${markId}`
      )
        throw syncError('ANNOTATION_INLINE_IDENTITY_INVALID', '内联重点的身份与标记不一致。', 422);
      if (annotation.lifecycleStatus === 'active') {
        const version = state.noteVersions.find(item => item.id === annotation.noteVersionId);
        if (!version || version.noteId !== annotation.noteId || version.contentHash !== annotation.noteContentHash)
          throw syncError('ANNOTATION_VERSION_CONFLICT', '标注来源版本不匹配。', 422);
        if (!inlineMarksOf(version.content).has(markId))
          throw syncError('ANNOTATION_ANCHOR_UNRESOLVED', '内联重点在来源版本中没有对应标记。', 422);
      }
      if (!note) throw syncError('DEPENDENCY_MISSING', '标注引用的笔记不存在。');
      continue;
    }
    if (annotation.schemaVersion !== 2) throw syncError('ANNOTATION_UPGRADE_REQUIRED', '请先升级旧版标注。', 422);
    if (annotation.anchorStatus === 'resolved') {
      const version = state.noteVersions.find(item => item.id === annotation.noteVersionId);
      if (!version || version.noteId !== annotation.noteId || version.contentHash !== annotation.noteContentHash)
        throw syncError('ANNOTATION_VERSION_CONFLICT', '标注来源版本不匹配。', 422);
      const resolved = resolveAnchor(version.content, annotation.anchor);
      if (resolved.status !== 'resolved' || resolved.quoteText !== annotation.quoteText)
        throw syncError('ANNOTATION_ANCHOR_UNRESOLVED', '标注无法在来源版本中定位。', 422);
    }
    if (!note) throw syncError('DEPENDENCY_MISSING', '标注引用的笔记不存在。');
  }
  const revisionKeys = new Set();
  for (const change of changes.filter(item => item.collection === 'notes' && item.value)) {
    const note = state.notes.find(item => item.id === change.id);
    const old = before.notes.find(item => item.id === change.id);
    for (const targetId of addedNoteLinkTargets(note.rawMarkdown, old?.rawMarkdown)) {
      const target = state.notes.find(item => item.id === targetId);
      // 离线期间目标可能已被永久删除：保留失效链接；存在的目标必须属于同一空间。
      if (target && target.spaceId !== note.spaceId)
        throw syncError('NOTE_LINK_TARGET_INVALID', '链接目标必须是当前空间内的笔记。', 422);
    }
  }
  for (const revision of state.annotationRevisions) {
    const key = `${revision.annotationId}:${revision.revision}`;
    if (revisionKeys.has(key)) throw syncError('ANNOTATION_REVISION_CONFLICT', '同一标注修订不能存在不同记录。');
    revisionKeys.add(key);
  }
  for (const entry of changes.filter(
    item => item.collection === 'annotationExclusions' && item.value?.status === 'active'
  )) {
    const exclusion = state.annotationExclusions.find(item => item.id === entry.id);
    const parent = state.contentAnnotations.find(item => item.id === exclusion.parentAnnotationId);
    const version = state.noteVersions.find(item => item.id === exclusion.noteVersionId);
    if (
      !version ||
      !parent ||
      parent.noteId !== version.noteId ||
      parent.noteVersionId !== version.id ||
      resolveAnchor(version.content, exclusion.anchor).status !== 'resolved' ||
      exclusion.anchor.sourceStart < parent.anchor.sourceStart ||
      exclusion.anchor.sourceEnd > parent.anchor.sourceEnd
    )
      throw syncError('ANNOTATION_EXCLUSION_CONFLICT', '排除范围与所属重点的来源不一致。', 422);
  }
  // 本次正文变化后，云端已有但本机未知的标注同样参与领域重定位。
  const annotations = createContentAnnotationService({
    repository: createInMemoryContentAnnotationRepository({ records: state.contentAnnotations }),
    noteRepository: createInMemoryNoteRepository({ records: state.notes }),
    noteVersionRepository: createInMemoryNoteVersionRepository({ records: state.noteVersions }),
    revisionRepository: createInMemoryAnnotationRevisionRepository({ records: state.annotationRevisions })
  });
  for (const change of changes.filter(item => item.collection === 'notes' && item.value)) {
    const note = state.notes.find(item => item.id === change.id);
    if (note.contentKind === 'pdf') continue;
    if (!state.noteVersions.some(version => version.noteId === note.id && version.contentHash === note.contentHash))
      throw syncError('DEPENDENCY_MISSING', '正文对应的不可变版本尚未提交。');
    annotations.reconcileForNote(note.id, calculateContentHash(note.rawMarkdown));
    applyIdentityBindings(
      createInMemoryContentAnnotationRepository({ records: state.contentAnnotations }),
      note,
      state.contentAnnotations.filter(item => item.noteId === note.id)
    );
    // 内联重点：旧客户端或外部改写没有带来派生行时，按正文补齐；与客户端派生一致时没有变化。
    const version = state.noteVersions.find(item => item.noteId === note.id && item.contentHash === note.contentHash);
    applyInlineAnnotationChanges(
      createInMemoryContentAnnotationRepository({ records: state.contentAnnotations }),
      createInMemoryAnnotationRevisionRepository({ records: state.annotationRevisions }),
      planInlineAnnotations(
        note,
        version,
        state.contentAnnotations.filter(item => item.noteId === note.id)
      )
    );
  }
  for (const collection of ['folders', 'tags', 'tagGroups', 'notes']) {
    const names = new Set();
    for (const item of state[collection]) {
      if (item.deleted || item.deletedAt) continue;
      const parent = collection === 'folders' ? item.parentId : collection === 'notes' ? item.folderId : null;
      const key = JSON.stringify([
        item.spaceId,
        parent ?? null,
        ['tags', 'tagGroups'].includes(collection)
          ? (item.name ?? item.title).trim().toLocaleLowerCase()
          : (item.name ?? item.title).trim()
      ]);
      if (names.has(key)) throw syncError('SIBLING_NAME_CONFLICT', '同一位置存在重名对象，请重命名后重试。');
      names.add(key);
    }
  }
  for (const folder of state.folders.filter(item => !item.deletedAt))
    if (
      state.notes.some(
        note =>
          !note.deleted &&
          note.spaceId === folder.spaceId &&
          (note.folderId ?? null) === (folder.parentId ?? null) &&
          note.title.trim() === folder.name.trim()
      )
    )
      throw syncError('SIBLING_NAME_CONFLICT', '同一位置的目录和笔记不能重名。');
  for (const note of state.notes)
    for (const ref of referencesFor('notes', note)) {
      if (!state[ref.collection].some(item => item.id === ref.id))
        throw syncError('DEPENDENCY_MISSING', '正文引用的目录、标签或附件尚未同步。');
    }
  for (const entry of changes.filter(item => item.collection === 'attachments' && !item.value)) {
    const preflight = inspectAttachmentDeletion(entry.id, state);
    if (preflight.references.length) throw syncError('ATTACHMENT_REFERENCED', '保留的资产仍引用此附件，不能删除。');
  }
  const folderMap = new Map(state.folders.map(folder => [folder.id, folder]));
  for (const folder of state.folders.filter(item => item.deletionPackage)) {
    const packet = folder.deletionPackage;
    if (
      !folder.deletedAt ||
      !Array.isArray(packet.folderIds) ||
      !Array.isArray(packet.noteIds) ||
      !packet.folderIds.includes(folder.id) ||
      !['keep', 'with-content'].includes(packet.mode)
    )
      throw syncError('SYNC_FOLDER_PACKAGE_INVALID', '文件夹删除包不完整。', 422);
    if (packet.folderIds.some(id => !folderMap.get(id)?.deletedAt))
      throw syncError('SYNC_FOLDER_PACKAGE_INVALID', '删除包中的子文件夹尚未进入回收站。', 422);
    if (
      packet.noteIds.some(id => {
        const note = state.notes.find(item => item.id === id);
        return (
          !note ||
          (packet.mode === 'with-content'
            ? !note.deleted || note.folderDeletionPackageId !== packet.id
            : note.deleted || packet.folderIds.includes(note.folderId))
        );
      })
    )
      throw syncError('SYNC_FOLDER_PACKAGE_INVALID', '删除包中的笔记状态不一致。', 422);
  }
  const paths = new Map();
  function folderPath(folder, visiting = new Set()) {
    if (paths.has(folder.id)) return paths.get(folder.id);
    if (visiting.has(folder.id)) throw syncError('FOLDER_PARENT_CONFLICT', '目录不能循环嵌套。', 422);
    visiting.add(folder.id);
    const parent = folder.parentId ? folderMap.get(folder.parentId) : null;
    if (folder.parentId && !parent) throw syncError('DEPENDENCY_MISSING', '父目录不存在。');
    const segment =
      folder.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'folder';
    const result = `${parent ? folderPath(parent, visiting) : ''}/${segment}`;
    visiting.delete(folder.id);
    paths.set(folder.id, result);
    return result;
  }
  for (const folder of state.folders) folder.pathCache = folderPath(folder);
  // 校验器同时推导证据、知识点和试题来源状态，客户端不能自行提交这些状态。
  state = reconcileSyncedSourceStates(reconcileTrainingChanges(before, state, changes));
  validateKnowledgeBatch(before, state, changes);
  validateTrainingBatch(before, state, changes);
  state = validateSyncBatchState({ schemaVersion: LOCAL_DATA_SCHEMA_VERSION, ...state });
  return { state, aliases };
}
