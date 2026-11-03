import {
  assertSyncContract,
  assertSnapshotBinding,
  snapshotBinding,
  syncContract,
  REQUIRED_SYNC_CAPABILITIES
} from './protocol-contract.ts';
import { assertSyncDeviceEnabled } from './rollout-policy.ts';
import { randomUUID } from 'node:crypto';
import {
  cursorFor,
  readCursor,
  entriesFor,
  syncKey,
  syncError,
  requestHash,
  thenResult,
  NOTE_FIELDS
} from './journal.ts';

export function createSyncService(provider, ownerId) {
  const describe = journal => ({
    protocolVersion: 1,
    ...syncContract(),
    requiredCapabilities: [...REQUIRED_SYNC_CAPABILITIES],
    datasetEpoch: journal.epoch,
    ownerId,
    scope: 'notes',
    pushEnabled: process.env.KNOWRA_SYNC_PUSH_ENABLED !== 'false',
    cursor: cursorFor(journal, ownerId)
  });
  return {
    device: ({ deviceId }) =>
      provider.read((_state, journal) => ({ sequence: journal.deviceSequences?.[String(deviceId)] ?? 0 })),
    status: () => provider.read((_state, journal) => describe(journal)),
    bootstrap: input => {
      const contract = assertSyncContract(input);
      return (provider.mutateJournal ?? provider.mutate)((state, journal) => {
        for (const [id, snapshot] of Object.entries(journal.snapshots))
          if (snapshot.expiresAt < Date.now()) delete journal.snapshots[id];
        if (Object.keys(journal.snapshots).length >= 8)
          throw syncError('SYNC_BUSY', '快照数量已达上限，请稍后重试。', 429);
        const id = randomUUID();
        const contents = provider.snapshotEntries
          ? provider.snapshotEntries(state, journal)
          : (() => {
              const entries = entriesFor(state, journal);
              return { entries, count: entries.length };
            })();
        journal.snapshots[id] = {
          ...contract,
          snapshotId: id,
          ownerId,
          datasetEpoch: journal.epoch,
          ...contents,
          cursor: cursorFor(journal, ownerId),
          expiresAt: Date.now() + 24 * 60 * 60 * 1000
        };
        return { ...describe(journal), ...snapshotBinding(journal.snapshots[id]) };
      });
    },
    releaseSnapshot: ({ snapshotId }) =>
      (provider.mutateJournal ?? provider.mutate)((_state, journal) => {
        delete journal.snapshots[snapshotId];
        return { released: true };
      }),
    snapshot: input => {
      const contract = assertSyncContract(input, { query: true });
      const { snapshotId, offset = 0, limit = 200 } = input;
      const start = Number(offset);
      const size = pageSize(limit);
      if (!Number.isSafeInteger(start) || start < 0) throw syncError('CURSOR_INVALID', '快照分页无效。', 422);
      if (provider.snapshotPage) return provider.snapshotPage({ snapshotId, start, size, contract, ownerId });
      return provider.read((_state, journal) => {
        const snapshot = journal.snapshots[snapshotId];
        if (!snapshot || snapshot.expiresAt < Date.now()) throw syncError('CURSOR_EXPIRED', '初始化快照已过期。');
        assertSnapshotBinding(snapshot, contract, ownerId, journal.epoch);
        if (
          snapshot.snapshotId !== snapshotId ||
          (snapshot.entriesEncoding
            ? !provider.readSnapshotEntries
            : !Array.isArray(snapshot.entries) || snapshot.count !== snapshot.entries.length)
        )
          throw syncError('SYNC_SNAPSHOT_CONTRACT_MISMATCH', '快照绑定或实体数量不一致。', 409);
        const start = Number(offset);
        if (!Number.isSafeInteger(start) || start < 0 || start > snapshot.count)
          throw syncError('CURSOR_INVALID', '快照分页无效。', 422);
        const end = Math.min(snapshot.count, start + pageSize(limit));
        const entries = snapshot.entriesEncoding
          ? provider.readSnapshotEntries(snapshot, start, end)
          : snapshot.entries.slice(start, end);
        return { ...snapshotBinding(snapshot), entries, nextOffset: end < snapshot.count ? end : null };
      });
    },
    changes: input => {
      const contract = assertSyncContract(input, { query: true });
      const { cursor, limit = 50 } = input;
      return provider.read((_state, journal) => {
        const sequence = readCursor(cursor, journal, ownerId);
        const groups = journal.changes.filter(group => group.sequence > sequence).slice(0, pageSize(limit));
        const end = groups.at(-1)?.sequence ?? sequence;
        return {
          ...contract,
          ownerId,
          groups,
          cursor: cursorFor(journal, ownerId, end),
          hasMore: end < journal.head,
          datasetEpoch: journal.epoch
        };
      });
    },
    operationReceipt: input => {
      assertSyncContract(input, { query: true });
      if (
        ![input.deviceId, input.operationId].every(
          value => typeof value === 'string' && value.length > 0 && value.length <= 200
        ) ||
        !/^[a-f0-9]{64}$/.test(input.requestHash ?? '')
      )
        throw syncError('SYNC_OPERATION_INVALID', '操作回执查询无效。', 422);
      return provider.read((_state, journal) => {
        if (input.datasetEpoch !== journal.epoch) throw syncError('DATASET_CHANGED', '云端资料库已变化。');
        const saved = journal.receipts[JSON.stringify([input.deviceId, input.operationId])];
        if (saved && saved.hash !== input.requestHash)
          throw syncError('OPERATION_REUSED', '同一操作 ID 的内容不能改变。', 422);
        return {
          ...syncContract(),
          datasetEpoch: journal.epoch,
          status: saved ? 'found' : 'missing',
          lastSequence: journal.deviceSequences?.[input.deviceId] ?? 0,
          ...(saved ? { result: structuredClone(saved.result) } : {})
        };
      });
    },
    push: operation => {
      assertSyncContract(operation);
      return provider.mutate((state, journal) => {
        validateOperation(operation);
        if (operation.datasetEpoch !== journal.epoch) throw syncError('DATASET_CHANGED', '云端资料库基线已变化。');
        const key = JSON.stringify([operation.deviceId, operation.operationId]);
        const hash = requestHash(operation);
        const receipt = journal.receipts[key];
        if (receipt) {
          if (receipt.hash !== hash) throw syncError('OPERATION_REUSED', '同一操作 ID 的内容不能改变。', 422);
          return receipt.result;
        }
        assertSyncDeviceEnabled(operation.deviceId);
        const entityKey = syncKey('notes', operation.noteId);
        const revision = journal.revisions[entityKey] ?? null;
        const current = state.notes.find(note => note.id === operation.noteId) ?? null;
        if (revision !== operation.baseRevision) {
          const result = {
            status: 'conflict',
            current: { collection: 'notes', id: operation.noteId, revision, value: structuredClone(current) }
          };
          journal.receipts[key] = { hash, result };
          return result;
        }
        if (!current && revision !== null) throw syncError('NOTE_DELETED', '笔记已永久删除，请保留为新副本。');
        const value = operation.value;
        if (!value.spaceId || !state.spaces.some(space => space.id === value.spaceId && space.userId === ownerId))
          throw syncError('DEPENDENCY_MISSING', '目标空间不存在。');
        if (
          (value.folderId &&
            !state.folders.some(folder => folder.id === value.folderId && folder.spaceId === value.spaceId)) ||
          value.tagIds.some(id => !state.tags.some(tag => tag.id === id && tag.spaceId === value.spaceId))
        )
          throw syncError('DEPENDENCY_MISSING', '目录或标签尚未同步，请调整笔记归属后重试。');
        return thenResult(provider.applyNote(operation, current), () =>
          thenResult(provider.preview(), ({ state: next, journal: preview }) => {
            const result = {
              status: 'accepted',
              current: {
                collection: 'notes',
                id: operation.noteId,
                revision: preview.revisions[entityKey],
                value: structuredClone(next.notes.find(note => note.id === operation.noteId))
              }
            };
            journal.receipts[key] = { hash, result };
            return result;
          })
        );
      });
    }
  };
}

function pageSize(value) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 1 || size > 500)
    throw syncError('SYNC_LIMIT_INVALID', '同步分页大小无效。', 422);
  return size;
}

function validateOperation(op) {
  if (!op || op.protocolVersion !== 1) throw syncError('PROTOCOL_UNSUPPORTED', '请升级同步客户端。', 422);
  if (
    ![op.deviceId, op.operationId, op.noteId, op.datasetEpoch].every(
      value => typeof value === 'string' && value.length > 0 && value.length <= 200
    )
  )
    throw syncError('SYNC_OPERATION_INVALID', '操作标识无效。', 422);
  if (op.baseRevision !== null && (!Number.isSafeInteger(op.baseRevision) || op.baseRevision < 1))
    throw syncError('SYNC_OPERATION_INVALID', '基线修订无效。', 422);
  if (
    !op.value ||
    typeof op.value.title !== 'string' ||
    typeof op.value.rawMarkdown !== 'string' ||
    typeof op.value.deleted !== 'boolean' ||
    !Array.isArray(op.value.tagIds) ||
    (op.value.aiVisibility !== undefined && !['normal', 'private'].includes(op.value.aiVisibility)) ||
    Object.keys(op.value).some(key => !NOTE_FIELDS.includes(key))
  )
    throw syncError('SYNC_OPERATION_INVALID', '笔记同步内容无效。', 422);
}
