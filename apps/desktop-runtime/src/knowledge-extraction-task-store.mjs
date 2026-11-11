import fs from 'node:fs';
import { validateExtractionTask } from '../../api/src/modules/ai/knowledge-extraction-task-contract.ts';
import { extractionPageSql } from '../../api/src/modules/ai/knowledge-extraction-task-page.ts';
import {
  decodeSqliteKnowledgeExtractionTask as decode,
  validateSqliteKnowledgeExtractionTasks
} from './knowledge-extraction-validation.mjs';
export { validateSqliteKnowledgeExtractionTasks } from './knowledge-extraction-validation.mjs';

/** 独立私有扩展；保持 AI user_version，备份后升级，不能覆盖未来或损坏描述。 */
export function createSqliteKnowledgeExtractionTaskStore(db, filePath, runTransaction) {
  const version = db.prepare("SELECT value FROM metadata WHERE key = 'aiKnowledgeExtractionTasksVersion'").get()?.value;
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_knowledge_extraction_tasks'")
    .get();
  if (version === undefined) {
    if (exists) throw new Error('未标记版本的提炼任务表不能自动覆盖。');
    const backup = `${filePath}.before-knowledge-extraction-tasks-v1-${Date.now()}.bak`;
    db.prepare('VACUUM INTO ?').run(backup);
    fs.chmodSync(backup, 0o600);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE ai_knowledge_extraction_tasks (
        owner_id TEXT NOT NULL, dataset_id TEXT NOT NULL, job_id TEXT NOT NULL,
        descriptor_json TEXT NOT NULL, PRIMARY KEY (owner_id, dataset_id, job_id)
      ); INSERT INTO metadata VALUES ('aiKnowledgeExtractionTasksVersion', '1'); COMMIT;`);
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  } else if (version !== '1' || !exists) throw new Error('提炼任务存储版本或结构无效。');
  validateSqliteKnowledgeExtractionTasks(db);
  return {
    supportsAsync: false,
    runTransaction(operation) {
      if (db.isTransaction) throw new TypeError('提炼任务必须拥有最外层事务。');
      return runTransaction(operation);
    },
    get(input) {
      const row = db
        .prepare('SELECT * FROM ai_knowledge_extraction_tasks WHERE owner_id = ? AND dataset_id = ? AND job_id = ?')
        .get(input.ownerId, input.datasetId, input.jobId);
      return row ? decode(row) : null;
    },
    list: input =>
      db
        .prepare('SELECT * FROM ai_knowledge_extraction_tasks WHERE owner_id = ? AND dataset_id = ?')
        .all(input.ownerId, input.datasetId)
        .map(decode),
    listPage(input) {
      const { sql, values } = extractionPageSql(input);
      return db
        .prepare(sql)
        .all(...values)
        .map(row => ({ jobId: row.job_id, createdAt: row.created_at }));
    },
    insert(input) {
      const task = validateExtractionTask(input);
      db.prepare('INSERT INTO ai_knowledge_extraction_tasks VALUES (?, ?, ?, ?)').run(
        task.ownerId,
        task.datasetId,
        task.jobId,
        JSON.stringify(task)
      );
    }
  };
}
