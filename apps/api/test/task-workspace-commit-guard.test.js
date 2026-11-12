import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeJsonFileAtomically } from '../src/infrastructure/atomic-json-file.ts';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';
import { createTaskWorkspaceService } from '../src/modules/task-workspaces/service.ts';

export const taskWorkspaceCommitGuardTests = [
  {
    name: 'atomic JSON final synchronous guard runs after fsync and rolls back rejected or async commit',
    run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-atomic-guard-'));
      try {
        const file = path.join(root, 'data.json');
        writeJsonFileAtomically(file, { value: 'old' });
        const original = fs.readFileSync(file);
        let synced = false;
        const fileSystem = Object.create(fs);
        fileSystem.fsyncSync = fd => {
          fs.fsyncSync(fd);
          synced = true;
        };
        assert.throws(
          () =>
            writeJsonFileAtomically(
              file,
              { value: 'new' },
              {
                fileSystem,
                beforeCommit() {
                  assert.equal(synced, true);
                  throw new Error('guard-expired');
                }
              }
            ),
          /guard-expired/
        );
        assert.deepEqual(fs.readFileSync(file), original);
        assert.deepEqual(fs.readdirSync(root), ['data.json']);
        assert.throws(
          () => writeJsonFileAtomically(file, { value: 'async' }, { beforeCommit: () => Promise.resolve(true) }),
          /must be synchronous/
        );
        assert.deepEqual(fs.readFileSync(file), original);
        assert.deepEqual(fs.readdirSync(root), ['data.json']);
        assert.throws(
          () => writeJsonFileAtomically(file, { value: 'false-guard' }, { beforeCommit: () => false }),
          /guard rejected/
        );
        assert.deepEqual(fs.readFileSync(file), original);
        assert.deepEqual(fs.readdirSync(root), ['data.json']);
        writeJsonFileAtomically(file, { value: 'unguarded-compatible' });
        assert.equal(JSON.parse(fs.readFileSync(file)).value, 'unguarded-compatible');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'task workspace authorization deadline expiring during JSON fsync cannot commit records or receipts',
    run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-final-deadline-'));
      try {
        const file = path.join(root, 'data.json');
        let now = 0,
          expireDuringSync = false;
        const fileSystem = Object.create(fs);
        fileSystem.fsyncSync = fd => {
          fs.fsyncSync(fd);
          if (expireDuringSync) now = 100;
        };
        const data = createFileDataStore(file, {
          writeJson: (target, value, options) => writeJsonFileAtomically(target, value, { ...options, fileSystem })
        });
        const store = data.taskWorkspaceStore;
        const ctx = {
          ...store.readSnapshot(tx => tx.identity()),
          actor: { kind: 'user', id: 'synthetic' },
          guard: () => now < 100
        };
        const service = createTaskWorkspaceService({ store, authorize: () => true });
        const original = fs.readFileSync(file);
        assert.throws(
          () =>
            data.runTransaction(
              () => {
                data.flush();
              },
              { beforeCommit: () => false }
            ),
          { code: 'TASK_WORKSPACE_FORBIDDEN' }
        );
        assert.deepEqual(fs.readFileSync(file), original);
        assert.deepEqual(fs.readdirSync(root), ['data.json']);
        expireDuringSync = true;
        assert.throws(() => service.createWorkspace(ctx, { operationId: randomUUID(), name: '不可落库' }), {
          code: 'TASK_WORKSPACE_FORBIDDEN'
        });
        assert.deepEqual(fs.readFileSync(file), original);
        assert.equal(store.readSnapshot(tx => tx.list('workspaces')).length, 0);
        assert.equal(store.readSnapshot(tx => tx.list('receipts')).length, 0);
        assert.deepEqual(fs.readdirSync(root), ['data.json']);
        now = 0;
        expireDuringSync = false;
        assert.equal(
          service.createWorkspace(ctx, { operationId: randomUUID(), name: '成功' }).data.workspace.name,
          '成功'
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
];
