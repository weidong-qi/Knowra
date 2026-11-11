import { hashRecord } from './record-contract.ts';
import { taskError, taskId } from './knowledge-extraction-task-contract.ts';
import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { ExtractionPage, ExtractionPageJob, ExtractionPageRow } from './knowledge-extraction-query-types.ts';

interface RawPageInput {
  spaceId?: unknown;
  idempotencyKey?: unknown;
  limit?: unknown;
  cursor?: unknown;
}
interface RawPageCursor {
  version?: unknown;
  binding?: unknown;
  jobId?: unknown;
  createdAt?: unknown;
}

const invalid = (): never => {
  throw taskError('KNOWLEDGE_EXTRACTION_REQUEST_INVALID', '任务分页请求无效。', 422);
};

export function extractionPageInput(input: unknown, identity: DatasetIdentity, ownerId: string) {
  if (
    !input ||
    Array.isArray(input) ||
    Object.keys(input).some(key => !['spaceId', 'idempotencyKey', 'limit', 'cursor'].includes(key)) ||
    !taskId((input as RawPageInput).spaceId) ||
    ((input as RawPageInput).idempotencyKey !== undefined && !taskId((input as RawPageInput).idempotencyKey))
  )
    invalid();
  const limit = (input as RawPageInput).limit ?? 20;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50) invalid();
  const page: ExtractionPage = {
    ownerId,
    ...identity,
    spaceId: (input as RawPageInput).spaceId,
    idempotencyKey: (input as RawPageInput).idempotencyKey,
    limit: limit as number
  };
  const binding = hashRecord({
    ownerId,
    ...identity,
    spaceId: (input as RawPageInput).spaceId,
    idempotencyKey: (input as RawPageInput).idempotencyKey ?? null
  });
  if ((input as RawPageInput).cursor !== undefined) {
    if (
      typeof (input as RawPageInput).cursor !== 'string' ||
      ((input as RawPageInput).cursor as string).length > 1200 ||
      !/^[A-Za-z0-9_-]+$/.test((input as RawPageInput).cursor as string)
    )
      invalid();
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from((input as RawPageInput).cursor as string, 'base64url').toString('utf8'));
    } catch {
      invalid();
    }
    if (
      !value ||
      Array.isArray(value) ||
      Object.keys(value).length !== 4 ||
      (value as RawPageCursor).version !== 1 ||
      (value as RawPageCursor).binding !== binding ||
      !taskId((value as RawPageCursor).jobId) ||
      typeof (value as RawPageCursor).createdAt !== 'string' ||
      !Number.isFinite(Date.parse((value as RawPageCursor).createdAt as string))
    )
      invalid();
    page.before = {
      createdAt: (value as RawPageCursor).createdAt as string,
      jobId: (value as RawPageCursor).jobId as string
    };
  }
  return {
    page,
    cursor: (row: ExtractionPageRow) =>
      Buffer.from(JSON.stringify({ version: 1, binding, createdAt: row.createdAt, jobId: row.jobId })).toString(
        'base64url'
      )
  };
}

/** JSON 全状态已在内存；先筛选截页，再复制，不复制整个 owner 的私有记录。 */
export function extractionPageRows(jobs: ExtractionPageJob[], taskIds: ReadonlySet<string>, input: ExtractionPage) {
  return jobs
    .filter(
      job =>
        taskIds.has(job.jobId) &&
        job.ownerId === input.ownerId &&
        job.datasetId === input.datasetId &&
        job.datasetEpoch === input.datasetEpoch &&
        job.spaceId === input.spaceId &&
        job.jobKind === 'knowledgeExtraction' &&
        (input.idempotencyKey === undefined || job.idempotencyKey === input.idempotencyKey) &&
        (!input.before ||
          job.createdAt < input.before.createdAt ||
          (job.createdAt === input.before.createdAt && job.jobId < input.before.jobId))
    )
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.jobId < b.jobId ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, input.limit + 1)
    .map(({ jobId, createdAt }) => ({ jobId, createdAt }));
}

/** 专用参数化查询：数据库只返回一页，不经通用 repository.list 全量读取。 */
export function extractionPageSql(input: ExtractionPage, postgres = false) {
  // 参数含请求后次属性读取的原值；保留原绑定与数据库自身的接收/失败行为。
  const values: unknown[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return postgres ? `$${values.length}` : '?';
  };
  const where = [
    `j.owner_id = ${bind(input.ownerId)}`,
    `j.dataset_id = ${bind(input.datasetId)}`,
    `j.dataset_epoch = ${bind(input.datasetEpoch)}`,
    `j.space_id = ${bind(input.spaceId)}`,
    "j.job_kind = 'knowledgeExtraction'"
  ];
  if (input.idempotencyKey !== undefined) where.push(`j.idempotency_key = ${bind(input.idempotencyKey)}`);
  if (input.before)
    where.push(
      `(j.created_at < ${bind(input.before.createdAt)} OR (j.created_at = ${bind(input.before.createdAt)} AND j.job_id < ${bind(input.before.jobId)}))`
    );
  const sql = `SELECT j.job_id, j.created_at FROM ai_jobs j
    JOIN ai_knowledge_extraction_tasks t ON t.owner_id = j.owner_id AND t.dataset_id = j.dataset_id AND t.job_id = j.job_id
    WHERE ${where.join(' AND ')} ORDER BY j.created_at DESC, j.job_id DESC LIMIT ${bind(input.limit + 1)}`;
  return { sql, values };
}
