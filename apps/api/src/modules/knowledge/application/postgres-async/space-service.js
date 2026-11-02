import { KnowledgeSpace } from '../../domain/knowledge-space.js';
import { buildDefaultKnowledgeSpaceDto } from '../dto/knowledge-space.dto.ts';
import { TagGroup } from '../../domain/tag-group.js';
import { buildDefaultTagGroups } from '../../domain/default-tag-groups.js';
import { randomUUID } from 'node:crypto';
import { createAppError } from '../../../../errors/app-error.js';

/** @param {import('./service-dependencies.ts').SpaceDependencies} dependencies */
export function createAsyncKnowledgeSpaceService({
  repository,
  tagGroupRepository,
  runTransaction = operation =>
    operation({
      knowledgeSpaceRepository: repository,
      tagGroupRepository
    })
} = {}) {
  if (!repository) throw new TypeError('Async space service requires a repository');
  if (!tagGroupRepository) throw new TypeError('Async space service requires a tag group repository');
  return {
    /** @param {{ userId?: string, name?: string, description?: string }} input */
    async createKnowledgeSpace({ userId, name, description = '' } = {}) {
      if (!String(name ?? '').trim()) throw createAppError('KNOWLEDGE_SPACE_NAME_REQUIRED', '请输入空间名称。', 422);
      return runTransaction(
        async ({
          knowledgeSpaceRepository: spaces = repository,
          tagGroupRepository: groups = tagGroupRepository
        } = {}) => {
          const normalized = String(name).trim().toLocaleLowerCase();
          if ((await spaces.list({ userId })).some(space => space.name.toLocaleLowerCase() === normalized))
            throw createAppError('KNOWLEDGE_SPACE_NAME_CONFLICT', '同名空间已存在。', 409);
          const space = await spaces.save(
            new KnowledgeSpace({ id: `space-${randomUUID()}`, userId, name, description, defaultFlag: false })
          );
          for (const definition of buildDefaultTagGroups(space.id)) await groups.create(new TagGroup(definition));
          return space;
        }
      );
    },
    /** @param {{ userId?: string }} input */
    async createDefaultKnowledgeSpace({ userId } = {}) {
      return runTransaction(
        async ({
          knowledgeSpaceRepository: spaces = repository,
          tagGroupRepository: groups = tagGroupRepository
        } = {}) => {
          const dto = buildDefaultKnowledgeSpaceDto({ userId });
          const space = (await spaces.findById(dto.id)) ?? (await spaces.save(new KnowledgeSpace(dto)));
          for (const definition of buildDefaultTagGroups(space.id)) {
            if (!(await groups.findById(definition.id))) {
              await groups.create(new TagGroup(definition));
            }
          }
          return space;
        }
      );
    },
    listKnowledgeSpaces(options = {}) {
      return repository.list(options);
    }
  };
}
