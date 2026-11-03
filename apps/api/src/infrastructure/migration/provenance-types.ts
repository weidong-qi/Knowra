import type { Prisma } from '@prisma/client';
import type { PostgresTransactionHost } from '../postgres-transaction-port.ts';
import type { SyncTombstone } from '../../modules/sync/journal.ts';
import type { KnowledgeArtifactProvenance } from '../../modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';
import type { ProvenanceWriteData } from '../../modules/knowledge/infrastructure/postgres/knowledge-graph-repository-types.ts';

/** 回填只读取身份、来源状态和不可变正文，不要求调用者构造完整领域实例。 */
export interface ProvenanceBackfillState {
  knowledgeItems: {
    id: string;
    sourceMode?: string | null;
    deletedAt?: Prisma.JsonValue;
    reviewStatus?: string | null;
  }[];
  knowledgeEvidence: {
    id: string;
    knowledgeItemId: string;
    noteId?: string | null;
    sourceType?: string | null;
    noteVersionId?: string | null;
    quoteText?: Prisma.JsonValue;
    status?: string;
    applicabilityStatus?: string | null;
  }[];
  notes: {
    id: string;
    deleted?: Prisma.JsonValue;
    deletedAt?: Prisma.JsonValue;
    rawMarkdown?: string;
    contentHash?: Prisma.JsonValue;
  }[];
  noteVersions: { id: string; noteId: string; contentHash: string; content: string }[];
  knowledgeArtifactProvenance?: KnowledgeArtifactProvenance[] | null;
}
export interface ProvenanceBackfillOptions {
  /** 可选旧扩展的原始 JSON 元素，逐条交给既有 receipt 校验器。 */
  receipts?: unknown[];
  /** SQLite 返回布尔删除事实；PG 原始 JSON 与本地 journal 只按既有真假值语义读取。 */
  getTombstone?: (collection: string, id: string) => SyncTombstone | Prisma.JsonValue | undefined;
}
/** receipt_json 来自 TEXT 列；不会按 JSONB 或 Prisma 日期列解码。 */
interface ExtractionCommitSqlRow {
  owner_id: string;
  dataset_id: string;
  job_id: string;
  receipt_hash: string;
  receipt_json: string;
}
interface ProvenanceMigrationTransaction extends Pick<
  Prisma.TransactionClient,
  'knowledgeItem' | 'knowledgeEvidence' | 'note' | 'noteVersion' | 'syncJournal' | '$executeRawUnsafe'
> {
  knowledgeArtifactProvenance: Pick<Prisma.TransactionClient['knowledgeArtifactProvenance'], 'findMany'> & {
    // 保留原 mapper 的结构化 payload；Prisma 生成输入的索引签名不改变既有写入值。
    update(input: { where: { id: string }; data: ProvenanceWriteData }): PromiseLike<object>;
    create(input: { data: ProvenanceWriteData }): PromiseLike<object>;
  };
  $queryRawUnsafe(
    query: 'SELECT version FROM knowledge_artifact_provenance_migrations'
  ): Promise<{ version: number }[]>;
  $queryRawUnsafe(
    query: "SELECT to_regclass('knowledge_extraction_commits')::text AS relation"
  ): Promise<{ relation: string | null }[]>;
  $queryRawUnsafe(
    query: 'SELECT to_jsonb(c) AS row FROM knowledge_extraction_commits c'
  ): Promise<{ row: ExtractionCommitSqlRow }[]>;
}
export type ProvenanceMigrationClient = PostgresTransactionHost<ProvenanceMigrationTransaction>;
