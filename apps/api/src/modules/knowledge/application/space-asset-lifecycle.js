import { inspectSpaceDeletion, assertSpaceDeletionAllowed } from './space-deletion-preflight.js';
import { inspectSpaceMigration, assertSpaceMigrationAllowed } from './space-migration.js';
import { buildDefaultTagGroups } from '../domain/default-tag-groups.ts';
import { validationError } from './knowledge-errors.js';

export function createSpaceAssetLifecycle({
  knowledgeSpaceRepository,
  folderRepository,
  noteRepository,
  tagRepository,
  tagGroupRepository,
  contentAnnotationRepository,
  pdfAnnotationRepository,
  analysisScopeRepository,
  noteVersionRepository,
  runTransaction
}) {
  function inspectEmptySpaceDeletion(id, ownerId = null) {
    const space = knowledgeSpaceRepository.findById(id);
    if (space && ownerId && space.userId !== ownerId)
      throw validationError('KNOWLEDGE_SPACE_NOT_FOUND', '知识空间不存在');
    return inspectSpaceDeletion({
      space,
      folders: folderRepository.list({ spaceId: id, includeDeleted: true }),
      notes: noteRepository.list({ spaceId: id, includeDeleted: true }),
      tags: tagRepository.list({ spaceId: id }),
      tagGroups: tagGroupRepository.list({ spaceId: id }),
      annotations: contentAnnotationRepository.list({ spaceId: id, includeDeleted: true }),
      analysisScopes: analysisScopeRepository.list({ spaceId: id, includeDeleted: true })
    });
  }

  /** @param {string} id @param {{ expectedUpdatedAt?: string }} options @param {string | null} ownerId */
  function deleteEmptySpace(id, { expectedUpdatedAt } = {}, ownerId = null) {
    return runTransaction(() => {
      const preflight = inspectEmptySpaceDeletion(id, ownerId);
      assertSpaceDeletionAllowed(preflight, expectedUpdatedAt);
      preflight.systemGroupIds.forEach(groupId => tagGroupRepository.delete(groupId));
      knowledgeSpaceRepository.delete(id);
      return {
        status: 'empty-container-deleted',
        asset: preflight.asset,
        offlineDevices: 'pending-sync',
        backups: 'retention-managed'
      };
    });
  }

  function spaceAssets(id) {
    return {
      folders: folderRepository.list({ spaceId: id, includeDeleted: true }),
      notes: noteRepository.list({ spaceId: id, includeDeleted: true }),
      tags: tagRepository.list({ spaceId: id }),
      tagGroups: tagGroupRepository.list({ spaceId: id }),
      annotations: contentAnnotationRepository.list({ spaceId: id, includeDeleted: true }),
      pdfAnnotations: pdfAnnotationRepository.list({ spaceId: id, includeDeleted: true }),
      analysisScopes: analysisScopeRepository.list({ spaceId: id, includeDeleted: true })
    };
  }

  function previewSpaceMigration(sourceId, targetId, ownerId = null) {
    const source = knowledgeSpaceRepository.findById(sourceId);
    const target = knowledgeSpaceRepository.findById(targetId);
    if (ownerId && ((source && source.userId !== ownerId) || (target && target.userId !== ownerId)))
      throw validationError('KNOWLEDGE_SPACE_NOT_FOUND', '知识空间不存在');
    return inspectSpaceMigration({
      source,
      target,
      sourceAssets: spaceAssets(sourceId),
      targetAssets: spaceAssets(targetId),
      allNotes: noteRepository.list({ includeDeleted: true }),
      allNoteVersions: noteVersionRepository.list()
    });
  }

  /** @param {string} sourceId @param {{ targetSpaceId?: string, expectedPreviewHash?: string }} options @param {string | null} ownerId */
  function migrateSpaceAssets(sourceId, { targetSpaceId, expectedPreviewHash } = {}, ownerId = null) {
    return runTransaction(() => {
      const preview = previewSpaceMigration(sourceId, targetSpaceId, ownerId);
      assertSpaceMigrationAllowed(preview, expectedPreviewHash);
      const source = spaceAssets(sourceId);
      const target = spaceAssets(targetSpaceId);
      for (const definition of buildDefaultTagGroups(targetSpaceId)) {
        if (!target.tagGroups.some(group => group.code === definition.code)) tagGroupRepository.create(definition);
      }
      const targetGroups = tagGroupRepository.list({ spaceId: targetSpaceId });
      const groupMap = new Map(
        source.tagGroups
          .filter(group => group.isSystem)
          .map(group => [group.id, targetGroups.find(candidate => candidate.code === group.code).id])
      );
      for (const group of source.tagGroups.filter(group => !group.isSystem))
        tagGroupRepository.save({ ...group, spaceId: targetSpaceId });
      for (const tag of source.tags)
        tagRepository.save({
          ...tag,
          spaceId: targetSpaceId,
          groupId: groupMap.get(tag.groupId) ?? tag.groupId ?? null
        });
      for (const folder of source.folders) folderRepository.save({ ...folder, spaceId: targetSpaceId });
      for (const note of source.notes) noteRepository.save({ ...note, spaceId: targetSpaceId });
      for (const annotation of source.annotations)
        contentAnnotationRepository.save({ ...annotation, spaceId: targetSpaceId });
      for (const annotation of source.pdfAnnotations)
        // 推进 CAS 基线，阻止迁移前读出的标注在迁移后覆盖新归属。
        pdfAnnotationRepository.save({ ...annotation, spaceId: targetSpaceId, revision: annotation.revision + 1 });
      for (const scope of source.analysisScopes) analysisScopeRepository.save({ ...scope, spaceId: targetSpaceId });
      return {
        status: 'scoped-assets-migrated',
        sourceSpaceId: sourceId,
        targetSpaceId,
        counts: preview.counts,
        globalKnowledgeAndTraining: 'unchanged',
        offlineDevices: 'pending-sync',
        backups: 'retention-managed'
      };
    });
  }

  return { inspectEmptySpaceDeletion, deleteEmptySpace, previewSpaceMigration, migrateSpaceAssets };
}
