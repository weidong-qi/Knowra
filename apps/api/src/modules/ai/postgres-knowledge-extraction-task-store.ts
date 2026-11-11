import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { ExtractionPage } from './knowledge-extraction-query-types.ts';
import type { ExtractionSqlTransaction, PostgresExtractionStoreOptions } from './knowledge-extraction-host-types.ts';
interface TaskRow {
  owner_id: unknown;
  dataset_id: unknown;
  job_id: string;
  descriptor_json: string;
  created_at: string;
}
import { taskKey, taskError, validateExtractionTask } from './knowledge-extraction-task-contract.ts';
import { createPostgresKnowledgeExtractionCommitStore } from './postgres-knowledge-extraction-commit-store.ts';
import { extractionPageSql } from './knowledge-extraction-task-page.ts';

export function createPostgresKnowledgeExtractionTaskStore({ client, ownerId }: PostgresExtractionStoreOptions) {
  const transactions = createPostgresKnowledgeExtractionCommitStore({ client, ownerId });
  const decode = (row: TaskRow) => {
    let record;
    try {
      record = validateExtractionTask(JSON.parse(row.descriptor_json));
    } catch {
      throw taskError('KNOWLEDGE_EXTRACTION_TASK_INVALID', '提炼任务描述损坏，已停止执行。', 422);
    }
    if (taskKey(record) !== taskKey({ ownerId: row.owner_id, datasetId: row.dataset_id, jobId: row.job_id })) {
      throw taskError('KNOWLEDGE_EXTRACTION_TASK_INVALID', '提炼任务索引不匹配。', 422);
    }
    return record;
  };
  return {
    supportsAsync: true,
    runTransaction: <Result>(
      operation: (tx: ExtractionSqlTransaction) => Result | PromiseLike<Result>,
      input: { jobId?: string } = {}
    ) => transactions.runTransaction(operation, { jobId: input.jobId ?? '' }),
    async get(input: Pick<DatasetIdentity, 'datasetId'> & { jobId: string }, tx: ExtractionSqlTransaction = client) {
      const [row] = await tx.$queryRawUnsafe<TaskRow[]>(
        'SELECT * FROM ai_knowledge_extraction_tasks WHERE owner_id = $1 AND dataset_id = $2 AND job_id = $3',
        ownerId,
        input.datasetId,
        input.jobId
      );
      return row ? decode(row) : null;
    },
    async list(input: Pick<DatasetIdentity, 'datasetId'>, tx: ExtractionSqlTransaction = client) {
      return (
        await tx.$queryRawUnsafe<TaskRow[]>(
          'SELECT * FROM ai_knowledge_extraction_tasks WHERE owner_id = $1 AND dataset_id = $2',
          ownerId,
          input.datasetId
        )
      ).map(decode);
    },
    async listPage(input: ExtractionPage, tx: ExtractionSqlTransaction = client) {
      const { sql, values } = extractionPageSql({ ...input, ownerId }, true);
      return (await tx.$queryRawUnsafe<TaskRow[]>(sql, ...values)).map(row => ({
        jobId: row.job_id,
        createdAt: row.created_at
      }));
    },
    insert(input: unknown, tx: ExtractionSqlTransaction) {
      const task = validateExtractionTask(input);
      if (task.ownerId !== ownerId) throw taskError('KNOWLEDGE_EXTRACTION_TASK_INVALID', '任务 owner 不匹配。');
      return tx.$executeRawUnsafe(
        'INSERT INTO ai_knowledge_extraction_tasks (owner_id, dataset_id, job_id, descriptor_json) VALUES ($1, $2, $3, $4)',
        task.ownerId,
        task.datasetId,
        task.jobId,
        JSON.stringify(task)
      );
    }
  };
}
