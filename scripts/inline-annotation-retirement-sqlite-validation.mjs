import { DatabaseSync } from 'node:sqlite';
import {
  AI_SQLITE_DDL,
  AI_ACCESS_SQLITE_DDL,
  AI_CONVERSATION_SQLITE_DDL
} from '../apps/desktop-runtime/src/ai-sqlite-schema.mjs';
import { AI_SQL_DEFINITIONS, decodeAiRow } from '../apps/api/src/modules/ai/record-sql-map.ts';
import { validateAiEvent } from '../apps/api/src/modules/ai/record-contract.ts';
import { createSqliteAiRepository } from '../apps/desktop-runtime/src/ai-sqlite-repository.mjs';
import { validateSqliteAccessRows } from '../apps/desktop-runtime/src/ai-sqlite-access-store.mjs';
import { validateSqliteConversationRows } from '../apps/desktop-runtime/src/ai-sqlite-conversation-store.mjs';
import { validateSqliteCoreOperationRows } from '../apps/desktop-runtime/src/core-operation-store.mjs';
import { validateSqliteActionRows } from '../apps/desktop-runtime/src/ai-sqlite-action-store.mjs';
import { validateSqliteKnowledgeExtractionBackup } from '../apps/desktop-runtime/src/knowledge-extraction-validation.mjs';
import { TASK_WORKSPACE_COLLECTIONS } from '../apps/api/src/modules/task-workspaces/repository-port.ts';
import { readTaskWorkspaceSnapshot } from '../apps/desktop-runtime/src/task-workspaces/sqlite-store.mjs';
import { HISTORY_NON_PRIVATE_TABLES } from '../apps/desktop-runtime/src/note-version-discard-gate.mjs';

const quote = name => `"${name.replaceAll('"', '""')}"`;
const invalid = () => {
  throw new Error('SQLite 私有资料结构、契约或完整性校验失败，未生成核对结论。');
};
const foreignKeys = (db, table) =>
  db
    .prepare(`PRAGMA foreign_key_list(${quote(table)})`)
    .all()
    .map(({ table, from, to, on_update, on_delete, match }) => [table, from, to, on_update, on_delete, match])
    .sort();
const columns = (db, table) =>
  db
    .prepare(`PRAGMA table_xinfo(${quote(table)})`)
    .all()
    .map(({ name, type, notnull, pk, dflt_value, hidden }) => ({
      name,
      type: type.toUpperCase(),
      notnull,
      pk,
      dflt_value,
      hidden
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

/** 仅在内存构造所属 DDL 的对照结构；源连接保持只读，不初始化、不迁移。 */
function validateTableShapes(db, tables, version) {
  const reference = new DatabaseSync(':memory:');
  const checked = new Set();
  try {
    reference.exec(AI_SQLITE_DDL + AI_ACCESS_SQLITE_DDL + AI_CONVERSATION_SQLITE_DDL);
    // 这些独立扩展的逐行校验器没有空表结构检查，先核对读取所需的身份/正文列约束。
    reference.exec(`CREATE TABLE core_operation_receipts (owner_id TEXT NOT NULL, dataset_id TEXT NOT NULL,
      operation_id TEXT NOT NULL, receipt_json TEXT NOT NULL, PRIMARY KEY(owner_id,dataset_id,operation_id));
      CREATE TABLE ai_note_action_state (id INTEGER PRIMARY KEY CHECK(id=1),state_json TEXT NOT NULL,state_hash TEXT NOT NULL);
      CREATE TABLE sync_recovery (id TEXT PRIMARY KEY,payload TEXT NOT NULL);`);
    for (const { name } of reference.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
      if (!tables.has(name)) continue;
      let expected = columns(reference, name);
      const actual = columns(db, name);
      // v4 尚未增加这两个可空字段；旧表按命名列读取，升级追加列的顺序无需相同。
      if (
        name === 'ai_jobs' &&
        version === 4 &&
        !actual.some(column => column.name === 'question' || column.name === 'result_json')
      )
        expected = expected.filter(column => !['question', 'result_json'].includes(column.name));
      if (
        JSON.stringify(actual) !== JSON.stringify(expected) ||
        JSON.stringify(foreignKeys(db, name)) !== JSON.stringify(foreignKeys(reference, name))
      )
        invalid();
      checked.add(name);
    }
  } finally {
    reference.close();
  }
  return checked;
}

/** 所属模块的只读解码、哈希、索引及历史关联校验，不能仅以 JSON 可解析标记 checked。 */
export function validateRetirementSqlitePrivateRecords(db, tables, version) {
  try {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='view' LIMIT 1").get()) invalid();
    if (
      db
        .prepare('PRAGMA integrity_check')
        .all()
        .some(row => row.integrity_check !== 'ok') ||
      db.prepare('PRAGMA foreign_key_check').all().length
    )
      invalid();
    const checked = validateTableShapes(db, tables, version);
    const jobs = [];
    if (
      [...Object.values(AI_SQL_DEFINITIONS).map(definition => definition.table), 'ai_job_events', 'ai_actions'].some(
        name => tables.has(name)
      )
    ) {
      for (const [kind, { table }] of Object.entries(AI_SQL_DEFINITIONS)) {
        for (const row of db.prepare(`SELECT * FROM ${quote(table)}`).iterate()) {
          const record = decodeAiRow(
            kind,
            kind === 'aiJob' && version === 4 ? { question: null, result_json: null, ...row } : row
          );
          if (kind === 'aiJob') jobs.push(record);
        }
      }
      const repository = createSqliteAiRepository(db);
      for (const job of jobs) repository.listEvents(job.jobId).forEach(validateAiEvent);
      // P0 预留表没有现役解码器；有记录时不能把未知动作格式当成核对通过。
      if (db.prepare('SELECT 1 FROM ai_actions LIMIT 1').get()) invalid();
    }
    if (['ai_access_policies', 'ai_run_grants', 'ai_request_manifests'].some(name => tables.has(name)))
      validateSqliteAccessRows(db);
    if (tables.has('ai_conversation_records')) validateSqliteConversationRows(db);
    validateSqliteCoreOperationRows(db);
    validateSqliteActionRows(db);
    if (
      tables.has('ai_note_action_state') &&
      db.prepare('SELECT 1 FROM ai_note_action_state WHERE id IS NOT 1 LIMIT 1').get()
    )
      invalid();
    // 同时检查描述符、提交、索引/hash，以及与 AIJob 的静态绑定，不授予权限或执行任务。
    validateSqliteKnowledgeExtractionBackup(db, jobs);
    for (const name of ['knowledge_extraction_commits', 'ai_knowledge_extraction_tasks'])
      if (tables.has(name)) checked.add(name);
    readTaskWorkspaceSnapshot(db);
    for (const kind of TASK_WORKSPACE_COLLECTIONS)
      if (tables.has(`task_workspace_${kind}`)) checked.add(`task_workspace_${kind}`);
    // 旧上传和冲突由调用方按不可重放的原始请求读取；其他无所属契约的表只扫描，不冒充完整校验。
    const unchecked = [...tables].some(
      name =>
        !HISTORY_NON_PRIVATE_TABLES.includes(name) &&
        !['sync_uploads', 'sync_conflicts'].includes(name) &&
        !checked.has(name)
    );
    return unchecked ? 'unavailable-private-contract' : 'checked';
  } catch {
    invalid();
  }
}
