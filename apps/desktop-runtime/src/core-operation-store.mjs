import fs from 'node:fs';
import {
  coreOperationKey,
  validateCoreOperationReceipt
} from '../../api/src/infrastructure/core-operation-contract.ts';
import { createSyncCoreOperationStore } from '../../api/src/infrastructure/core-operation-store.ts';

// 独立核心扩展版本，不复用可选 AI 的 user_version；损坏时关闭本提交入口，保留原表与核心编辑。
export function createSqliteCoreOperationStore(db, filePath, runTransaction) {
  const version = db.prepare("SELECT value FROM metadata WHERE key = 'coreOperationsVersion'").get()?.value;
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'core_operation_receipts'")
    .get();
  if (version === undefined) {
    if (exists) throw new Error('未标记版本的核心回执表不能自动覆盖。');
    const backup = `${filePath}.before-core-operations-v1-${Date.now()}.bak`;
    db.prepare('VACUUM INTO ?').run(backup);
    fs.chmodSync(backup, 0o600);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE core_operation_receipts (
        owner_id TEXT NOT NULL, dataset_id TEXT NOT NULL, operation_id TEXT NOT NULL,
        receipt_json TEXT NOT NULL, PRIMARY KEY (owner_id, dataset_id, operation_id)
      ); INSERT INTO metadata VALUES ('coreOperationsVersion', '1'); COMMIT;`);
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  } else if (version !== '1' || !exists) throw new Error('核心回执存储版本或结构无效。');
  validateSqliteCoreOperationRows(db);
  return createSyncCoreOperationStore({
    transaction: operation => {
      if (db.isTransaction) throw new TypeError('核心操作必须拥有最外层事务，不能嵌套提交。');
      return runTransaction(operation);
    },
    get: input => {
      const row = db
        .prepare(
          `SELECT receipt_json FROM core_operation_receipts
        WHERE owner_id = ? AND dataset_id = ? AND operation_id = ?`
        )
        .get(input.ownerId, input.datasetId, input.operationId);
      if (!row) return null;
      const receipt = validateCoreOperationReceipt(JSON.parse(row.receipt_json));
      if (coreOperationKey(receipt) !== coreOperationKey(input)) throw new Error('核心回执索引与内容不一致。');
      return receipt;
    },
    insert: receipt =>
      db
        .prepare('INSERT INTO core_operation_receipts VALUES (?, ?, ?, ?)')
        .run(receipt.ownerId, receipt.datasetId, receipt.operationId, JSON.stringify(receipt))
  });
}

export function validateSqliteCoreOperationRows(db) {
  const version = db.prepare("SELECT value FROM metadata WHERE key = 'coreOperationsVersion'").get()?.value;
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'core_operation_receipts'")
    .get();
  if (version === undefined && !exists) return; // 原版本备份仍可恢复，升级时才增加表。
  if (version !== '1' || !exists) throw new Error('核心回执存储版本或结构无效。');
  for (const row of db.prepare('SELECT * FROM core_operation_receipts').all()) {
    const receipt = validateCoreOperationReceipt(JSON.parse(row.receipt_json));
    if (
      coreOperationKey(receipt) !==
      coreOperationKey({ ownerId: row.owner_id, datasetId: row.dataset_id, operationId: row.operation_id })
    )
      throw new Error('核心回执索引与内容不一致。');
  }
}
