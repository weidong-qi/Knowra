import { KnowledgeSpace } from '../domain/knowledge-space.ts';
import { buildDefaultKnowledgeSpaceDto } from './dto/knowledge-space.dto.ts';
import { createInMemoryKnowledgeSpaceRepository } from '../infrastructure/knowledge-space-repository.ts';
import { createInMemoryTagGroupRepository } from '../infrastructure/tag-group-repository.ts';
import { TagGroup } from '../domain/tag-group.ts';
import { buildDefaultTagGroups } from '../domain/default-tag-groups.ts';
import { randomUUID } from 'node:crypto';
import { createAppError } from '../../../errors/app-error.ts';

import type {
  KnowledgeSpaceRepository,
  KnowledgeSpaceListOptions
} from '../infrastructure/knowledge-space-repository.ts';
import type { TagGroupRepository } from '../infrastructure/tag-group-repository.ts';

export interface CreateKnowledgeSpaceInput {
  userId?: string;
  name?: string;
  description?: string;
}

export interface KnowledgeSpaceServiceDependencies {
  repository?: Pick<KnowledgeSpaceRepository, 'findById' | 'save' | 'list'>;
  tagGroupRepository?: Pick<TagGroupRepository, 'findById' | 'create'>;
  runTransaction?: <Result>(operation: () => Result) => Result;
}

export function createKnowledgeSpaceService({
  repository = createInMemoryKnowledgeSpaceRepository(),
  tagGroupRepository = createInMemoryTagGroupRepository(),
  runTransaction = operation => operation()
}: KnowledgeSpaceServiceDependencies = {}) {
  function ensureDefaultTagGroups(spaceId: string) {
    for (const definition of buildDefaultTagGroups(spaceId)) {
      if (!tagGroupRepository.findById(definition.id)) {
        tagGroupRepository.create(new TagGroup(definition));
      }
    }
  }
  return {
    createKnowledgeSpace({ userId, name, description = '' }: CreateKnowledgeSpaceInput = {}) {
      if (!String(name ?? '').trim()) throw createAppError('KNOWLEDGE_SPACE_NAME_REQUIRED', '请输入空间名称。', 422);
      return runTransaction(() => {
        const normalized = String(name).trim().toLocaleLowerCase();
        if (repository.list({ userId }).some(space => space.name.toLocaleLowerCase() === normalized))
          throw createAppError('KNOWLEDGE_SPACE_NAME_CONFLICT', '同名空间已存在。', 409);
        const space = repository.save(
          new KnowledgeSpace({
            id: `space-${randomUUID()}`,
            userId: userId!,
            name: name!,
            description,
            defaultFlag: false
          })
        );
        ensureDefaultTagGroups(space.id);
        return space;
      });
    },
    createDefaultKnowledgeSpace({ userId }: Pick<CreateKnowledgeSpaceInput, 'userId'> = {}) {
      return runTransaction(() => {
        const dto = buildDefaultKnowledgeSpaceDto({ userId });
        const space = repository.findById(dto.id) ?? repository.save(new KnowledgeSpace(dto));
        ensureDefaultTagGroups(space.id);
        return space;
      });
    },
    listKnowledgeSpaces(options: KnowledgeSpaceListOptions = {}) {
      return repository.list(options);
    }
  };
}
