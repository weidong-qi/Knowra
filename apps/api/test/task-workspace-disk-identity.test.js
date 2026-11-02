import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import { createTaskWorkspaceService } from '../src/modules/task-workspaces/service.ts';

function open(file) {
  const data = createFileDataStore(file),
    store = data.taskWorkspaceStore;
  return {
    data,
    store,
    service: createTaskWorkspaceService({ store, authorize: () => true }),
    ctx: { ...store.readSnapshot(tx => tx.identity()), actor: { kind: 'user', id: 'synthetic' }, guard: () => true }
  };
}
export const taskWorkspaceDiskIdentityTests = [
  {
    name: 'task workspace second JSON instance rejects stale reads and receipt replay after restore',
    run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-workspace-disk-identity-'));
      try {
        const file = path.join(root, 'data.json');
        const a = open(file);
        const input = { operationId: randomUUID(), name: '恢复边界合成' };
        const workspace = a.service.createWorkspace(a.ctx, input).data.workspace;
        const b = open(file);
        assert.equal(b.service.getWorkspace(b.ctx, { workspaceId: workspace.id }).id, workspace.id);
        assert.equal(b.service.createWorkspace(b.ctx, input).reused, true);
        // 回执重放也会原子保存，重新打开 authoritative A，避免其本来就是过期实例。
        const current = open(file);
        current.data.importSnapshot(current.data.exportSnapshot());
        const oldRead = () => b.service.getWorkspace(b.ctx, { workspaceId: workspace.id });
        const oldReceipt = () => b.service.createWorkspace(b.ctx, input);
        for (const action of [
          oldRead,
          oldReceipt,
          () => b.service.capabilities(b.ctx),
          () => b.store.readSnapshot(tx => tx.list('receipts'))
        ]) {
          assert.throws(action, { code: 'TASK_WORKSPACE_CONFLICT' });
        }
        const restarted = open(file);
        assert.notEqual(restarted.ctx.datasetEpoch, b.ctx.datasetEpoch);
        assert.equal(restarted.service.getWorkspace(restarted.ctx, { workspaceId: workspace.id }).id, workspace.id);
        assert.equal(restarted.data.state.notes.length, 0);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'task workspace JSON snapshot rechecks disk identity before returning output',
    run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-workspace-output-identity-'));
      try {
        const file = path.join(root, 'data.json'),
          a = open(file),
          b = open(file);
        assert.throws(
          () =>
            b.store.readSnapshot(tx => {
              const cached = tx.identity();
              a.data.importSnapshot(a.data.exportSnapshot());
              return cached;
            }),
          { code: 'TASK_WORKSPACE_CONFLICT' }
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
];
