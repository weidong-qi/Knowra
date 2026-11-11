import {
  knowledgeExtractionCommitKey,
  validateKnowledgeExtractionCommit
} from '../../api/src/modules/ai/knowledge-extraction-commit-contract.ts';
import {
  EXTRACTION_MOCK_PROFILE,
  taskKey,
  validateExtractionTask
} from '../../api/src/modules/ai/knowledge-extraction-task-contract.ts';
import { KNOWLEDGE_EXTRACTION_PROMPT_VERSION } from '../../api/src/modules/ai/knowledge-extraction-gateway.ts';

const extensions = {
  commits: {
    table: 'knowledge_extraction_commits',
    metadata: 'knowledgeExtractionCommitsVersion',
    column: 'receipt_json',
    label: '提炼提交'
  },
  tasks: {
    table: 'ai_knowledge_extraction_tasks',
    metadata: 'aiKnowledgeExtractionTasksVersion',
    column: 'descriptor_json',
    label: '提炼任务'
  }
};
const same = (left, right, fields) => fields.every(key => left[key] === right[key]);
const boundary = ['ownerId', 'datasetId', 'datasetEpoch', 'spaceId'];
const invalidLinks = () => {
  throw new Error('备份提炼记录的历史关联不一致。');
};

function parseRecord(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label}记录 JSON 无效。`);
  }
}

/** 仅检查这两种独立扩展；不初始化、不迁移、不修改 metadata 或历史记录。 */
function readRows(db, kind) {
  const { table, metadata, column, label } = extensions[kind];
  const version = db.prepare('SELECT value FROM metadata WHERE key = ?').get(metadata)?.value;
  const object = db.prepare("SELECT type FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')").get(table);
  if (version === undefined && !object) return [];
  if (version !== '1' || object?.type !== 'table') throw new Error(`${label}存储版本或结构无效。`);
  // 写入使用固定列序；空表也必须保有正确的列约束和唯一身份，不能仅逐行 decode。
  const columns = db.prepare(`PRAGMA table_xinfo(${table})`).all();
  const expected = ['owner_id', 'dataset_id', 'job_id', column];
  if (
    columns.length !== expected.length ||
    columns.some(
      (item, index) =>
        item.name !== expected[index] ||
        item.type.toUpperCase() !== 'TEXT' ||
        item.notnull !== 1 ||
        item.pk !== (index < 3 ? index + 1 : 0) ||
        item.hidden !== 0
    )
  ) {
    throw new Error(`${label}存储表结构无效。`);
  }
  return db.prepare(`SELECT * FROM ${table}`).all();
}

export function decodeSqliteKnowledgeExtractionCommit(row) {
  const receipt = validateKnowledgeExtractionCommit(parseRecord(row.receipt_json, '提炼提交'));
  if (
    knowledgeExtractionCommitKey(receipt) !==
    knowledgeExtractionCommitKey({ ownerId: row.owner_id, datasetId: row.dataset_id, jobId: row.job_id })
  )
    throw new Error('提炼提交索引与内容不一致。');
  return receipt;
}

export function decodeSqliteKnowledgeExtractionTask(row) {
  const task = validateExtractionTask(parseRecord(row.descriptor_json, '提炼任务'));
  if (taskKey(task) !== taskKey({ ownerId: row.owner_id, datasetId: row.dataset_id, jobId: row.job_id })) {
    throw new Error('提炼任务索引与内容不一致。');
  }
  return task;
}

export function validateSqliteKnowledgeExtractionCommits(db) {
  return readRows(db, 'commits').map(decodeSqliteKnowledgeExtractionCommit);
}

export function validateSqliteKnowledgeExtractionTasks(db) {
  return readRows(db, 'tasks').map(decodeSqliteKnowledgeExtractionTask);
}

/** 历史记录彼此的静态绑定，不等于当前可执行性；不读取当前来源或重新校验/授予权限。 */
export function validateSqliteKnowledgeExtractionBackup(db, jobs) {
  const receipts = validateSqliteKnowledgeExtractionCommits(db);
  const tasks = validateSqliteKnowledgeExtractionTasks(db);
  const jobsByKey = new Map(jobs.map(job => [taskKey(job), job]));
  const receiptsByKey = new Map(receipts.map(receipt => [knowledgeExtractionCommitKey(receipt), receipt]));
  for (const task of tasks) {
    const key = taskKey(task),
      job = jobsByKey.get(key),
      receipt = receiptsByKey.get(key);
    if (
      !job ||
      !same(job, task, [...boundary, 'jobId', 'inputHash', 'createdAt']) ||
      job.jobKind !== 'knowledgeExtraction' ||
      job.promptVersion !== KNOWLEDGE_EXTRACTION_PROMPT_VERSION ||
      job.resultSchemaVersion !== 'knowledge-extraction-v1' ||
      job.modelId !== EXTRACTION_MOCK_PROFILE.modelId ||
      job.credentialRef !== EXTRACTION_MOCK_PROFILE.credentialRef ||
      job.provider !== 'deepseek' ||
      job.resultJson
    )
      invalidLinks();
    if (job.status === 'succeeded' && !receipt) invalidLinks();
    if (receipt && !same(receipt, task, [...boundary, 'scopeId', 'inputHash', 'executionMode'])) invalidLinks();
  }
  for (const receipt of receipts) {
    // 核心历史不依赖私有任务的保留。02A 没有 descriptor，配置也不必是02B的固定Mock profile。
    const job = jobsByKey.get(knowledgeExtractionCommitKey(receipt));
    if (!job) continue;
    if (
      !same(receipt, job, [
        ...boundary,
        'requestId',
        'inputHash',
        'outputHash',
        'modelId',
        'promptVersion',
        'resultSchemaVersion'
      ]) ||
      job.jobKind !== 'knowledgeExtraction' ||
      job.status !== 'succeeded' ||
      job.phase !== 'finished' ||
      job.acceptedAttemptId !== receipt.attemptId ||
      job.resultJson
    )
      invalidLinks();
  }
}
