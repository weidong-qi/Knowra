import { inspectSpaceDeletion, assertSpaceDeletionAllowed } from '../space-deletion-preflight.js';
import { inspectSpaceMigration, assertSpaceMigrationAllowed } from '../space-migration.js';
import { buildDefaultTagGroups } from '../../domain/default-tag-groups.js';
import { validationError } from '../knowledge-errors.js';

export function createAsyncSpaceAssetLifecycle({
  knowledgeSpaceRepository,
  folderRepository,
  noteRepository,
  tagRepository,
  tagGroupRepository,
  contentAnnotationRepository,
  analysisScopeRepository,
  noteVersionRepository,
  runTransaction
}) {
  const repositories = {
    knowledgeSpaceRepository,
    folderRepository,
    noteRepository,
    tagRepository,
    tagGroupRepository,
    contentAnnotationRepository,
    analysisScopeRepository,
    noteVersionRepository
  };
  async function inspectEmptySpaceDeletion(id, ownerId = null, source = repositories) {
    const [space, folders, notes, tags, tagGroups, annotations, analysisScopes] = await Promise.all([
      source.knowledgeSpaceRepository.findById(id),
      source.folderRepository.list({ spaceId: id, includeDeleted: true }),
      source.noteRepository.list({ spaceId: id, includeDeleted: true }),
      source.tagRepository.list({ spaceId: id }),
      source.tagGroupRepository.list({ spaceId: id }),
      source.contentAnnotationRepository.list({ spaceId: id, includeDeleted: true }),
      source.analysisScopeRepository.list({ spaceId: id, includeDeleted: true })
    ]);
    if (space && ownerId && space.userId !== ownerId)
      throw validationError('KNOWLEDGE_SPACE_NOT_FOUND', '知识空间不存在');
    return inspectSpaceDeletion({ space, folders, notes, tags, tagGroups, annotations, analysisScopes });
  }

  /** @param {string} id @param {{ expectedUpdatedAt?: string }} input @param {string | null} ownerId */
  async function deleteEmptySpace(id, { expectedUpdatedAt } = {}, ownerId = null) {
    return runTransaction(async transaction => {
      const preflight = await inspectEmptySpaceDeletion(id, ownerId, transaction);
      assertSpaceDeletionAllowed(preflight, expectedUpdatedAt);
      for (const groupId of preflight.systemGroupIds) await transaction.tagGroupRepository.delete(groupId);
      await transaction.knowledgeSpaceRepository.delete(id);
      return {
        status: 'empty-container-deleted',
        asset: preflight.asset,
        offlineDevices: 'pending-sync',
        backups: 'retention-managed'
      };
    });
  }

  async function loadSpaceAssets(id, source = repositories) {
    const [folders, notes, tags, tagGroups, annotations, analysisScopes] = await Promise.all([
      source.folderRepository.list({ spaceId: id, includeDeleted: true }),
      source.noteRepository.list({ spaceId: id, includeDeleted: true }),
      source.tagRepository.list({ spaceId: id }),
      source.tagGroupRepository.list({ spaceId: id }),
      source.contentAnnotationRepository.list({ spaceId: id, includeDeleted: true }),
      source.analysisScopeRepository.list({ spaceId: id, includeDeleted: true })
    ]);
    return { folders, notes, tags, tagGroups, annotations, analysisScopes };
  }

  async function previewSpaceMigration(sourceId, targetId, ownerId = null, source = repositories) {
    const [origin, target, sourceAssets, targetAssets, allNotes, allNoteVersions] = await Promise.all([
      source.knowledgeSpaceRepository.findById(sourceId),
      source.knowledgeSpaceRepository.findById(targetId),
      loadSpaceAssets(sourceId, source),
      loadSpaceAssets(targetId, source),
      source.noteRepository.list({ includeDeleted: true }),
      source.noteVersionRepository.list()
    ]);
    if (ownerId && ((origin && origin.userId !== ownerId) || (target && target.userId !== ownerId)))
      throw validationError('KNOWLEDGE_SPACE_NOT_FOUND', '知识空间不存在');
    return inspectSpaceMigration({ source: origin, target, sourceAssets, targetAssets, allNotes, allNoteVersions });
  }

  /** @param {string} sourceId @param {{ targetSpaceId?: string, expectedPreviewHash?: string }} input @param {string | null} ownerId */
  async function migrateSpaceAssets(sourceId, { targetSpaceId, expectedPreviewHash } = {}, ownerId = null) {
    return runTransaction(async transaction => {
      const preview = await previewSpaceMigration(sourceId, targetSpaceId, ownerId, transaction);
      assertSpaceMigrationAllowed(preview, expectedPreviewHash);
      const source = await loadSpaceAssets(sourceId, transaction);
      let targetGroups = await transaction.tagGroupRepository.list({ spaceId: targetSpaceId });
      for (const definition of buildDefaultTagGroups(targetSpaceId)) {
        if (!targetGroups.some(group => group.code === definition.code))
          await transaction.tagGroupRepository.create(definition);
      }
      targetGroups = await transaction.tagGroupRepository.list({ spaceId: targetSpaceId });
      const groupMap = new Map(
        source.tagGroups
          .filter(group => group.isSystem)
          .map(group => [group.id, targetGroups.find(candidate => candidate.code === group.code).id])
      );
      for (const group of source.tagGroups.filter(group => !group.isSystem))
        await transaction.tagGroupRepository.moveToSpace(group.id, targetSpaceId);
      for (const tag of source.tags)
        await transaction.tagRepository.save({
          ...tag,
          spaceId: targetSpaceId,
          groupId: groupMap.get(tag.groupId) ?? tag.groupId ?? null
        });
      for (const folder of source.folders)
        await transaction.folderRepository.save({ ...folder, spaceId: targetSpaceId });
      for (const note of source.notes) await transaction.noteRepository.save({ ...note, spaceId: targetSpaceId });
      for (const annotation of source.annotations)
        await transaction.contentAnnotationRepository.save({ ...annotation, spaceId: targetSpaceId });
      for (const scope of source.analysisScopes)
        await transaction.analysisScopeRepository.moveToSpace(scope.id, targetSpaceId);
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
