import { taskKey, taskError, validateExtractionTask } from './knowledge-extraction-task-contract.ts';
import { createPostgresKnowledgeExtractionCommitStore } from './postgres-knowledge-extraction-commit-store.js';
import { extractionPageSql } from './knowledge-extraction-task-page.ts';

export function createPostgresKnowledgeExtractionTaskStore({ client, ownerId }) {
  const transactions = createPostgresKnowledgeExtractionCommitStore({ client, ownerId });
  const decode = row => {
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
    runTransaction: (operation, input = {}) => transactions.runTransaction(operation, { jobId: input.jobId ?? '' }),
    async get(input, tx = client) {
      const [row] = await tx.$queryRawUnsafe(
        'SELECT * FROM ai_knowledge_extraction_tasks WHERE owner_id = $1 AND dataset_id = $2 AND job_id = $3',
        ownerId,
        input.datasetId,
        input.jobId
      );
      return row ? decode(row) : null;
    },
    async list(input, tx = client) {
      return (
        await tx.$queryRawUnsafe(
          'SELECT * FROM ai_knowledge_extraction_tasks WHERE owner_id = $1 AND dataset_id = $2',
          ownerId,
          input.datasetId
        )
      ).map(decode);
    },
    async listPage(input, tx = client) {
      const { sql, values } = extractionPageSql({ ...input, ownerId }, true);
      return (await tx.$queryRawUnsafe(sql, ...values)).map(row => ({ jobId: row.job_id, createdAt: row.created_at }));
    },
    insert(input, tx) {
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
