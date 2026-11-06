import { createHash } from 'node:crypto';
import { createAppError } from '../../api/src/errors/app-error.ts';

export const SYNC_HISTORY_FORMAT = 'knowra-sync-history';
const hash = text => createHash('sha256').update(text).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => {
  throw createAppError('SYNC_HISTORY_INVALID', '同步历史快照版本或完整性无效；原记录已保留。', 422);
};

/** 封存原始 JSON 字符串，保留键序与来源内容；绝不转换成当前业务实体。 */
export function encodeSyncHistory(payload) {
  const payloadJson = JSON.stringify(payload);
  if (!object(payload) || ['format', 'history', 'version', 'schemaVersion'].some(key => Object.hasOwn(payload, key)))
    invalid();
  return JSON.stringify({ format: SYNC_HISTORY_FORMAT, version: 1, payloadJson, payloadHash: hash(payloadJson) });
}
export function readSyncHistory(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    invalid();
  }
  if (!object(value)) invalid();
  const wrapped = Object.hasOwn(value, 'format');
  if (!wrapped && ['version', 'schemaVersion', 'history'].some(key => Object.hasOwn(value, key))) invalid();
  let raw = text;
  if (wrapped) {
    if (
      value.format !== SYNC_HISTORY_FORMAT ||
      value.version !== 1 ||
      Object.keys(value).sort().join(',') !== 'format,payloadHash,payloadJson,version' ||
      typeof value.payloadJson !== 'string' ||
      value.payloadHash !== hash(value.payloadJson)
    )
      invalid();
    raw = value.payloadJson;
    try {
      value = JSON.parse(raw);
    } catch {
      invalid();
    }
    if (!object(value) || Object.hasOwn(value, 'format')) invalid();
  }
  // 未封装的历史记录只作只读投影；不升级、不写回，也不把来源字段解释成操作权限。
  return {
    ...structuredClone(value),
    history: {
      format: SYNC_HISTORY_FORMAT,
      version: 1,
      readOnly: true,
      encoding: wrapped ? 'v1' : 'legacy-json',
      payloadHash: hash(raw)
    }
  };
}
export function assertNotHistoryOperation(operation) {
  if (object(operation) && (Object.hasOwn(operation, 'format') || Object.hasOwn(operation, 'history'))) {
    throw createAppError(
      'SYNC_HISTORY_READ_ONLY',
      '历史快照只能查看，不能重新作为同步请求发送；原记录和队列已保留。',
      422
    );
  }
}
export function validateSyncHistoryRows(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_recovery'").get()) return;
  for (const row of db.prepare('SELECT payload FROM sync_recovery').iterate()) readSyncHistory(row.payload);
}
