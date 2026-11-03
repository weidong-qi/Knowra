import { randomUUID, createHash } from 'node:crypto';
import { LOCAL_DATA_COLLECTIONS } from '../../infrastructure/local-data-schema.js';
import { createAppError } from '../../errors/app-error.ts';
import { cloneJsonData } from '../../infrastructure/json-clone.ts';
import type { Note } from '../knowledge/domain/note.ts';
import type { SyncSnapshotBinding } from './protocol-contract.ts';

export interface SyncRecord {
  id: string;
  updatedAt?: string | null;
  spaceId?: string | null;
  [baselineHash]?: string;
}
export type SyncState = Record<string, SyncRecord[]>;
export interface SyncEntry {
  collection: string;
  id: string;
  revision: number | null;
  value: SyncRecord | null | undefined;
}
export interface SyncTombstone {
  collection: string;
  id: string;
  revision: number;
  eventId: string;
  deletedAt: string | null;
  previousUpdatedAt?: string | null;
  spaceId?: string | null;
}
export interface SyncReceiptResult {
  status: string;
  current?: SyncEntry;
  conflicts?: SyncEntry[];
  entries?: SyncEntry[];
  aliases?: Record<string, string>;
}
export interface SyncSnapshot extends SyncSnapshotBinding {
  expiresAt: number;
  entries?: SyncEntry[];
  entriesEncoding?: string;
  entryPageSize?: number;
  entryPages?: string[];
}
export interface SyncJournal {
  version: number;
  epoch: string;
  head: number;
  floor: number;
  revisions: Record<string, number>;
  tombstones: Record<string, SyncTombstone>;
  changes: Array<{ sequence: number; items: SyncEntry[] }>;
  receipts: Record<string, { hash: string; result: SyncReceiptResult; sequence?: number }>;
  snapshots: Record<string, SyncSnapshot>;
  deviceSequences?: Record<string, number>;
}

export const syncKey = <Id>(collection: string, id: Id) => JSON.stringify([collection, id]);
export const syncError = (code: string, message: string, status = 409) => createAppError(code, message, status);
export const requestHash = <T>(value: T) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const thenResult = <T, R>(
  value: T | PromiseLike<T>,
  callback: (value: T) => R | PromiseLike<R>
): R | PromiseLike<R> =>
  value && typeof (value as PromiseLike<T>).then === 'function'
    ? (value as PromiseLike<T>).then(callback)
    : callback(value as T);

const baselineHash = Symbol('syncBaselineHash');

// 仅保留比较摘要和删除事实所需字段；来源防降级仍保留完整记录。
export function createSyncBaseline(state: SyncState): SyncState {
  return Object.fromEntries(
    LOCAL_DATA_COLLECTIONS.map(collection => [
      collection,
      state[collection].map(item => ({
        ...(collection === 'knowledgeArtifactProvenance'
          ? structuredClone(item)
          : { id: item.id, updatedAt: item.updatedAt, spaceId: item.spaceId }),
        [baselineHash]: requestHash(item)
      }))
    ])
  );
}

// appendChanges 只替换映射项、追加/裁剪事务组，不改写已提交的组和快照内容。
export function cloneJournalForChanges(journal: SyncJournal): SyncJournal {
  return {
    ...journal,
    revisions: { ...journal.revisions },
    tombstones: { ...journal.tombstones },
    changes: [...journal.changes],
    snapshots: { ...journal.snapshots }
  };
}

export function createJournal(state: SyncState): SyncJournal {
  const revisions: Record<string, number> = {};
  for (const collection of LOCAL_DATA_COLLECTIONS)
    for (const item of state[collection] ?? []) revisions[syncKey(collection, item.id)] = 1;
  return {
    version: 1,
    epoch: randomUUID(),
    head: 0,
    floor: 0,
    revisions,
    tombstones: {},
    changes: [],
    receipts: {},
    snapshots: {}
  };
}

export function loadJournal(input: unknown, state: SyncState): SyncJournal {
  const value = input as Partial<SyncJournal> | null | undefined;
  if (value === undefined) return createJournal(state);
  if (
    !value ||
    value.version !== 1 ||
    typeof value.epoch !== 'string' ||
    !Number.isSafeInteger(value.head) ||
    !Array.isArray(value.changes) ||
    !value.revisions ||
    !value.receipts ||
    !value.snapshots
  )
    throw syncError('SYNC_STORAGE_INVALID', '同步日志格式无效，已停止加载。', 500);
  const journal = cloneJsonData(value) as SyncJournal;
  journal.tombstones ??= {};
  if (LOCAL_DATA_COLLECTIONS.every(collection => Array.isArray(state[collection]))) {
    const present = new Set(
      LOCAL_DATA_COLLECTIONS.flatMap(collection => state[collection].map(item => syncKey(collection, item.id)))
    );
    // 兼容旧日志：修订仍在而主体已消失的 ID 是历史删除事实。
    for (const [key, revision] of Object.entries(journal.revisions)) {
      if (!present.has(key) && !journal.tombstones[key]) {
        const [collection, id] = JSON.parse(key);
        journal.tombstones[key] = { collection, id, revision, eventId: `legacy:${key}`, deletedAt: null };
      }
    }
  }
  return journal;
}

// 只重建传输世代；已知的不可逆删除事实不属于可重建缓存。
export function resetJournalKeepingTombstones(input: unknown, state: SyncState): SyncJournal {
  const value = input as Partial<SyncJournal> | null | undefined;
  const validate = (key: string, tombstone: SyncTombstone) => {
    if (
      !tombstone ||
      !LOCAL_DATA_COLLECTIONS.includes(tombstone.collection) ||
      typeof tombstone.id !== 'string' ||
      key !== syncKey(tombstone.collection, tombstone.id) ||
      !Number.isSafeInteger(tombstone.revision) ||
      tombstone.revision < 1
    ) {
      throw syncError('SYNC_STORAGE_INVALID', '删除事实格式无效，已停止同步世代重建。', 500);
    }
  };
  // 旧日志缺少墓碑集合可从修订补出；显式损坏的删除事实不能静默重释。
  if (value?.tombstones !== undefined) {
    if (!value.tombstones || typeof value.tombstones !== 'object' || Array.isArray(value.tombstones)) {
      throw syncError('SYNC_STORAGE_INVALID', '删除事实格式无效，已停止同步世代重建。', 500);
    }
    for (const [key, tombstone] of Object.entries(value.tombstones)) validate(key, tombstone);
  }
  const previous = loadJournal(value, state);
  const next: SyncJournal = { ...createJournal(state), deviceSequences: {} };
  const present = new Set(
    LOCAL_DATA_COLLECTIONS.flatMap(collection => (state[collection] ?? []).map(item => syncKey(collection, item.id)))
  );
  for (const [key, tombstone] of Object.entries(previous.tombstones)) {
    validate(key, tombstone);
    if (present.has(key)) {
      throw syncError('SYNC_RESET_DELETED_ID_PRESENT', '恢复数据包含已知永久删除的对象，请先核对并处置删除事实。');
    }
    next.tombstones[key] = structuredClone(tombstone);
    next.revisions[key] = tombstone.revision;
  }
  return next;
}

export function appendChanges(journal: SyncJournal, before: SyncState, after: SyncState): SyncJournal {
  const items: SyncEntry[] = [];
  for (const collection of LOCAL_DATA_COLLECTIONS) {
    const old = new Map((before[collection] ?? []).map(item => [item.id, item]));
    const next = new Map((after[collection] ?? []).map(item => [item.id, item]));
    for (const id of new Set([...old.keys(), ...next.keys()])) {
      const value = next.get(id) ?? null;
      const previous = old.get(id) ?? null;
      if (
        previous?.[baselineHash] !== undefined
          ? value !== null && previous[baselineHash] === requestHash(value)
          : JSON.stringify(previous) === JSON.stringify(value)
      )
        continue;
      const key = syncKey(collection, id);
      const revision = (journal.revisions[key] ?? 0) + 1;
      journal.revisions[key] = revision;
      if (old.has(id) && !next.has(id)) {
        journal.tombstones ??= {};
        journal.tombstones[key] = {
          collection,
          id,
          revision,
          eventId: randomUUID(),
          deletedAt: new Date().toISOString(),
          previousUpdatedAt: old.get(id)?.updatedAt ?? null,
          spaceId: old.get(id)?.spaceId ?? null
        };
      }
      items.push({ collection, id, revision, value: cloneJsonData(value) });
    }
  }
  if (items.length) journal.changes.push({ sequence: ++journal.head, items });
  // 只裁剪已完整提交的事务组；落后设备通过固定快照重新建立基线。
  const keep = 512;
  if (journal.changes.length > keep) {
    const removed = journal.changes.splice(0, journal.changes.length - keep);
    journal.floor = removed.at(-1)!.sequence;
  }
  let bytes = journal.changes.reduce((sum, group) => sum + Buffer.byteLength(JSON.stringify(group)), 0);
  while (journal.changes.length > 1 && bytes > 16 * 1024 * 1024) {
    const removed = journal.changes.shift()!;
    bytes -= Buffer.byteLength(JSON.stringify(removed));
    journal.floor = removed.sequence;
  }
  for (const [id, snapshot] of Object.entries(journal.snapshots))
    if (snapshot.expiresAt < Date.now()) delete journal.snapshots[id];
  return journal;
}

export function entriesFor(state: SyncState, journal: SyncJournal): SyncEntry[] {
  const current = new Map<string, SyncRecord>();
  for (const collection of LOCAL_DATA_COLLECTIONS)
    for (const item of state[collection] ?? []) current.set(syncKey(collection, item.id), item);
  return Object.entries(journal.revisions).map(([key, revision]) => {
    const [collection, id] = JSON.parse(key);
    return { collection, id, revision, value: structuredClone(current.get(key) ?? null) };
  });
}

export function cursorFor(journal: SyncJournal, ownerId: string, sequence = journal.head) {
  return Buffer.from(JSON.stringify({ epoch: journal.epoch, ownerId, sequence })).toString('base64url');
}

export function readCursor(token: unknown, journal: SyncJournal, ownerId: string): number {
  let cursor: { epoch: string; ownerId: string; sequence: number };
  try {
    cursor = JSON.parse(Buffer.from(String(token), 'base64url').toString());
  } catch {
    throw syncError('CURSOR_INVALID', '同步游标无效。', 422);
  }
  if (cursor.ownerId !== ownerId) throw syncError('CURSOR_INVALID', '同步游标不属于当前资料库。', 422);
  if (cursor.epoch !== journal.epoch) throw syncError('DATASET_CHANGED', '云端资料库已恢复或重建，需要重新核对基线。');
  if (!Number.isSafeInteger(cursor.sequence) || cursor.sequence < 0 || cursor.sequence > journal.head)
    throw syncError('CURSOR_INVALID', '同步游标超出有效范围。', 422);
  if (cursor.sequence < journal.floor) throw syncError('CURSOR_EXPIRED', '同步游标已过期，需要重新下载基线。');
  return cursor.sequence;
}

export const NOTE_FIELDS: string[] = [
  'title',
  'rawMarkdown',
  'annotationStructure',
  'spaceId',
  'folderId',
  'tagIds',
  'favorite',
  'status',
  'sourceType',
  'deleted',
  'aiVisibility'
];
export type SyncNoteContent = Partial<
  Pick<
    Note,
    | 'title'
    | 'rawMarkdown'
    | 'annotationStructure'
    | 'spaceId'
    | 'folderId'
    | 'tagIds'
    | 'favorite'
    | 'status'
    | 'sourceType'
    | 'deleted'
    | 'aiVisibility'
  >
>;
export function noteContent(note: SyncNoteContent | null | undefined) {
  if (!note) return null;
  return Object.fromEntries(
    NOTE_FIELDS.map(key => [
      key,
      key === 'tagIds'
        ? [...(note.tagIds ?? [])].sort()
        : key === 'aiVisibility'
          ? (note.aiVisibility ?? 'normal')
          : key === 'folderId'
            ? (note.folderId ?? null)
            : key === 'favorite' || key === 'deleted'
              ? Boolean(note[key])
              : (note[key as keyof SyncNoteContent] ?? null)
    ])
  );
}

export function rememberBatchReceipt(
  journal: SyncJournal,
  key: string,
  hash: string,
  result: SyncReceiptResult,
  operation: { deviceId: string; sequence: number }
): void {
  journal.deviceSequences ??= {};
  journal.deviceSequences[operation.deviceId] = Math.max(
    journal.deviceSequences[operation.deviceId] ?? 0,
    operation.sequence
  );
  journal.receipts[key] = { hash, result, sequence: operation.sequence };
  const receipts = Object.entries(journal.receipts).filter(([, receipt]) => receipt.sequence !== undefined);
  let bytes = receipts.reduce((sum, [, receipt]) => sum + Buffer.byteLength(JSON.stringify(receipt)), 0);
  while (receipts.length > 1 && (receipts.length > 512 || bytes > 16 * 1024 * 1024)) {
    const [oldKey, receipt] = receipts.shift()!;
    bytes -= Buffer.byteLength(JSON.stringify(receipt));
    delete journal.receipts[oldKey];
  }
}
