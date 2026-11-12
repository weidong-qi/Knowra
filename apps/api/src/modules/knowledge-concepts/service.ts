import { createHash } from 'node:crypto';
import { createAppError } from '../../errors/app-error.ts';
import {
  applyConceptCommand,
  assertConceptState,
  ConceptRuleError,
  mergeConceptChanges
} from '../../../../../packages/web-core/src/knowledge-concepts/index.ts';
import type {
  ConceptCommand,
  ConceptItem,
  ConceptState,
  KnowledgeConcept,
  KnowledgeConceptLink,
  KnowledgeConceptRelation
} from '../../../../../packages/web-core/src/knowledge-concepts/types.ts';
export interface ConceptSnapshot extends ConceptState {
  items: ConceptItem[];
}
export interface KnowledgeConceptStore {
  read(): ConceptSnapshot | Promise<ConceptSnapshot>;
  update(compute: (state: ConceptSnapshot) => ConceptState): ConceptState | Promise<ConceptState>;
}
export interface StateBackedConceptData {
  state: {
    knowledgeConcepts: ConceptState['concepts'];
    knowledgeConceptLinks: ConceptState['links'];
    knowledgeConceptRelations: ConceptState['relations'];
    knowledgeItems: { id: string; deletedAt?: unknown }[];
  };
  runTransaction<T>(operation: () => T): T;
  flush(): void;
}
export const conceptItems = (items: { id: string; deletedAt?: unknown }[]): ConceptItem[] =>
  items.map(row => ({ id: row.id, deletedAt: typeof row.deletedAt === 'string' ? row.deletedAt : null }));
export function createStateBackedConceptStore(data: StateBackedConceptData): KnowledgeConceptStore {
  const read = (): ConceptSnapshot => ({
    concepts: structuredClone(data.state.knowledgeConcepts),
    links: structuredClone(data.state.knowledgeConceptLinks),
    relations: structuredClone(data.state.knowledgeConceptRelations),
    items: conceptItems(data.state.knowledgeItems)
  });
  return {
    read,
    update: compute =>
      data.runTransaction(() => {
        const current = read();
        const changed = compute(current);
        const next = mergeConceptChanges(current, changed);
        assertConceptState(next, current.items);
        data.state.knowledgeConcepts.splice(0, data.state.knowledgeConcepts.length, ...next.concepts);
        data.state.knowledgeConceptLinks.splice(0, data.state.knowledgeConceptLinks.length, ...next.links);
        data.state.knowledgeConceptRelations.splice(0, data.state.knowledgeConceptRelations.length, ...next.relations);
        data.flush();
        return changed;
      })
  };
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
export interface KnowledgeConceptServiceDependencies {
  store: KnowledgeConceptStore | null;
  now?: () => string;
}
export function createKnowledgeConceptService({
  store,
  now = () => new Date().toISOString()
}: KnowledgeConceptServiceDependencies) {
  const requireStore = () => {
    if (!store) throw createAppError('KNOWLEDGE_CONCEPTS_UNAVAILABLE', '当前存储暂不支持概念，请升级应用', 503);
    return store;
  };
  return {
    async list() {
      const state = await requireStore().read();
      return {
        concepts: state.concepts.filter(row => !row.deletedAt),
        links: state.links.filter(row => !row.deletedAt),
        relations: state.relations.filter(row => !row.deletedAt)
      };
    },
    async execute(input: unknown) {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw createAppError('CONCEPT_INVALID_INPUT', '概念命令无效', 422);
      const command = input as ConceptCommand;
      const requestHash = createHash('sha256').update(canonical(input)).digest('hex');
      try {
        return {
          changed: await requireStore().update(state =>
            applyConceptCommand(state, state.items, command, { now: now(), requestHash })
          )
        };
      } catch (error) {
        if (error instanceof ConceptRuleError)
          throw createAppError(
            error.code,
            error.message,
            error.code.endsWith('NOT_FOUND')
              ? 404
              : ['CONCEPT_INVALID_INPUT', 'CONCEPT_AI_SOURCE_RESERVED', 'CONCEPT_RELATION_BASIS_INVALID'].includes(
                    error.code
                  )
                ? 422
                : 409
          );
        if (error instanceof TypeError) throw createAppError('CONCEPT_INVALID_INPUT', '概念命令字段无效', 422);
        throw error;
      }
    }
  };
}
export type KnowledgeConceptService = ReturnType<typeof createKnowledgeConceptService>;
/** 永久删除知识点时在宿主的同一事务内调用；不提供独立硬删除入口。 */
export function conceptPurgeChanges(
  concepts: KnowledgeConcept[],
  links: KnowledgeConceptLink[],
  relations: KnowledgeConceptRelation[],
  id: string,
  now: string
) {
  const marker = `purge-${createHash('sha256').update(id).digest('hex')}`;
  const remove = <T extends KnowledgeConceptLink | KnowledgeConceptRelation>(row: T): T => ({
    ...row,
    deletedAt: now,
    deletedBy: marker,
    operationId: marker,
    revision: row.revision + 1,
    updatedAt: now
  });
  const changedLinks = links.filter(row => !row.deletedAt && row.knowledgeItemId === id).map(remove);
  const changedRelations = relations.filter(row => !row.deletedAt && row.basisItemId === id).map(remove);
  const affected = new Set([
    ...changedLinks.map(row => row.conceptId),
    ...changedRelations.flatMap(row => [row.fromConceptId, row.toConceptId])
  ]);
  return {
    concepts: concepts
      .filter(row => !row.deletedAt && affected.has(row.id))
      .map(row => ({ ...row, revision: row.revision + 1, updatedAt: now, operationId: marker })),
    links: changedLinks,
    relations: changedRelations
  };
}
export function purgeStateBackedConceptItem(data: StateBackedConceptData, id: string) {
  const changes = conceptPurgeChanges(
    data.state.knowledgeConcepts,
    data.state.knowledgeConceptLinks,
    data.state.knowledgeConceptRelations,
    id,
    new Date().toISOString()
  );
  for (const row of changes.concepts)
    Object.assign(
      data.state.knowledgeConcepts.find(current => current.id === row.id)!,
      row
    );
  for (const row of changes.links)
    Object.assign(
      data.state.knowledgeConceptLinks.find(current => current.id === row.id)!,
      row
    );
  for (const row of changes.relations)
    Object.assign(
      data.state.knowledgeConceptRelations.find(current => current.id === row.id)!,
      row
    );
  return { links: changes.links.length, relations: changes.relations.length };
}
