import { randomUUID, createHash } from 'node:crypto';
import { TASK_WORKSPACE_COLLECTIONS } from '../../../api/src/modules/task-workspaces/repository-port.ts';
import {
  validateTaskWorkspaceSnapshot,
  rebindTaskWorkspaceSnapshot
} from '../../../api/src/modules/task-workspaces/storage-validation.ts';

const tables = Object.fromEntries(TASK_WORKSPACE_COLLECTIONS.map(kind => [kind, `task_workspace_${kind}`]));
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (suffix, message, status = 503) => {
  throw Object.assign(new Error(message), { code: `TASK_WORKSPACE_${suffix}`, status, statusCode: status });
};
const table = kind => tables[kind] ?? fail('INVALID_COLLECTION', '任务工作区资料类型无效。');
const meta = (db, key) => db.prepare('SELECT value FROM metadata WHERE key = ?').get(key)?.value;

export function initializeTaskWorkspaceSchema(db) {
  const version = meta(db, 'taskWorkspaceVersion');
  if (version !== undefined) {
    if (version !== '1') fail('UNAVAILABLE', '任务工作区资料版本不受支持，请升级应用。');
    return;
  }
  if (
    db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name LIKE 'task_workspace_%'").all()
      .length
  )
    fail('UNAVAILABLE', '任务工作区资料格式不完整。');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const name of Object.values(tables)) {
      db.exec(`CREATE TABLE ${name} (id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL, dataset_epoch TEXT NOT NULL,
        workspace_id TEXT, revision INTEGER, record_json TEXT NOT NULL, record_hash TEXT NOT NULL);
        CREATE INDEX ${name}_scope ON ${name}(dataset_id, dataset_epoch, workspace_id);`);
    }
    db.prepare('INSERT INTO metadata VALUES (?, ?)').run('taskWorkspaceVersion', '1');
    db.prepare('INSERT INTO metadata VALUES (?, ?)').run('taskWorkspaceEpoch', randomUUID());
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function validateSchema(db) {
  const expected = [
    ['id', 'TEXT', 0, 1],
    ['dataset_id', 'TEXT', 1, 0],
    ['dataset_epoch', 'TEXT', 1, 0],
    ['workspace_id', 'TEXT', 0, 0],
    ['revision', 'INTEGER', 0, 0],
    ['record_json', 'TEXT', 1, 0],
    ['record_hash', 'TEXT', 1, 0]
  ];
  for (const name of Object.values(tables)) {
    if (db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(name)?.type !== 'table')
      fail('UNAVAILABLE', '任务工作区资料表结构无效。');
    const actual = db
      .prepare(`PRAGMA table_info(${name})`)
      .all()
      .map(row => [row.name, row.type, row.notnull, row.pk]);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('UNAVAILABLE', '任务工作区资料表结构无效。');
    const scope = db
      .prepare(`PRAGMA index_info(${name}_scope)`)
      .all()
      .map(row => row.name);
    if (JSON.stringify(scope) !== JSON.stringify(['dataset_id', 'dataset_epoch', 'workspace_id']))
      fail('UNAVAILABLE', '任务工作区资料索引结构无效。');
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND tbl_name=?").get(name))
      fail('UNAVAILABLE', '任务工作区资料表含未知触发器。');
  }
}

function decode(row) {
  if (!row) return null;
  if (hash(row.record_json) !== row.record_hash) fail('UNAVAILABLE', '任务工作区资料校验失败。');
  const value = JSON.parse(row.record_json);
  if (
    value.id !== row.id ||
    value.datasetId !== row.dataset_id ||
    value.datasetEpoch !== row.dataset_epoch ||
    (value.workspaceId ?? null) !== row.workspace_id ||
    (value.revision ?? null) !== row.revision
  )
    fail('UNAVAILABLE', '任务工作区索引与资料不一致。');
  return value;
}

export function readTaskWorkspaceSnapshot(db) {
  const version = meta(db, 'taskWorkspaceVersion');
  if (version === undefined) {
    if (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name LIKE 'task_workspace_%'")
        .all().length
    )
      fail('UNAVAILABLE', '任务工作区资料格式不完整。');
    return null;
  }
  if (version !== '1' || !meta(db, 'taskWorkspaceEpoch')) fail('UNAVAILABLE', '任务工作区资料版本不受支持。');
  validateSchema(db);
  const snapshot = Object.fromEntries(
    TASK_WORKSPACE_COLLECTIONS.map(kind => [
      kind,
      db
        .prepare(`SELECT * FROM ${table(kind)} ORDER BY rowid`)
        .all()
        .map(decode)
    ])
  );
  // 既有legacy备份允许缺datasetId；仅空的新域无需绑定任何实体。
  const datasetId =
    meta(db, 'datasetId') ??
    (Object.values(snapshot).every(values => values.length === 0) ? 'legacy-empty-domain' : undefined);
  validateTaskWorkspaceSnapshot({ ...snapshot, version: 1, datasetId, datasetEpoch: meta(db, 'taskWorkspaceEpoch') });
  return snapshot;
}

/** 独立事务和表，不调用核心 persist，也不建立同步/搜索条目。 */
export function createSqliteTaskWorkspaceStore(db, { beforeCommit = () => {} } = {}) {
  initializeTaskWorkspaceSchema(db);
  readTaskWorkspaceSnapshot(db);
  const identity = () => ({ datasetId: meta(db, 'datasetId'), datasetEpoch: meta(db, 'taskWorkspaceEpoch') });
  function view(writable, isActive = () => db.isTransaction) {
    const assertLive = () => {
      if (!isActive()) fail('READ_ONLY', '任务工作区快照已结束。', 409);
    };
    const assertWrite = () => {
      if (!writable || !isActive()) fail('READ_ONLY', '任务工作区快照不可修改。', 409);
    };
    return {
      identity: () => {
        assertLive();
        return identity();
      },
      get(kind, id) {
        assertLive();
        return decode(db.prepare(`SELECT * FROM ${table(kind)} WHERE id = ?`).get(id));
      },
      list(kind) {
        assertLive();
        return db
          .prepare(`SELECT * FROM ${table(kind)} ORDER BY rowid`)
          .all()
          .map(decode);
      },
      insert(kind, record) {
        assertWrite();
        const json = JSON.stringify(record);
        try {
          db.prepare(`INSERT INTO ${table(kind)} VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
            record.id,
            record.datasetId,
            record.datasetEpoch,
            record.workspaceId ?? null,
            record.revision ?? null,
            json,
            hash(json)
          );
        } catch (error) {
          if (error.code?.startsWith('ERR_SQLITE') && String(error.message).includes('UNIQUE'))
            fail('CONFLICT', '任务工作区资料已变化，请刷新重试。', 409);
          throw error;
        }
      },
      replace(kind, record, expectedRevision) {
        assertWrite();
        const json = JSON.stringify(record);
        const result = db
          .prepare(
            `UPDATE ${table(kind)} SET dataset_id=?, dataset_epoch=?, workspace_id=?, revision=?, record_json=?, record_hash=? WHERE id=?${expectedRevision === undefined ? '' : ' AND revision=?'}`
          )
          .run(
            record.datasetId,
            record.datasetEpoch,
            record.workspaceId ?? null,
            record.revision ?? null,
            json,
            hash(json),
            record.id,
            ...(expectedRevision === undefined ? [] : [expectedRevision])
          );
        if (result.changes !== 1) fail('CONFLICT', '任务工作区资料已变化，请刷新重试。', 409);
      }
    };
  }
  function transaction(callback, writable, { beforeCommit: finalGuard } = {}) {
    if (db.isTransaction) fail('CONFLICT', '任务工作区事务不能嵌入其他事务。', 409);
    try {
      db.exec(writable ? 'BEGIN IMMEDIATE' : 'BEGIN');
    } catch (error) {
      if ([5, 6].includes(error.errcode) || /database (?:is )?(?:locked|busy)/i.test(error.message))
        fail('CONFLICT', '任务工作区正被其他窗口修改，请重试。', 409);
      throw error;
    }
    let active = true;
    try {
      if (meta(db, 'taskWorkspaceVersion') !== '1') fail('UNAVAILABLE', '任务工作区资料版本不受支持。');
      const result = callback(view(writable, () => active && db.isTransaction));
      if (result?.then) throw new TypeError('任务工作区事务只能执行同步操作。');
      if (writable) {
        readTaskWorkspaceSnapshot(db);
        beforeCommit();
        if (finalGuard) {
          const allowed = finalGuard();
          if (allowed === false || allowed?.then) fail('FORBIDDEN', '任务工作区授权或请求已失效。', 403);
        }
      }
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    } finally {
      active = false;
    }
  }
  return {
    available: true,
    identity,
    readSnapshot: callback => transaction(callback, false),
    runTransaction: (callback, options) => transaction(callback, true, options),
    rotateEpoch() {
      const operation = () => {
        const epoch = randomUUID(),
          datasetId = meta(db, 'datasetId');
        const tx = view(true);
        const snapshot = Object.fromEntries(TASK_WORKSPACE_COLLECTIONS.map(kind => [kind, tx.list(kind)]));
        const rebound = rebindTaskWorkspaceSnapshot(
          { ...snapshot, version: 1, ...identity() },
          { datasetId, datasetEpoch: epoch }
        );
        for (const kind of TASK_WORKSPACE_COLLECTIONS.filter(kind => kind !== 'receipts'))
          for (const record of rebound[kind]) tx.replace(kind, record);
        db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run('taskWorkspaceEpoch', epoch);
        readTaskWorkspaceSnapshot(db);
        return epoch;
      };
      // 恢复/导入已持有宿主 BEGIN IMMEDIATE 时参与同一事务。
      return db.isTransaction ? operation() : transaction(operation, true);
    }
  };
}
