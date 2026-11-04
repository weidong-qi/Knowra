import { KnowledgeSpace } from '../domain/knowledge-space.ts';
import { buildDefaultKnowledgeSpaceDto } from './dto/knowledge-space.dto.ts';
import { createInMemoryKnowledgeSpaceRepository } from '../infrastructure/knowledge-space-repository.js';
import { createInMemoryTagGroupRepository } from '../infrastructure/tag-group-repository.js';
import { TagGroup } from '../domain/tag-group.ts';
import { buildDefaultTagGroups } from '../domain/default-tag-groups.ts';
import { randomUUID } from 'node:crypto';
import { createAppError } from '../../../errors/app-error.js';

export function createKnowledgeSpaceService({
  repository = createInMemoryKnowledgeSpaceRepository(),
  tagGroupRepository = createInMemoryTagGroupRepository(),
  runTransaction = operation => operation()
} = {}) {
  function ensureDefaultTagGroups(spaceId) {
    for (const definition of buildDefaultTagGroups(spaceId)) {
      if (!tagGroupRepository.findById(definition.id)) {
        tagGroupRepository.create(new TagGroup(definition));
      }
    }
  }
  return {
    /** @param {{ userId?: string, name?: string, description?: string }} input */
    createKnowledgeSpace({ userId, name, description = '' } = {}) {
      if (!String(name ?? '').trim()) throw createAppError('KNOWLEDGE_SPACE_NAME_REQUIRED', '请输入空间名称。', 422);
      return runTransaction(() => {
        const normalized = String(name).trim().toLocaleLowerCase();
        if (repository.list({ userId }).some(space => space.name.toLocaleLowerCase() === normalized))
          throw createAppError('KNOWLEDGE_SPACE_NAME_CONFLICT', '同名空间已存在。', 409);
        const space = repository.save(
          new KnowledgeSpace({ id: `space-${randomUUID()}`, userId, name, description, defaultFlag: false })
        );
        ensureDefaultTagGroups(space.id);
        return space;
      });
    },
    /** @param {{ userId?: string }} input */
    createDefaultKnowledgeSpace({ userId } = {}) {
      return runTransaction(() => {
        const dto = buildDefaultKnowledgeSpaceDto({ userId });
        const space = repository.findById(dto.id) ?? repository.save(new KnowledgeSpace(dto));
        ensureDefaultTagGroups(space.id);
        return space;
      });
    },
    listKnowledgeSpaces(options = {}) {
      return repository.list(options);
    }
  };
}
