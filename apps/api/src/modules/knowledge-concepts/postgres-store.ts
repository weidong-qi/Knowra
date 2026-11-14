import type { Prisma, PrismaClient } from '@prisma/client';
import {
  assertConceptState,
  mergeConceptChanges
} from '../../../../../packages/web-core/src/knowledge-concepts/index.ts';
import type {
  ConceptState,
  KnowledgeConcept,
  KnowledgeConceptLink,
  KnowledgeConceptRelation
} from '../../../../../packages/web-core/src/knowledge-concepts/types.ts';
import { conceptItems, conceptPurgeChanges } from './service.ts';
import type { ConceptSnapshot, KnowledgeConceptStore } from './service.ts';
import {
  dbKnowledgeConcept,
  dbKnowledgeConceptLink,
  dbKnowledgeConceptRelation
} from '../../infrastructure/migration/db-mappers.ts';
export async function readPostgresConceptState(
  connection: Pick<
    Prisma.TransactionClient,
    'knowledgeConcept' | 'knowledgeConceptLink' | 'knowledgeConceptRelation' | 'knowledgeItem'
  >
): Promise<ConceptSnapshot> {
  const [concepts, links, relations, items] = await Promise.all([
    connection.knowledgeConcept.findMany({ orderBy: { id: 'asc' } }),
    connection.knowledgeConceptLink.findMany({ orderBy: { id: 'asc' } }),
    connection.knowledgeConceptRelation.findMany({ orderBy: { id: 'asc' } }),
    connection.knowledgeItem.findMany({ select: { id: true, deletedAt: true } })
  ]);
  const state = {
    concepts: concepts.map(row => row.data as unknown as KnowledgeConcept),
    links: links.map(row => row.data as unknown as KnowledgeConceptLink),
    relations: relations.map(row => row.data as unknown as KnowledgeConceptRelation),
    items: conceptItems(items.map(row => ({ id: row.id, deletedAt: row.deletedAt?.toISOString() ?? null })))
  };
  assertConceptState(state, state.items);
  return state;
}
async function write(
  connection: Pick<Prisma.TransactionClient, 'knowledgeConcept' | 'knowledgeConceptLink' | 'knowledgeConceptRelation'>,
  changed: ConceptState
) {
  for (const row of changed.concepts) {
    const data = dbKnowledgeConcept(row);
    await connection.knowledgeConcept.upsert({ where: { id: row.id }, create: data, update: data });
  }
  for (const row of changed.links) {
    const data = dbKnowledgeConceptLink(row);
    await connection.knowledgeConceptLink.upsert({ where: { id: row.id }, create: data, update: data });
  }
  for (const row of changed.relations) {
    const data = dbKnowledgeConceptRelation(row);
    await connection.knowledgeConceptRelation.upsert({ where: { id: row.id }, create: data, update: data });
  }
}
/** 必须注入同步包装的客户端，所有核心写入共用咨询锁和同步日志事务。 */
export function createPostgresConceptStore(client: PrismaClient): KnowledgeConceptStore {
  return {
    read: () => client.$transaction(readPostgresConceptState),
    update: compute =>
      client.$transaction(async connection => {
        const state = await readPostgresConceptState(connection);
        const changed = compute(state);
        assertConceptState(mergeConceptChanges(state, changed), state.items);
        await write(connection, changed);
        return changed;
      })
  };
}
export async function purgePostgresConceptItem(
  connection: Pick<
    Prisma.TransactionClient,
    'knowledgeConcept' | 'knowledgeConceptLink' | 'knowledgeConceptRelation' | 'knowledgeItem'
  >,
  id: string
) {
  const state = await readPostgresConceptState(connection);
  const changes = conceptPurgeChanges(state.concepts, state.links, state.relations, id, new Date().toISOString());
  await write(connection, changes);
  return { links: changes.links.length, relations: changes.relations.length };
}
