import { createAppError } from '../errors/app-error.js';
import { createAsyncCoreOperationStore } from './core-operation-store.js';
import { coreOperationKey, validateCoreOperationReceipt } from './core-operation-contract.js';
import { PERSISTENCE_TRANSACTION_ACTIVE } from './transaction-context.ts';

export function createPostgresCoreOperationStore({ client, ownerId }) {
  const assertOwner = input => {
    if (input.ownerId !== ownerId) throw createAppError('CORE_OPERATION_FORBIDDEN', '操作不属于当前用户。', 403);
  };
  return createAsyncCoreOperationStore({
    transaction: operation => {
      if (client[PERSISTENCE_TRANSACTION_ACTIVE]) throw new TypeError('核心操作必须拥有最外层事务，不能嵌套提交。');
      return client.$transaction(
        async tx => {
          // 与核心笔记/同步事务共用锁；不存在回执行也必须串行，不能只锁已有行。
          await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(1266775634, 32)::text');
          return operation(tx);
        },
        { maxWait: 10000, timeout: 60000 }
      );
    },
    async get(input, tx = client) {
      assertOwner(input);
      const rows = await tx.$queryRawUnsafe(
        `SELECT owner_id, dataset_id, operation_id, plan_hash, receipt_hash, receipt_json FROM core_operation_receipts
        WHERE owner_id = $1 AND dataset_id = $2 AND operation_id = $3`,
        input.ownerId,
        input.datasetId,
        input.operationId
      );
      const row = rows[0];
      if (!row) return null;
      // JSON null 仍是已存在的 SQL 行，不能当作“未提交”并重新执行业务。
      const receipt = validateCoreOperationReceipt(row.receipt_json);
      if (
        coreOperationKey(receipt) !==
          coreOperationKey({ ownerId: row.owner_id, datasetId: row.dataset_id, operationId: row.operation_id }) ||
        receipt.planHash !== row.plan_hash ||
        receipt.receiptHash !== row.receipt_hash
      ) {
        throw createAppError('CORE_OPERATION_INVALID', '核心回执索引与内容不一致，已停止该操作。', 422);
      }
      return receipt;
    },
    async insert(receipt, tx) {
      await tx.$executeRawUnsafe(
        `INSERT INTO core_operation_receipts
        (owner_id, dataset_id, operation_id, plan_hash, receipt_hash, receipt_json)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        receipt.ownerId,
        receipt.datasetId,
        receipt.operationId,
        receipt.planHash,
        receipt.receiptHash,
        JSON.stringify(receipt)
      );
    }
  });
}
