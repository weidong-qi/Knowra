import { createHash } from 'node:crypto';
import { createAppError } from '../../errors/app-error.ts';
import type { SyncJournal } from './journal.ts';

export interface RetiredSyncRequest {
  operationId: string;
  datasetEpoch: string;
  requestHash: string;
}
export interface SyncDeviceRetirement {
  ownerId: string;
  deviceId: string;
  successorDeviceId: string;
  recoveryId: string;
  datasetEpoch: string;
  retiredAt: string;
  requests: RetiredSyncRequest[];
  bindingHash: string;
}
export interface RetireSyncDeviceCommand {
  action: 'retire-device';
  acceptJournalUpgrade: true;
  ownerId: string;
  datasetEpoch: string;
  deviceId: string;
  successorDeviceId: string;
  recoveryId: string;
  requests: RetiredSyncRequest[];
}

const error = (code: string, message: string) => createAppError(code, message, 409);
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const identifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 200 &&
  !['__proto__', 'prototype', 'constructor'].includes(value);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requestsValid = (value: unknown): value is RetiredSyncRequest[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 2000 &&
  value.every(
    item =>
      object(item) &&
      identifier(item.operationId) &&
      identifier(item.datasetEpoch) &&
      typeof item.requestHash === 'string' &&
      /^[a-f0-9]{64}$/.test(item.requestHash) &&
      Object.keys(item).sort().join(',') === 'datasetEpoch,operationId,requestHash'
  ) &&
  new Set(value.map(item => item.operationId)).size === value.length;

function binding(command: Omit<RetireSyncDeviceCommand, 'action' | 'acceptJournalUpgrade'>) {
  return {
    ownerId: command.ownerId,
    datasetEpoch: command.datasetEpoch,
    deviceId: command.deviceId,
    successorDeviceId: command.successorDeviceId,
    recoveryId: command.recoveryId,
    requests: command.requests.map(item => ({
      operationId: item.operationId,
      datasetEpoch: item.datasetEpoch,
      requestHash: item.requestHash
    }))
  };
}

/** 版本 2 是旧服务端必拒的格式门禁；仅增加 v1 的可选字段不能形成屏障。 */
export function validateDeviceRetirements(journal: Partial<SyncJournal>): void {
  if (journal.version === 1 && journal.retiredDevices === undefined) return;
  const records = journal.retiredDevices;
  if (journal.version !== 2 || !object(records) || Object.keys(records).length === 0)
    throw error('SYNC_STORAGE_INVALID', '同步编号作废记录或同步日志版本无效，已停止加载。');
  const recoveryIds = new Set<string>();
  for (const [deviceId, value] of Object.entries(records)) {
    if (
      !object(value) ||
      ![deviceId, value.deviceId, value.ownerId, value.datasetEpoch, value.successorDeviceId, value.recoveryId].every(
        identifier
      ) ||
      value.deviceId !== deviceId ||
      value.successorDeviceId === deviceId ||
      typeof value.retiredAt !== 'string' ||
      !Number.isFinite(Date.parse(value.retiredAt)) ||
      !requestsValid(value.requests) ||
      typeof value.bindingHash !== 'string' ||
      value.bindingHash !== hash(binding(value)) ||
      recoveryIds.has(value.recoveryId as string)
    )
      throw error('SYNC_STORAGE_INVALID', '同步编号作废记录损坏，原资料已保留。');
    recoveryIds.add(value.recoveryId as string);
  }
}

export function preserveDeviceRetirements(previous: SyncJournal, next: SyncJournal): void {
  validateDeviceRetirements(previous);
  if (previous.version !== 2) return;
  next.version = 2;
  next.retiredDevices = structuredClone(previous.retiredDevices);
}

export function assertSyncDeviceNotRetired(journal: SyncJournal, deviceId: unknown): void {
  if (typeof deviceId === 'string' && Object.hasOwn(journal.retiredDevices ?? {}, deviceId))
    throw error('SYNC_DEVICE_RETIRED', '此同步编号已安全作废，不能再提交；请使用已确认的恢复记录继续。');
}

export function parseDeviceRetirement(input: unknown, ownerId: string): RetireSyncDeviceCommand {
  if (object(input) && input.action === 'retire-device' && input.acceptJournalUpgrade !== true)
    throw error(
      'SYNC_RECOVERY_FORMAT_ACCEPTANCE_REQUIRED',
      '作废编号需要同步记录格式门禁，旧版云端将不能读取；请先明确确认。'
    );
  if (
    !object(input) ||
    input.action !== 'retire-device' ||
    ![input.ownerId, input.datasetEpoch, input.deviceId, input.successorDeviceId, input.recoveryId].every(identifier) ||
    input.ownerId !== ownerId ||
    input.deviceId === input.successorDeviceId ||
    !requestsValid(input.requests)
  )
    throw error('SYNC_RECOVERY_INVALID', '恢复操作及原请求身份无效，尚未作废任何同步编号。');
  return {
    action: 'retire-device',
    acceptJournalUpgrade: true,
    ownerId,
    datasetEpoch: input.datasetEpoch as string,
    deviceId: input.deviceId as string,
    successorDeviceId: input.successorDeviceId as string,
    recoveryId: input.recoveryId as string,
    requests: [...input.requests].sort((left, right) =>
      left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0
    )
  };
}

export function retirementFor(journal: SyncJournal, deviceId: string): SyncDeviceRetirement | null {
  return Object.hasOwn(journal.retiredDevices ?? {}, deviceId) ? journal.retiredDevices![deviceId] : null;
}

/** 只能在与 v1/v2 业务提交相同的最外层写事务内调用；本函数不接触业务实体。 */
export function retireSyncDevice(journal: SyncJournal, command: RetireSyncDeviceCommand): SyncDeviceRetirement {
  validateDeviceRetirements(journal);
  const existing = retirementFor(journal, command.deviceId);
  const bindingHash = hash(binding(command));
  if (existing) {
    if (existing.bindingHash !== bindingHash)
      throw error('SYNC_RECOVERY_MISMATCH', '此旧编号已有不同的恢复记录，不能替换恢复编号或新身份。');
    return structuredClone(existing);
  }
  if (command.datasetEpoch !== journal.epoch)
    throw error('DATASET_CHANGED', '云端资料库已变化，请重新核对；尚未作废同步编号。');
  assertSyncDeviceNotRetired(journal, command.successorDeviceId);
  if (
    Object.values(journal.retiredDevices ?? {}).some(
      record => record.recoveryId === command.recoveryId || record.successorDeviceId === command.successorDeviceId
    ) ||
    (journal.deviceSequences?.[command.successorDeviceId] ?? 0) > 0 ||
    Object.keys(journal.receipts).some(key => JSON.parse(key)[0] === command.successorDeviceId)
  )
    throw error('SYNC_RECOVERY_MISMATCH', '新同步身份或恢复编号已被使用，请保留原恢复记录并核对。');
  const record: SyncDeviceRetirement = {
    ...binding(command),
    retiredAt: new Date().toISOString(),
    bindingHash
  };
  // 整条保护记录和格式门禁必须在同一次 journal 提交中生效。
  journal.retiredDevices = { ...journal.retiredDevices, [command.deviceId]: record };
  journal.version = 2;
  return structuredClone(record);
}
