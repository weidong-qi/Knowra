import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmptyLocalState } from '../../api/src/infrastructure/local-data-schema.js';
import { createSyncService } from '../../api/src/modules/sync/service.js';
import { createBatchSyncService } from '../../api/src/modules/sync/batch-service.js';
import { createJournal, requestHash } from '../../api/src/modules/sync/journal.ts';
import { assertSyncContract, syncContract } from '../../api/src/modules/sync/protocol-contract.ts';
import { sameEntity } from '../../api/src/modules/sync/entity-contract.ts';
import { Note } from '../../api/src/modules/knowledge/domain/note.js';
import { reorderJsonObjectKeys } from './fixtures/sync-json-order.mjs';

test('笔记实体比较忽略嵌套JSON对象键序，仍区分字段值和数组顺序且不改原请求hash', () => {
  const local = new Note({ id: 'json-order-note', title: '合成资料', rawMarkdown: '## 标题\n\n第一段。\n\n第二段。' });
  const remote = reorderJsonObjectKeys(local);
  assert.deepEqual(remote, { ...local });
  assert.notDeepEqual(Object.keys(remote.annotationStructure), Object.keys(local.annotationStructure));
  assert.notDeepEqual(
    Object.keys(remote.annotationStructure.nodes[0]),
    Object.keys(local.annotationStructure.nodes[0])
  );
  const before = structuredClone(local),
    hash = requestHash(local);
  assert.equal(sameEntity('notes', local, remote), true);
  for (const change of [
    value => {
      value.title += '变化';
    },
    value => {
      value.rawMarkdown += '变化';
    },
    value => {
      value.annotationStructure.nodes[0].sourceEnd++;
    },
    value => {
      value.annotationStructure.nodes.reverse();
    }
  ]) {
    const different = structuredClone(remote);
    change(different);
    assert.equal(sameEntity('notes', local, different), false);
  }
  assert.deepEqual({ ...local }, before);
  assert.equal(requestHash(local), hash);
  assert.notEqual(requestHash(remote), hash, '实体语义比较不能重写冻结传输请求的哈希规则');
});

function fixture() {
  const state = createEmptyLocalState(),
    journal = createJournal(state);
  let mutations = 0;
  const provider = {
    read: callback => callback(state, journal),
    mutate: callback => {
      mutations++;
      return callback(state, journal);
    }
  };
  return {
    state,
    journal,
    provider,
    service: { ...createSyncService(provider, 'demo'), ...createBatchSyncService(provider, 'demo') },
    mutations: () => mutations
  };
}

test('schema8拒绝缺失/旧/未来/伪造协商，所有数据入口在修改日志前停止', async () => {
  const f = fixture();
  for (const input of [
    {},
    { entitySchemaVersion: 6, capabilities: [] },
    {
      ...syncContract(),
      capabilities: syncContract().capabilities.filter(value => value !== 'knowledge-lifecycle-v1')
    },
    {
      ...syncContract(),
      capabilities: syncContract().capabilities.filter(value => value !== 'knowledge-provenance-agent-v1')
    },
    {
      ...syncContract(),
      capabilities: syncContract().capabilities.filter(value => value !== 'knowledge-provenance-mcp-v1')
    },
    { ...syncContract(), capabilities: syncContract().capabilities.filter(value => value !== 'inline-annotations-v1') },
    { ...syncContract(), entitySchemaVersion: 9 },
    { ...syncContract(), capabilities: [...syncContract().capabilities, 'unknown-v1'] }
  ]) {
    assert.throws(() => f.service.bootstrap(input), { code: 'SYNC_CLIENT_UPGRADE_REQUIRED' });
    assert.throws(() => f.service.changes({ ...input, cursor: 'old' }), { code: 'SYNC_CLIENT_UPGRADE_REQUIRED' });
    assert.throws(() => f.service.snapshot({ ...input, snapshotId: 'old' }), { code: 'SYNC_CLIENT_UPGRADE_REQUIRED' });
    assert.throws(() => f.service.push({ ...input, protocolVersion: 1 }), { code: 'SYNC_CLIENT_UPGRADE_REQUIRED' });
    assert.throws(() => f.service.uploadBlob(input), { code: 'SYNC_CLIENT_UPGRADE_REQUIRED' });
    await assert.rejects(f.service.pushBatch({ ...input, protocolVersion: 2 }), {
      code: 'SYNC_CLIENT_UPGRADE_REQUIRED'
    });
  }
  assert.equal(f.mutations(), 0);
  assert.deepEqual(f.journal.snapshots, {});
  assert.deepEqual(f.journal.receipts, {});
});

test('schema8快照绑定owner/epoch/schema/capabilities/cursor/count且不接受旧快照', () => {
  const f = fixture(),
    contract = syncContract();
  const start = f.service.bootstrap(contract);
  assert.equal(start.entitySchemaVersion, 8);
  const page = f.service.snapshot({ ...contract, snapshotId: start.snapshotId });
  for (const key of [
    'snapshotId',
    'ownerId',
    'datasetEpoch',
    'entitySchemaVersion',
    'capabilities',
    'cursor',
    'count'
  ]) {
    assert.deepEqual(page[key], start[key]);
  }
  assert.deepEqual(page.entries, []);
  assert.equal(page.nextOffset, null);
  const original = structuredClone(f.journal.snapshots[start.snapshotId]);
  for (const change of [
    { ownerId: 'elsewhere' },
    { datasetEpoch: 'old' },
    { entitySchemaVersion: 6 },
    { capabilities: ['atomic-entities-v2'] },
    { count: undefined }
  ]) {
    f.journal.snapshots[start.snapshotId] = { ...original, ...change };
    assert.throws(() => f.service.snapshot({ ...contract, snapshotId: start.snapshotId }), {
      code: 'SYNC_SNAPSHOT_CONTRACT_MISMATCH'
    });
  }
  f.journal.snapshots[start.snapshotId] = { entries: [], cursor: start.cursor, expiresAt: Date.now() + 1000 };
  assert.throws(() => f.service.snapshot({ ...contract, snapshotId: start.snapshotId }), {
    code: 'SYNC_SNAPSHOT_CONTRACT_MISMATCH'
  });
});

test('优化snapshot provider只能在协商通过后调用且收到完整绑定条件', () => {
  const f = fixture();
  let received = null;
  f.provider.snapshotPage = input => {
    received = input;
    return 'optimized';
  };
  const service = createSyncService(f.provider, 'demo');
  assert.throws(() => service.snapshot({ snapshotId: 'snapshot' }), { code: 'SYNC_CLIENT_UPGRADE_REQUIRED' });
  assert.equal(received, null);
  assert.equal(service.snapshot({ ...syncContract(), snapshotId: 'snapshot' }), 'optimized');
  assert.deepEqual(received.contract, syncContract());
  assert.equal(received.ownerId, 'demo');
});

test('升级前冻结请求只读核回执，不能改requestHash或借查询重新提交', () => {
  const f = fixture(),
    old = { protocolVersion: 2, deviceId: 'old-device', operationId: 'old-op', sequence: 1 };
  const hash = requestHash(old),
    result = { status: 'accepted', entries: [] };
  f.journal.receipts[JSON.stringify([old.deviceId, old.operationId])] = { hash, result };
  const input = {
    ...syncContract(),
    deviceId: old.deviceId,
    operationId: old.operationId,
    requestHash: hash,
    datasetEpoch: f.journal.epoch
  };
  assert.deepEqual(f.service.operationReceipt(input).result, result);
  assert.equal(f.service.operationReceipt({ ...input, operationId: 'missing' }).status, 'missing');
  assert.throws(() => f.service.operationReceipt({ ...input, requestHash: '0'.repeat(64) }), {
    code: 'OPERATION_REUSED'
  });
  assert.throws(() => f.service.operationReceipt({ ...input, datasetEpoch: 'old' }), { code: 'DATASET_CHANGED' });
  assert.equal(f.mutations(), 0);
  assert.equal(
    assertSyncContract(
      { entitySchemaVersion: '8', capabilities: syncContract().capabilities.join(',') },
      { query: true }
    ).entitySchemaVersion,
    8
  );
});
