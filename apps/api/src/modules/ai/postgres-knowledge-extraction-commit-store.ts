import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { KnowledgeExtractionCommitReceipt } from './knowledge-extraction-commit-types.ts';
import type { ExtractionSqlTransaction, PostgresExtractionStoreOptions } from './knowledge-extraction-host-types.ts';
interface CommitRow {
  owner_id: unknown;
  dataset_id: unknown;
  job_id: unknown;
  receipt_json: string;
  receipt_hash: unknown;
}
import { createAppError } from '../../errors/app-error.ts';
import { PERSISTENCE_TRANSACTION_ACTIVE } from '../../infrastructure/transaction-context.ts';
import {
  knowledgeExtractionCommitKey,
  validateKnowledgeExtractionCommit
} from './knowledge-extraction-commit-contract.ts';
import { createPostgresAiRepository } from './postgres-record-repository.ts';
import { createAsyncKnowledgeItemService } from '../knowledge/application/postgres-async/knowledge-domain-service.js';
import { createPostgresKnowledgeItemRepository } from '../knowledge/infrastructure/postgres/knowledge-item-repository.ts';
import { createPostgresKnowledgeEvidenceRepository } from '../knowledge/infrastructure/postgres/knowledge-evidence-repository.ts';
import { createPostgresKnowledgeArtifactProvenanceRepository } from '../knowledge/infrastructure/postgres/knowledge-artifact-provenance-repository.ts';
import { createPostgresNoteRepository } from '../knowledge/infrastructure/postgres/note-repository.ts';
import { createPostgresNoteVersionRepository } from '../knowledge/infrastructure/postgres/note-version-repository.ts';
import { createPostgresKnowledgeSpaceRepository } from '../knowledge/infrastructure/postgres/knowledge-space-repository.ts';
import { createPostgresAnalysisScopeRepository } from '../knowledge/infrastructure/postgres/annotation-support-repositories.ts';

export function createPostgresKnowledgeExtractionCommitStore({ client, ownerId }: PostgresExtractionStoreOptions) {
  return {
    supportsAsync: true,
    runTransaction<Result>(
      operation: (tx: ExtractionSqlTransaction) => Result | PromiseLike<Result>,
      input: { jobId: string }
    ) {
      if ((client as typeof client & { [PERSISTENCE_TRANSACTION_ACTIVE]?: boolean })[PERSISTENCE_TRANSACTION_ACTIVE])
        throw new TypeError('提炼接纳必须拥有最外层事务，不能嵌套提交。');
      return client.$transaction(
        async tx => {
          await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(1266775634, 32)::text');
          // 防止核心提交最后一步之后才出现 epoch 切换/撤权/取消。
          await tx.$queryRawUnsafe('SELECT owner_id FROM ai_runtime_epochs WHERE owner_id = $1 FOR UPDATE', ownerId);
          await tx.$queryRawUnsafe(
            'SELECT job_id FROM ai_jobs WHERE owner_id = $1 AND job_id = $2 FOR UPDATE',
            ownerId,
            input.jobId
          );
          await tx.$queryRawUnsafe(
            `SELECT g.grant_id FROM ai_grants g JOIN ai_jobs j ON j.grant_id = g.grant_id
          WHERE j.owner_id = $1 AND j.job_id = $2 FOR UPDATE OF g`,
            ownerId,
            input.jobId
          );
          return operation(tx);
        },
        { isolationLevel: 'Serializable', maxWait: 10000, timeout: 60000 }
      );
    },
    async get(input: Pick<DatasetIdentity, 'datasetId'> & { jobId: string }, tx: ExtractionSqlTransaction = client) {
      const [row] = await tx.$queryRawUnsafe<CommitRow[]>(
        `SELECT * FROM knowledge_extraction_commits
        WHERE owner_id = $1 AND dataset_id = $2 AND job_id = $3`,
        ownerId,
        input.datasetId,
        input.jobId
      );
      if (!row) return null;
      let content;
      try {
        content = JSON.parse(row.receipt_json);
      } catch {
        throw createAppError('KNOWLEDGE_EXTRACTION_COMMIT_INVALID', '提炼提交记录 JSON 无效。', 422);
      }
      const receipt = validateKnowledgeExtractionCommit(content);
      if (
        knowledgeExtractionCommitKey(receipt) !==
          knowledgeExtractionCommitKey({ ownerId: row.owner_id, datasetId: row.dataset_id, jobId: row.job_id }) ||
        receipt.receiptHash !== row.receipt_hash
      ) {
        throw createAppError('KNOWLEDGE_EXTRACTION_COMMIT_INVALID', '提炼提交索引与内容不一致。', 422);
      }
      return receipt;
    },
    insert: (receipt: KnowledgeExtractionCommitReceipt, tx: ExtractionSqlTransaction) =>
      tx.$executeRawUnsafe(
        `INSERT INTO knowledge_extraction_commits
      (owner_id, dataset_id, job_id, receipt_hash, receipt_json) VALUES ($1, $2, $3, $4, $5)`,
        receipt.ownerId,
        receipt.datasetId,
        receipt.jobId,
        receipt.receiptHash,
        JSON.stringify(receipt)
      )
  };
}

/** AI repository 的事务 API 绑定同一连接，绝不另开业务之外的提交。 */
export function createPostgresKnowledgeExtractionContext(tx: PostgresExtractionContextTransaction, ownerId: string) {
  const boundClient = new Proxy(tx, {
    get(target, key) {
      if (key === '$transaction')
        return <Result>(operation: (db: PostgresExtractionContextTransaction) => Result) => operation(tx);
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  const repositories = {
    knowledgeItemRepository: createPostgresKnowledgeItemRepository({ db: tx }),
    knowledgeEvidenceRepository: createPostgresKnowledgeEvidenceRepository({ db: tx }),
    knowledgeArtifactProvenanceRepository: createPostgresKnowledgeArtifactProvenanceRepository({ db: tx }),
    noteRepository: createPostgresNoteRepository({ db: tx }),
    noteVersionRepository: createPostgresNoteVersionRepository({ db: tx }),
    knowledgeSpaceRepository: createPostgresKnowledgeSpaceRepository({ db: tx }),
    analysisScopeRepository: createPostgresAnalysisScopeRepository({ db: tx })
  };
  const getTombstone = async (collection: string, id: string) => {
    const journal = await tx.syncJournal.findUnique({ where: { ownerId } });
    return journal?.payload?.tombstones?.[JSON.stringify([collection, id])] ?? null;
  };
  return {
    transaction: tx,
    repositories,
    aiRepository: createPostgresAiRepository({
      client: boundClient as typeof boundClient & import('./record-infrastructure-types.ts').AiSqlClient,
      ownerId
    }),
    knowledgeItemService: createAsyncKnowledgeItemService({
      repository: repositories.knowledgeItemRepository,
      evidenceRepository: repositories.knowledgeEvidenceRepository,
      ...repositories,
      getTombstone,
      runTransaction: <Result>(
        operation: (
          context: typeof repositories & {
            itemRepository: typeof repositories.knowledgeItemRepository;
            evidenceRepository: typeof repositories.knowledgeEvidenceRepository;
          }
        ) => Result
      ) =>
        operation({
          itemRepository: repositories.knowledgeItemRepository,
          evidenceRepository: repositories.knowledgeEvidenceRepository,
          ...repositories
        })
    })
  };
}

type RepositoryDatabase<Factory extends (options: never) => object> = Parameters<Factory>[0] extends { db: infer Db }
  ? Db
  : never;
type PostgresExtractionContextTransaction = ExtractionSqlTransaction &
  RepositoryDatabase<typeof createPostgresKnowledgeItemRepository> &
  RepositoryDatabase<typeof createPostgresKnowledgeEvidenceRepository> &
  RepositoryDatabase<typeof createPostgresKnowledgeArtifactProvenanceRepository> &
  RepositoryDatabase<typeof createPostgresNoteRepository> &
  RepositoryDatabase<typeof createPostgresNoteVersionRepository> &
  RepositoryDatabase<typeof createPostgresKnowledgeSpaceRepository> &
  RepositoryDatabase<typeof createPostgresAnalysisScopeRepository> & {
    syncJournal: {
      findUnique(input: {
        where: { ownerId: string };
      }): PromiseLike<{ payload?: { tombstones?: Record<string, unknown> } } | null>;
    };
  };
