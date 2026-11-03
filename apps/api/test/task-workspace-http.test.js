import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { fixture } from './task-workspace-service.test.js';
import { handleTaskWorkspaceRoute } from '../src/modules/task-workspaces/routes.ts';
export const taskWorkspaceHttpTests = [
  {
    name: 'task workspace HTTP envelopes epoch and host actor boundary',
    async run() {
      const f = fixture();
      const server = createServer((request, response) => {
        handleTaskWorkspaceRoute({
          request,
          response,
          url: new URL(request.url, 'http://localhost'),
          service: f.service,
          context: () => f.user
        }).catch(() => {
          response.statusCode = 500;
          response.end();
        });
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const base = `http://127.0.0.1:${server.address().port}/api/task-workspaces`;
        const call = async (path, body, epoch = f.user.datasetEpoch) => {
          const r = await fetch(
            base + path,
            body === undefined
              ? {}
              : {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Task-Workspace-Epoch': epoch
                  },
                  body: JSON.stringify(body)
                }
          );
          return { status: r.status, body: await r.json() };
        };
        assert.equal((await call('/capabilities')).body.data.available, true);
        const created = await call('', {
          operationId: randomUUID(),
          name: 'HTTP合成工作区'
        });
        assert.equal(created.status, 200);
        assert.equal(created.body.data.data.workspace.name, 'HTTP合成工作区');
        assert.equal(
          (await call('', { operationId: randomUUID(), name: '旧页面' }, 'old')).body.error.code,
          'TASK_WORKSPACE_CONFLICT'
        );
        assert.equal(
          (
            await call('', {
              operationId: randomUUID(),
              name: '伪造',
              actor: { kind: 'user', id: 'other' }
            })
          ).status,
          422
        );
        assert.equal(
          (
            await call(`/${f.w.id}/tasks/${f.task.id}/claim`, {
              operationId: randomUUID(),
              expectedRevision: f.task.revision
            })
          ).status,
          422
        );
        assert.equal((await call(`/${f.w.id}/documents/${f.doc.id}?start=0`)).body.data.markdown, '实现合成测试');
      } finally {
        await new Promise(resolve => server.close(resolve));
      }
    }
  }
];
