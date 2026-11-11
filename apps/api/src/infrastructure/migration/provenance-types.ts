import type { Prisma } from '@prisma/client';
import type { PostgresTransactionHost } from '../postgres-transaction-port.ts';
import type { SyncTombstone } from '../../modules/sync/journal.ts';
import type { KnowledgeArtifactProvenance } from '../../modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';

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
    status?: string | null;
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
export interface ExtractionCommitSqlRow {
  owner_id: string;
  dataset_id: string;
  job_id: string;
  receipt_hash: string;
  receipt_json: string;
}
type ProvenanceMigrationTransaction = Pick<
  Prisma.TransactionClient,
  | 'knowledgeItem'
  | 'knowledgeEvidence'
  | 'note'
  | 'noteVersion'
  | 'syncJournal'
  | '$executeRawUnsafe'
  | '$queryRawUnsafe'
> & {
  knowledgeArtifactProvenance: Pick<Prisma.TransactionClient['knowledgeArtifactProvenance'], 'findMany'> & {
    update(input: {
      where: { id: string };
      data: Prisma.KnowledgeArtifactProvenanceUncheckedUpdateInput;
    }): PromiseLike<object>;
    create(input: { data: Prisma.KnowledgeArtifactProvenanceUncheckedCreateInput }): PromiseLike<object>;
  };
};
export type ProvenanceMigrationClient = PostgresTransactionHost<ProvenanceMigrationTransaction>;
