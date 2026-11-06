import { createHash } from 'node:crypto';
import { validatePersonalTodoHistory } from '../../../api/src/modules/personal-todos/history-contract.ts';

/** 沿用已发布 v1 的只读契约；未安装该扩展的旧库不初始化任何表。 */
export function readPersonalTodoHistory(db) {
  const marker = db.prepare("SELECT value FROM metadata WHERE key='personalTodosVersion'").get()?.value;
  const schema = db.prepare("SELECT name,type FROM sqlite_master WHERE name GLOB 'personal_todos_*'").all();
  if (marker === undefined && !schema.length) return null;
  const fail = () => {
    throw new Error('个人待办历史版本、结构或完整性无效，原资料已保留。');
  };
  if (marker !== '1' || schema.length !== 1 || schema[0].name !== 'personal_todos_state' || schema[0].type !== 'table')
    fail();
  const columns = db
    .prepare('PRAGMA table_xinfo(personal_todos_state)')
    .all()
    .map(row => [row.name, row.type.toUpperCase(), row.notnull, row.pk, row.hidden]);
  if (
    JSON.stringify(columns) !==
      JSON.stringify([
        ['id', 'INTEGER', 0, 1, 0],
        ['record_json', 'TEXT', 1, 0, 0],
        ['record_hash', 'TEXT', 1, 0, 0]
      ]) ||
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND tbl_name='personal_todos_state'").get()
  )
    fail();
  const rows = db.prepare('SELECT * FROM personal_todos_state').all();
  if (
    rows.length !== 1 ||
    rows[0].id !== 1 ||
    createHash('sha256').update(rows[0].record_json).digest('hex') !== rows[0].record_hash
  )
    fail();
  return validatePersonalTodoHistory(JSON.parse(rows[0].record_json));
}
