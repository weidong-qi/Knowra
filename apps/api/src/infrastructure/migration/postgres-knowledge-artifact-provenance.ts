import type { MigrationWriteOperation } from './migration-client.ts';
import type { Prisma } from '@prisma/client';
import type { ProvenanceMigrationClient, ExtractionCommitSqlRow } from './provenance-types.ts';
import { createAppError } from '../../errors/app-error.ts';
import { backfillKnowledgeArtifactProvenance } from './knowledge-artifact-provenance-backfill.ts';
import { dbKnowledgeArtifactProvenance } from './db-mappers.ts';
import {
  mapKnowledgeItem,
  mapKnowledgeEvidence,
  mapNote,
  mapNoteVersion,
  mapKnowledgeArtifactProvenance
} from '../../modules/knowledge/infrastructure/postgres/mappers.ts';
import { validateKnowledgeArtifactProvenanceRelations } from '../../modules/knowledge/domain/knowledge-artifact-provenance-state.ts';
import { knowledgeExtractionCommitKey } from '../../modules/ai/knowledge-extraction-commit-contract.ts';

/** 调用方提供核心 syncRuntime 事务；迁移数据、journal 与完成标记一次提交。 */
export async function migratePostgresKnowledgeArtifactProvenance(db: ProvenanceMigrationClient, ownerId: string) {
  return db.$transaction(async tx => {
    const migrations = await tx.$queryRawUnsafe<{ version: number }[]>(
      'SELECT version FROM knowledge_artifact_provenance_migrations'
    );
    if (migrations.some(row => row.version !== 1))
      throw createAppError('STORAGE_SCHEMA_VERSION_UNSUPPORTED', '来源迁移版本未知。', 422);
    const [items, evidence, notes, versions, records, journal] = await Promise.all([
      tx.knowledgeItem.findMany(),
      tx.knowledgeEvidence.findMany(),
      tx.note.findMany({ include: { noteTags: true } }),
      tx.noteVersion.findMany(),
      tx.knowledgeArtifactProvenance.findMany(),
      tx.syncJournal.findUnique({ where: { ownerId } })
    ]);
    const state = {
      knowledgeItems: items.map(mapKnowledgeItem),
      knowledgeEvidence: evidence.map(mapKnowledgeEvidence),
      notes: notes.map(mapNote),
      noteVersions: versions.map(mapNoteVersion),
      knowledgeArtifactProvenance: records.map(mapKnowledgeArtifactProvenance)
    };
    if (migrations.length) {
      validateKnowledgeArtifactProvenanceRelations(state);
      return { migrated: false };
    }
    const [available] = await tx.$queryRawUnsafe<{ relation: string | null }[]>(
      "SELECT to_regclass('knowledge_extraction_commits')::text AS relation"
    );
    const rows = available?.relation
      ? await tx.$queryRawUnsafe<{ row: ExtractionCommitSqlRow }[]>(
          'SELECT to_jsonb(c) AS row FROM knowledge_extraction_commits c'
        )
      : [];
    const receipts = rows.map(({ row }) => {
      try {
        const record = JSON.parse(row.receipt_json);
        return knowledgeExtractionCommitKey(record) ===
          knowledgeExtractionCommitKey({ ownerId: row.owner_id, datasetId: row.dataset_id, jobId: row.job_id }) &&
          record.receiptHash === row.receipt_hash
          ? record
          : null;
      } catch {
        return null;
      }
    });
    // 原始 JSON 仅提供可选字段视图，不把它视为已校验的同步日志。
    const getTombstone = (collection: string, id: string) =>
      (journal?.payload as { tombstones?: Record<string, Prisma.JsonValue | undefined> } | null)?.tombstones?.[
        JSON.stringify([collection, id])
      ];
    const stats = backfillKnowledgeArtifactProvenance(state, { receipts, getTombstone });
    const previous = new Map(records.map(record => [record.id, record.provenanceHash]));
    for (const record of state.knowledgeArtifactProvenance) {
      if (getTombstone('knowledgeArtifactProvenance', record.id))
        throw createAppError('KNOWLEDGE_ARTIFACT_PROVENANCE_CONFLICT', '已永久删除的来源记录不能通过迁移重建。', 409);
      if (previous.get(record.id) === record.provenanceHash) continue;
      const data = dbKnowledgeArtifactProvenance(record);
      if (previous.has(record.id))
        await (
          tx.knowledgeArtifactProvenance.update as MigrationWriteOperation<
            typeof tx.knowledgeArtifactProvenance.update,
            { where: { id: string }; data: typeof data }
          >
        )({ where: { id: record.id }, data });
      else
        await (
          tx.knowledgeArtifactProvenance.create as MigrationWriteOperation<
            typeof tx.knowledgeArtifactProvenance.create,
            { data: typeof data }
          >
        )({ data });
    }
    validateKnowledgeArtifactProvenanceRelations(state);
    await tx.$executeRawUnsafe('INSERT INTO knowledge_artifact_provenance_migrations (version) VALUES (1)');
    return { migrated: true, ...stats };
  });
}
