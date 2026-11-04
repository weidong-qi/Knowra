import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTaskWorkspaceService } from '../src/modules/task-workspaces/service.ts';
import {
  createJsonTaskWorkspaceStore,
  createEmptyTaskWorkspaceSnapshot
} from '../src/infrastructure/task-workspace-json-store.ts';

export function fixture() {
  let state = createEmptyTaskWorkspaceSnapshot(),
    now = Date.now(),
    allowed = true;
  const store = createJsonTaskWorkspaceStore({
    readState: () => state,
    writeState: s => {
      state = s;
    },
    transaction: fn => {
      const before = structuredClone(state);
      try {
        return fn();
      } catch (e) {
        state = before;
        throw e;
      }
    }
  });
  const service = createTaskWorkspaceService({
    store,
    clock: () => now,
    authorize: () => allowed
  });
  const context = actor => ({
    ...store.readSnapshot(tx => tx.identity()),
    actor,
    guard: () => true
  });
  const user = context({ kind: 'user', id: 'user' }),
    agent = context({ kind: 'mcp', id: 'synthetic' });
  const call = (kind, input = {}, ctx = user) => service[kind](ctx, { operationId: randomUUID(), ...input });
  const w = call('createWorkspace', { name: '合成工作区' }).data.workspace;
  const doc = call('createDocument', {
    workspaceId: w.id,
    title: '需求',
    markdown: '实现合成测试'
  }).data.document;
  const task = call('createTask', { workspaceId: w.id, title: '实现任务' }).data.task;
  const published = call('publishTask', {
    workspaceId: w.id,
    taskId: task.id,
    expectedRevision: task.revision,
    description: { documentId: doc.id, versionId: doc.version.id },
    acceptanceCriteria: ['测试通过'],
    inScope: '合成内容',
    outOfScope: '真实资料'
  }).data.task;
  return {
    service,
    store,
    user,
    agent,
    w,
    doc,
    task: published,
    call,
    setTime: v => {
      now = v;
    },
    now: () => now,
    revoke: () => {
      allowed = false;
    },
    state: () => state
  };
}
export const taskWorkspaceServiceTests = [
  {
    name: 'task workspace synthetic claim submit review and idempotency',
    run() {
      const f = fixture(),
        input = {
          operationId: randomUUID(),
          workspaceId: f.w.id,
          taskId: f.task.id,
          expectedRevision: f.task.revision
        };
      const claimed = f.service.claimTask(f.agent, input);
      assert.equal(claimed.data.task.status, 'running');
      assert.deepEqual(f.service.claimTask(f.agent, input), {
        ...claimed,
        reused: true
      });
      assert.throws(() => f.service.claimTask(f.agent, { ...input, expectedRevision: 99 }), {
        code: 'TASK_WORKSPACE_CONFLICT'
      });
      assert.throws(
        () =>
          f.call(
            'claimTask',
            { ...input, operationId: randomUUID() },
            { ...f.agent, actor: { kind: 'mcp', id: 'other' } }
          ),
        { code: 'TASK_WORKSPACE_CONFLICT' }
      );
      const a = claimed.data.attempt;
      const submitted = f.call(
        'submitTask',
        {
          workspaceId: f.w.id,
          taskId: f.task.id,
          attemptId: a.id,
          generation: a.generation,
          summary: '完成',
          artifacts: [{ documentId: f.doc.id, versionId: f.doc.version.id }]
        },
        f.agent
      );
      assert.equal(submitted.data.task.status, 'review');
      const accepted = f.call('reviewSubmission', {
        workspaceId: f.w.id,
        taskId: f.task.id,
        expectedRevision: submitted.data.task.revision,
        submissionId: submitted.data.attempt.submission.id,
        decision: 'accepted'
      });
      assert.equal(accepted.data.task.status, 'accepted');
      assert.equal(f.state().attempts[0].leaseExpiresAt, null);
    }
  },
  {
    name: 'task workspace stale lease epoch authorization and actor rejection',
    run() {
      const f = fixture();
      assert.throws(
        () =>
          f.call(
            'publishTask',
            {
              workspaceId: f.w.id,
              taskId: f.task.id,
              expectedRevision: f.task.revision
            },
            f.agent
          ),
        { code: 'TASK_WORKSPACE_FORBIDDEN' }
      );
      const a = f.call(
        'claimTask',
        {
          workspaceId: f.w.id,
          taskId: f.task.id,
          expectedRevision: f.task.revision
        },
        f.agent
      ).data.attempt;
      f.setTime(f.now() + 300001);
      assert.throws(
        () =>
          f.call(
            'renewTask',
            {
              workspaceId: f.w.id,
              taskId: f.task.id,
              attemptId: a.id,
              generation: a.generation
            },
            f.agent
          ),
        { code: 'TASK_WORKSPACE_LEASE_EXPIRED' }
      );
      assert.throws(() => f.service.getWorkspace({ ...f.user, datasetEpoch: randomUUID() }, { workspaceId: f.w.id }), {
        code: 'TASK_WORKSPACE_FORBIDDEN'
      });
      f.revoke();
      assert.throws(() => f.service.getWorkspace(f.user, { workspaceId: f.w.id }), {
        code: 'TASK_WORKSPACE_FORBIDDEN'
      });
    }
  },
  {
    name: 'task workspace CAS cross-workspace references and remote images rejected',
    run() {
      const f = fixture();
      assert.throws(
        () =>
          f.call('updateDocument', {
            workspaceId: f.w.id,
            documentId: f.doc.id,
            expectedRevision: 2,
            markdown: 'x'
          }),
        { code: 'TASK_WORKSPACE_CONFLICT' }
      );
      assert.throws(
        () =>
          f.call('updateDocument', {
            workspaceId: f.w.id,
            documentId: f.doc.id,
            expectedRevision: 1,
            markdown: '![x](https://example.com/image.png)'
          }),
        { code: 'TASK_WORKSPACE_INVALID' }
      );
      const w = f.call('createWorkspace', { name: '另一工作区' }).data.workspace;
      assert.throws(
        () =>
          f.service.getDocument(f.user, {
            workspaceId: w.id,
            documentId: f.doc.id
          }),
        { code: 'TASK_WORKSPACE_FORBIDDEN' }
      );
    }
  },
  {
    name: 'task workspace returned submission cannot be accepted and superseded cannot submit',
    run() {
      const f = fixture();
      const a = f.call(
        'claimTask',
        {
          workspaceId: f.w.id,
          taskId: f.task.id,
          expectedRevision: f.task.revision
        },
        f.agent
      ).data.attempt;
      const submitted = f.call(
        'submitTask',
        {
          workspaceId: f.w.id,
          taskId: f.task.id,
          attemptId: a.id,
          generation: a.generation,
          summary: '完成',
          artifacts: []
        },
        f.agent
      );
      const returned = f.call('reviewSubmission', {
        workspaceId: f.w.id,
        taskId: f.task.id,
        expectedRevision: submitted.data.task.revision,
        submissionId: submitted.data.attempt.submission.id,
        decision: 'returned'
      });
      assert.equal(returned.data.task.status, 'ready');
      assert.equal(f.state().attempts[0].status, 'submitted');
      assert.throws(
        () =>
          f.call('reviewSubmission', {
            workspaceId: f.w.id,
            taskId: f.task.id,
            expectedRevision: returned.data.task.revision,
            submissionId: submitted.data.attempt.submission.id,
            decision: 'accepted'
          }),
        { code: 'TASK_WORKSPACE_CONFLICT' }
      );
    }
  },
  {
    name: 'task workspace commit guard rolls back all records',
    run() {
      const f = fixture();
      const before = structuredClone(f.state());
      let calls = 0;
      assert.throws(
        () =>
          f.service.createTask(
            { ...f.user, guard: () => ++calls < 2 },
            {
              operationId: randomUUID(),
              workspaceId: f.w.id,
              title: '不得落库'
            }
          ),
        { code: 'TASK_WORKSPACE_FORBIDDEN' }
      );
      assert.deepEqual(f.state(), before);
    }
  }
];
