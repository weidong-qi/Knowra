import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './task-workspace-service.test.js';
import { createTaskWorkspaceService } from '../src/modules/task-workspaces/service.ts';
export const taskWorkspaceBoundaryTests = [
  {
    name: 'task workspace republish invalidates old attempt generation and submission',
    run() {
      const f = fixture();
      const first = f.call(
        'claimTask',
        {
          workspaceId: f.w.id,
          taskId: f.task.id,
          expectedRevision: f.task.revision
        },
        f.agent
      );
      const published = f.call('publishTask', {
        workspaceId: f.w.id,
        taskId: f.task.id,
        expectedRevision: first.data.task.revision,
        description: { documentId: f.doc.id, versionId: f.doc.version.id },
        acceptanceCriteria: ['新标准'],
        inScope: '新范围',
        outOfScope: ''
      });
      assert.equal(f.state().attempts[0].status, 'superseded');
      const second = f.call(
        'claimTask',
        {
          workspaceId: f.w.id,
          taskId: f.task.id,
          expectedRevision: published.data.task.revision
        },
        f.agent
      );
      assert.equal(second.data.attempt.generation, 2);
      assert.throws(
        () =>
          f.call(
            'submitTask',
            {
              workspaceId: f.w.id,
              taskId: f.task.id,
              attemptId: first.data.attempt.id,
              generation: 1,
              summary: '迟到',
              artifacts: []
            },
            f.agent
          ),
        { code: 'TASK_WORKSPACE_LEASE_EXPIRED' }
      );
      assert.throws(
        () =>
          f.call(
            'reportProgress',
            {
              workspaceId: f.w.id,
              taskId: f.task.id,
              attemptId: second.data.attempt.id,
              generation: 1,
              message: '旧代'
            },
            f.agent
          ),
        { code: 'TASK_WORKSPACE_LEASE_EXPIRED' }
      );
    }
  },
  {
    name: 'task workspace cancellation and archive block late writes and receipt replay',
    run() {
      const f = fixture();
      const input = {
        operationId: randomUUID(),
        workspaceId: f.w.id,
        taskId: f.task.id,
        expectedRevision: f.task.revision
      };
      const first = f.service.claimTask(f.agent, input);
      f.call('cancelTask', {
        workspaceId: f.w.id,
        taskId: f.task.id,
        expectedRevision: first.data.task.revision
      });
      assert.throws(
        () =>
          f.call(
            'renewTask',
            {
              workspaceId: f.w.id,
              taskId: f.task.id,
              attemptId: first.data.attempt.id,
              generation: 1
            },
            f.agent
          ),
        { code: 'TASK_WORKSPACE_LEASE_EXPIRED' }
      );
      f.call('archiveWorkspace', { workspaceId: f.w.id, expectedRevision: 1 });
      assert.throws(() => f.service.claimTask(f.agent, input), {
        code: 'TASK_WORKSPACE_CONFLICT'
      });
    }
  },
  {
    name: 'task workspace cross workspace immutable version references rejected',
    run() {
      const f = fixture();
      const w = f.call('createWorkspace', { name: '其他合成区' }).data.workspace;
      const d = f.call('createDocument', {
        workspaceId: w.id,
        title: '其他资料',
        markdown: '只属于其他区'
      }).data.document;
      assert.throws(
        () =>
          f.call('publishTask', {
            workspaceId: f.w.id,
            taskId: f.task.id,
            expectedRevision: f.task.revision,
            description: { documentId: d.id, versionId: d.version.id },
            acceptanceCriteria: ['不该使用'],
            inScope: '',
            outOfScope: ''
          }),
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
      assert.throws(
        () =>
          f.call(
            'submitTask',
            {
              workspaceId: f.w.id,
              taskId: f.task.id,
              attemptId: a.id,
              generation: 1,
              summary: '跨区资料',
              artifacts: [{ documentId: d.id, versionId: d.version.id }]
            },
            f.agent
          ),
        { code: 'TASK_WORKSPACE_FORBIDDEN' }
      );
    }
  },
  {
    name: 'task workspace cursor snapshot invalidation and surrogate-safe document pages',
    run() {
      const f = fixture();
      f.call('createDocument', {
        workspaceId: f.w.id,
        title: '二',
        markdown: '二'
      });
      const page = f.service.listDocuments(f.user, {
        workspaceId: f.w.id,
        limit: 1
      });
      assert.ok(page.nextCursor);
      f.call('updateDocument', {
        workspaceId: f.w.id,
        documentId: f.doc.id,
        expectedRevision: 1,
        title: '已更新'
      });
      assert.throws(
        () =>
          f.service.listDocuments(f.user, {
            workspaceId: f.w.id,
            limit: 1,
            cursor: page.nextCursor
          }),
        { code: 'TASK_WORKSPACE_CURSOR_INVALID' }
      );
      const markdown = 'a'.repeat(16383) + '😀z';
      const d = f.call('createDocument', {
        workspaceId: f.w.id,
        title: '分页',
        markdown
      }).data.document;
      assert.equal(d.end, 16383);
      const next = f.service.getDocument(f.user, {
        workspaceId: f.w.id,
        documentId: d.id,
        start: d.end,
        versionId: d.version.id
      });
      assert.equal(d.markdown + next.markdown, markdown);
    }
  },
  {
    name: 'task workspace async authorization fails closed and receipt cannot bypass revocation',
    run() {
      const f = fixture();
      const input = {
        operationId: randomUUID(),
        workspaceId: f.w.id,
        title: '一次写入',
        markdown: '合成'
      };
      f.service.createDocument(f.user, input);
      f.revoke();
      assert.throws(() => f.service.createDocument(f.user, input), {
        code: 'TASK_WORKSPACE_FORBIDDEN'
      });
      const bad = createTaskWorkspaceService({
        store: f.store,
        authorize: async () => true
      });
      assert.throws(() => bad.getWorkspace(f.user, { workspaceId: f.w.id }), {
        code: 'TASK_WORKSPACE_FORBIDDEN'
      });
    }
  },
  {
    name: 'task workspace restored epoch rejects old actor context and receipts',
    run() {
      const f = fixture();
      const nextEpoch = randomUUID();
      f.state().datasetEpoch = nextEpoch;
      for (const kind of ['workspaces', 'documents', 'tasks', 'attempts']) {
        for (const record of f.state()[kind]) record.datasetEpoch = nextEpoch;
      }
      assert.throws(
        () =>
          f.service.createTask(f.user, {
            operationId: randomUUID(),
            workspaceId: f.w.id,
            title: '旧页面写入'
          }),
        { code: 'TASK_WORKSPACE_FORBIDDEN' }
      );
      const restored = { ...f.user, datasetEpoch: nextEpoch };
      assert.equal(f.service.getWorkspace(restored, { workspaceId: f.w.id }).id, f.w.id);
      assert.equal(f.state().tasks.length, 1);
    }
  }
];

taskWorkspaceBoundaryTests.push({
  name: 'task workspace final persistence guard prevents authorization loss after domain callback',
  run() {
    const f = fixture();
    let authorized = true;
    const store = {
      ...f.store,
      runTransaction(callback, options) {
        return f.store.runTransaction(callback, {
          beforeCommit() {
            authorized = false;
            options.beforeCommit();
          }
        });
      }
    };
    const service = createTaskWorkspaceService({
      store,
      authorize: () => authorized
    });
    const before = structuredClone(f.state());
    assert.throws(
      () =>
        service.createTask(f.user, {
          operationId: randomUUID(),
          workspaceId: f.w.id,
          title: '提交点前撤权'
        }),
      { code: 'TASK_WORKSPACE_FORBIDDEN' }
    );
    assert.deepEqual(f.state(), before);
    assert.throws(() => f.store.runTransaction(() => {}, { beforeCommit: async () => true }), {
      code: 'TASK_WORKSPACE_FORBIDDEN'
    });
  }
});

taskWorkspaceBoundaryTests.push({
  name: 'task workspace user sees objective lease expiry without gaining execution permission',
  run() {
    const f = fixture();
    f.call(
      'claimTask',
      {
        workspaceId: f.w.id,
        taskId: f.task.id,
        expectedRevision: f.task.revision
      },
      f.agent
    );
    assert.equal(f.service.getTask(f.user, { workspaceId: f.w.id, taskId: f.task.id }).leaseExpired, false);
    f.setTime(f.now() + 300001);
    const userView = f.service.getTask(f.user, {
      workspaceId: f.w.id,
      taskId: f.task.id
    });
    assert.equal(userView.leaseExpired, true);
    assert.equal(userView.claimable, false);
    const agentView = f.service.getTask(f.agent, {
      workspaceId: f.w.id,
      taskId: f.task.id
    });
    assert.equal(agentView.leaseExpired, true);
    assert.equal(agentView.claimable, true);
  }
});

taskWorkspaceBoundaryTests.push({
  name: 'task workspace summaries show trusted current executor and bounded latest progress without extra reads',
  run() {
    const f = fixture();
    const initial = f.service.listTasks(f.user, { workspaceId: f.w.id }).items[0];
    assert.equal(initial.currentExecutor, null);
    assert.equal(initial.latestProgress, null);
    const a = f.call(
      'claimTask',
      {
        workspaceId: f.w.id,
        taskId: f.task.id,
        expectedRevision: f.task.revision
      },
      f.agent
    ).data.attempt;
    const message = 'a'.repeat(1023) + '😀' + 'b'.repeat(2000);
    f.call(
      'reportProgress',
      {
        workspaceId: f.w.id,
        taskId: f.task.id,
        attemptId: a.id,
        generation: a.generation,
        message
      },
      f.agent
    );
    const summary = f.service.listTasks(f.user, { workspaceId: f.w.id }).items[0];
    assert.deepEqual(summary.currentExecutor, {
      kind: 'mcp',
      id: 'synthetic',
      label: '客户端 syntheti'
    });
    assert.equal(summary.latestProgress.message, 'a'.repeat(1023));
    assert.equal(summary.latestProgress.updatedAt, new Date(f.now()).toISOString());
    assert.ok(!Object.hasOwn(summary, 'submission'));
    assert.ok(!Object.hasOwn(summary, 'markdown'));
    f.call(
      'releaseTask',
      {
        workspaceId: f.w.id,
        taskId: f.task.id,
        attemptId: a.id,
        generation: a.generation
      },
      f.agent
    );
    const released = f.service.listTasks(f.user, { workspaceId: f.w.id }).items[0];
    assert.equal(released.currentExecutor, null);
    assert.equal(released.latestProgress, null);
  }
});
