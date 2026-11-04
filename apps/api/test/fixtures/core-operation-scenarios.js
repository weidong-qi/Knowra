import assert from 'node:assert/strict';
import { calculateContentHash } from '../../src/modules/knowledge/domain/note-version.ts';

export const request = spaceId => ({
  ownerId: 'test',
  actorId: 'test',
  datasetId: 'dataset-fixed',
  datasetEpoch: 'epoch-fixed',
  spaceId,
  requestId: 'explicit-user-request',
  operationId: 'operation-fixed',
  kind: 'notes_create',
  planHash: 'a'.repeat(64)
});
export const lookup = input =>
  Object.fromEntries(['ownerId', 'datasetId', 'operationId'].map(key => [key, input[key]]));
export function resultFor(store, note, before = null) {
  const version = store.state.noteVersions.find(
    version => version.noteId === note.id && version.contentHash === calculateContentHash(note.rawMarkdown)
  );
  assert(version, '真实领域写入必须创建版本');
  return {
    saveState: 'localCommitted',
    changes: [
      {
        noteId: note.id,
        beforeVersionId: before?.id ?? null,
        afterVersionId: version.id,
        contentHash: version.contentHash,
        metadataBefore: null
      }
    ]
  };
}

export function coreOperationScenarios(withFixture) {
  return [
    {
      name: '核心回执与新笔记/版本/同步事务共同提交，丢失响应和重启不会重复写入',
      run() {
        withFixture(f => {
          const input = request(f.space.id);
          const receipt = f.store.coreOperationStore.commit(input, () =>
            resultFor(
              f.store,
              f.api.createNote({
                id: 'note-fixed',
                title: '唯一业务结果',
                rawMarkdown: '合成正文',
                spaceId: f.space.id
              })
            )
          );
          assert.equal(receipt.status, 'applied');
          assert.equal(receipt.result.saveState, 'localCommitted');
          assert(f.journal().includes('note-fixed'));
          assert.equal(f.store.state.noteVersions.length, 1);
          const before = f.journal();
          const again = f.store.coreOperationStore.commit(input, () => {
            throw new Error('重复请求不应再执行');
          });
          assert.deepEqual(again, receipt);
          assert.equal(f.journal(), before);
          again.result.changes[0].noteId = 'caller-mutation';
          assert.deepEqual(f.store.coreOperationStore.get(lookup(input)), receipt);
          f.restart();
          assert.deepEqual(
            f.store.coreOperationStore.commit(input, () => {
              throw new Error('重启不能重建');
            }),
            receipt
          );
          assert.equal(f.store.state.notes.length, 1);
          assert.equal(f.store.state.noteVersions.length, 1);
          for (const field of ['planHash', 'datasetEpoch', 'actorId', 'spaceId', 'requestId', 'kind']) {
            const value = field === 'planHash' ? 'b'.repeat(64) : field === 'kind' ? 'notes_append' : 'changed';
            assert.throws(() => f.store.coreOperationStore.commit({ ...input, [field]: value }, () => {}), {
              code: 'CORE_OPERATION_CONFLICT'
            });
          }
          assert.equal(f.store.coreOperationStore.get({ ...lookup(input), ownerId: 'other' }), null);
          assert.equal(f.store.coreOperationStore.get({ ...lookup(input), datasetId: 'other' }), null);
        });
      }
    },
    {
      name: '回执结构/磁盘提交失败共同回滚正文、版本、同步与回执，安全重试仍只创建一次',
      run() {
        withFixture(f => {
          const input = request(f.space.id),
            before = f.snapshot();
          const apply = () =>
            resultFor(
              f.store,
              f.api.createNote({ id: 'note-fixed', title: '回滚测试', rawMarkdown: '合成', spaceId: f.space.id })
            );
          assert.throws(
            () => f.store.coreOperationStore.commit(input, () => ({ ...apply(), rawMarkdown: '不允许进入最小回执' })),
            { code: 'CORE_OPERATION_INVALID' }
          );
          assert.deepEqual(f.snapshot(), before);
          assert.equal(f.store.coreOperationStore.get(lookup(input)), null);
          f.failNext();
          assert.throws(() => f.store.coreOperationStore.commit(input, apply));
          assert.deepEqual(f.snapshot(), before);
          assert.equal(f.store.coreOperationStore.get(lookup(input)), null);
          f.restart();
          assert.equal(f.store.coreOperationStore.get(lookup(input)), null);
          const receipt = f.store.coreOperationStore.commit(input, apply);
          assert.equal(receipt.result.changes.length, 1);
          assert.equal(f.store.state.notes.length, 1);
        });
      }
    },
    {
      name: '核心批次后项领域冲突不会遗留先项或回执，禁止同步事务递归/异步提交',
      run() {
        withFixture(f => {
          const input = request(f.space.id),
            before = f.snapshot();
          assert.throws(
            () =>
              f.store.coreOperationStore.commit(input, () => {
                f.api.createNote({ id: 'first', title: '相同兄弟名', rawMarkdown: '1', spaceId: f.space.id });
                f.api.createNote({ id: 'second', title: '相同兄弟名', rawMarkdown: '2', spaceId: f.space.id });
              }),
            { code: 'SIBLING_NAME_CONFLICT' }
          );
          assert.deepEqual(f.snapshot(), before);
          assert.throws(
            () => f.store.coreOperationStore.commit(input, () => f.store.coreOperationStore.commit(input, () => {})),
            /递归/
          );
          assert.throws(() => f.store.coreOperationStore.commit(input, () => Promise.resolve({})), /异步/);
          assert.deepEqual(f.snapshot(), before);
        });
      }
    },
    {
      name: '捕获不同键嵌套提交失败不会保存无回执业务，外层业务事务也不能包裹核心提交',
      run() {
        withFixture(f => {
          const input = request(f.space.id);
          let innerRan = false;
          const inner = () => {
            innerRan = true;
            return resultFor(
              f.store,
              f.api.createNote({ id: 'unreceipted', title: '不能保存', rawMarkdown: '', spaceId: f.space.id })
            );
          };
          const receipt = f.store.coreOperationStore.commit(input, () => {
            assert.throws(
              () => f.store.coreOperationStore.commit({ ...input, operationId: 'inner-op' }, inner),
              /嵌套/
            );
            return resultFor(
              f.store,
              f.api.createNote({ id: 'outer-only', title: '外层有效', rawMarkdown: '', spaceId: f.space.id })
            );
          });
          assert.equal(innerRan, false);
          assert.equal(receipt.result.changes[0].noteId, 'outer-only');
          assert.equal(f.store.state.notes.length, 1);
          assert.equal(f.store.state.noteVersions.length, 1);
          f.store.runTransaction(() => {
            assert.throws(
              () => f.store.coreOperationStore.commit({ ...input, operationId: 'nested-in-business' }, inner),
              /最外层/
            );
          });
          assert.equal(innerRan, false);
          f.restart();
          assert.equal(f.store.state.notes.length, 1);
          assert.equal(f.store.coreOperationStore.get(lookup({ ...input, operationId: 'inner-op' })), null);
        });
      }
    },
    {
      name: 'AI 私有故障不会抹除核心回执，业务导入保留操作身份并使旧 epoch 失效',
      run() {
        withFixture(f => {
          const input = request(f.space.id);
          const receipt = f.store.coreOperationStore.commit(input, () =>
            resultFor(
              f.store,
              f.api.createNote({ id: 'note-fixed', title: '保留核心回执', rawMarkdown: '合成', spaceId: f.space.id })
            )
          );
          const snapshot = f.store.exportSnapshot();
          assert.equal(JSON.stringify(snapshot).includes('operation-fixed'), false);
          const oldEpoch = f.store.aiRepository.identity().datasetEpoch;
          f.store.importSnapshot(snapshot);
          assert.notEqual(f.store.aiRepository.identity().datasetEpoch, oldEpoch);
          assert.deepEqual(f.store.coreOperationStore.get(lookup(input)), receipt);
          f.corruptAi();
          f.restart();
          assert(f.store.aiRuntimeError);
          assert.deepEqual(f.store.coreOperationStore.get(lookup(input)), receipt);
          f.api.createNote({
            id: 'manual-after-ai-fault',
            title: '核心仍可编辑',
            rawMarkdown: '',
            spaceId: f.space.id
          });
          f.restart();
          assert.deepEqual(f.store.coreOperationStore.get(lookup(input)), receipt);
          assert(f.store.state.notes.some(note => note.id === 'manual-after-ai-fault'));
        });
      }
    }
  ];
}
