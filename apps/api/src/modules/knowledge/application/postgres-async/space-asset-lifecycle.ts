import type { PostgresRepositories } from './service-dependencies.ts';
interface SpaceAssetRepositories {
  knowledgeSpaceRepository: Pick<PostgresRepositories['knowledgeSpaceRepository'], 'findById' | 'delete'>;
  folderRepository: Pick<PostgresRepositories['folderRepository'], 'list' | 'save'>;
  noteRepository: Pick<PostgresRepositories['noteRepository'], 'list' | 'save'>;
  tagRepository: Pick<PostgresRepositories['tagRepository'], 'list' | 'save'>;
  tagGroupRepository: Pick<PostgresRepositories['tagGroupRepository'], 'list' | 'create' | 'moveToSpace' | 'delete'>;
  contentAnnotationRepository: Pick<PostgresRepositories['contentAnnotationRepository'], 'list' | 'save'>;
  analysisScopeRepository: Pick<PostgresRepositories['analysisScopeRepository'], 'list' | 'moveToSpace'>;
  noteVersionRepository: Pick<PostgresRepositories['noteVersionRepository'], 'list'>;
  pdfAnnotationRepository: Pick<PostgresRepositories['pdfAnnotationRepository'], 'list' | 'save'>;
}
interface SpaceAssetDependencies extends SpaceAssetRepositories {
  runTransaction<T>(operation: (transaction: SpaceAssetRepositories) => Promise<T>): Promise<T>;
}
import { inspectSpaceDeletion, assertSpaceDeletionAllowed } from '../space-deletion-preflight.ts';
import { inspectSpaceMigration, assertSpaceMigrationAllowed } from '../space-migration.ts';
import { buildDefaultTagGroups } from '../../domain/default-tag-groups.ts';
import { validationError } from '../knowledge-errors.ts';

export function createAsyncSpaceAssetLifecycle({
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
}: SpaceAssetDependencies) {
  const repositories = {
    knowledgeSpaceRepository,
    folderRepository,
    noteRepository,
    tagRepository,
    tagGroupRepository,
    contentAnnotationRepository,
    pdfAnnotationRepository,
    analysisScopeRepository,
    noteVersionRepository
  };
  async function inspectEmptySpaceDeletion(id: string, ownerId: string | null = null, source = repositories) {
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
  async function deleteEmptySpace(
    id: string,
    { expectedUpdatedAt }: { expectedUpdatedAt?: string } = {},
    ownerId: string | null = null
  ) {
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

  async function loadSpaceAssets(id: string | undefined, source = repositories) {
    const [folders, notes, tags, tagGroups, annotations, pdfAnnotations, analysisScopes] = await Promise.all([
      source.folderRepository.list({ spaceId: id, includeDeleted: true }),
      source.noteRepository.list({ spaceId: id, includeDeleted: true }),
      source.tagRepository.list({ spaceId: id }),
      source.tagGroupRepository.list({ spaceId: id }),
      source.contentAnnotationRepository.list({ spaceId: id, includeDeleted: true }),
      source.pdfAnnotationRepository.list({ spaceId: id, includeDeleted: true }),
      source.analysisScopeRepository.list({ spaceId: id, includeDeleted: true })
    ]);
    return { folders, notes, tags, tagGroups, annotations, pdfAnnotations, analysisScopes };
  }

  async function previewSpaceMigration(
    sourceId: string,
    targetId: string | undefined,
    ownerId: string | null = null,
    source = repositories
  ) {
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
  async function migrateSpaceAssets(
    sourceId: string,
    { targetSpaceId, expectedPreviewHash }: { targetSpaceId?: string; expectedPreviewHash?: string } = {},
    ownerId: string | null = null
  ) {
    return runTransaction(async transaction => {
      const preview = await previewSpaceMigration(sourceId, targetSpaceId, ownerId, transaction);
      assertSpaceMigrationAllowed(preview, expectedPreviewHash);
      const source = await loadSpaceAssets(sourceId, transaction);
      let targetGroups = await transaction.tagGroupRepository.list({ spaceId: targetSpaceId! });
      for (const definition of buildDefaultTagGroups(targetSpaceId!)) {
        if (!targetGroups.some(group => group.code === definition.code))
          await transaction.tagGroupRepository.create(definition);
      }
      targetGroups = await transaction.tagGroupRepository.list({ spaceId: targetSpaceId! });
      const groupMap = new Map(
        source.tagGroups
          .filter(group => group.isSystem)
          .map(group => [group.id, targetGroups.find(candidate => candidate.code === group.code)!.id])
      );
      for (const group of source.tagGroups.filter(group => !group.isSystem))
        await transaction.tagGroupRepository.moveToSpace(group.id, targetSpaceId!);
      for (const tag of source.tags)
        await transaction.tagRepository.save({
          ...tag,
          spaceId: targetSpaceId!,
          groupId: groupMap.get(tag.groupId!) ?? tag.groupId ?? null
        });
      for (const folder of source.folders)
        await transaction.folderRepository.save({ ...folder, spaceId: targetSpaceId! });
      for (const note of source.notes) await transaction.noteRepository.save({ ...note, spaceId: targetSpaceId! });
      for (const annotation of source.annotations)
        await transaction.contentAnnotationRepository.save({ ...annotation, spaceId: targetSpaceId! });
      for (const annotation of source.pdfAnnotations)
        // 推进 CAS 基线，阻止迁移前读出的标注在迁移后覆盖新归属。
        await transaction.pdfAnnotationRepository.save({
          ...annotation,
          spaceId: targetSpaceId!,
          revision: annotation.revision + 1
        });
      for (const scope of source.analysisScopes)
        await transaction.analysisScopeRepository.moveToSpace(scope.id, targetSpaceId!);
      return {
        status: 'scoped-assets-migrated',
        sourceSpaceId: sourceId,
        targetSpaceId: targetSpaceId!,
        counts: preview.counts,
        globalKnowledgeAndTraining: 'unchanged',
        offlineDevices: 'pending-sync',
        backups: 'retention-managed'
      };
    });
  }

  return { inspectEmptySpaceDeletion, deleteEmptySpace, previewSpaceMigration, migrateSpaceAssets };
}
