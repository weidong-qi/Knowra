import { KnowledgeSpace } from '../../domain/knowledge-space.ts';
import { buildDefaultKnowledgeSpaceDto } from '../dto/knowledge-space.dto.ts';
import { TagGroup } from '../../domain/tag-group.ts';
import { buildDefaultTagGroups } from '../../domain/default-tag-groups.ts';
import { randomUUID } from 'node:crypto';
import { createAppError } from '../../../../errors/app-error.ts';

import type {
  KnowledgeSpaceRecord,
  KnowledgeSpaceListOptions
} from '../../infrastructure/knowledge-space-repository.ts';
import type { TagGroupRecord } from '../../infrastructure/tag-group-repository.ts';
import type { CreateKnowledgeSpaceInput } from '../knowledge-space-service.ts';

type MaybePromise<Value> = Value | PromiseLike<Value>;
export interface AsyncSpaceRepositories {
  knowledgeSpaceRepository: {
    findById: (id: string) => MaybePromise<KnowledgeSpaceRecord | null>;
    list: (options?: KnowledgeSpaceListOptions) => MaybePromise<KnowledgeSpaceRecord[]>;
    save: (space: KnowledgeSpaceRecord) => MaybePromise<KnowledgeSpaceRecord>;
  };
  tagGroupRepository: {
    findById: (id: string) => MaybePromise<TagGroupRecord | null>;
    create: (group: TagGroup) => MaybePromise<TagGroupRecord>;
  };
}
export interface AsyncKnowledgeSpaceServiceDependencies {
  repository?: AsyncSpaceRepositories['knowledgeSpaceRepository'];
  tagGroupRepository?: AsyncSpaceRepositories['tagGroupRepository'];
  runTransaction?: <Result>(
    operation: (repositories?: Partial<AsyncSpaceRepositories>) => Promise<Result>
  ) => MaybePromise<Result>;
}
export function createAsyncKnowledgeSpaceService({
  repository,
  tagGroupRepository,
  runTransaction = operation =>
    operation({
      knowledgeSpaceRepository: repository,
      tagGroupRepository
    })
}: AsyncKnowledgeSpaceServiceDependencies = {}) {
  if (!repository) throw new TypeError('Async space service requires a repository');
  if (!tagGroupRepository) throw new TypeError('Async space service requires a tag group repository');
  return {
    async createKnowledgeSpace({ userId, name, description = '' }: CreateKnowledgeSpaceInput = {}) {
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
            new KnowledgeSpace({
              id: `space-${randomUUID()}`,
              userId: userId!,
              name: name!,
              description,
              defaultFlag: false
            })
          );
          for (const definition of buildDefaultTagGroups(space.id)) await groups.create(new TagGroup(definition));
          return space;
        }
      );
    },
    async createDefaultKnowledgeSpace({ userId }: Pick<CreateKnowledgeSpaceInput, 'userId'> = {}) {
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
    listKnowledgeSpaces(options: KnowledgeSpaceListOptions = {}) {
      return repository.list(options);
    }
  };
}
