import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPairingStore } from '../src/mcp/pairing-store.mjs';
import { createMcpPairingService } from '../src/mcp/pairing-service.mjs';
import { createMcpGate } from '../src/mcp/mcp-gate.mjs';
import { createTaskMcpExecutor } from '../src/mcp/task-executor.mjs';
import { taskTextResult } from '../src/mcp/task-output.mjs';

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-task-pair-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const pairings = createPairingStore({ directory });
  const identity = { datasetId: 'dataset', datasetEpoch: 'epoch-1' };
  const state = { policyCalls: 0, revokedPolicies: [], archived: false };
  let taskService = {
    getWorkspace(ctx, { workspaceId }) {
      ctx.guard();
      if (state.archived || workspaceId !== 'workspace') throw new Error('unavailable');
      return { id: workspaceId, name: '合成工作区' };
    },
    listWorkspaces() {
      return { items: [{ id: 'workspace', name: '合成工作区' }], nextCursor: null };
    }
  };
  const flags = () => ({ aiEnabled: true, allowExternal: true });
  const getTaskService = () => taskService;
  const access = {
    async createPolicy(input) {
      state.policyCalls++;
      await options.onPolicy?.({
        identity,
        state,
        replaceService() {
          taskService = { ...taskService };
        }
      });
      return { ...input, policyId: 'policy', revision: 1 };
    },
    async narrowPolicy(id) {
      state.revokedPolicies.push(id);
    },
    createRunGrant() {
      assert.fail('任务分支不得创建知识grant');
    }
  };
  const executor = createTaskMcpExecutor({
    pairings,
    getService: getTaskService,
    getIdentity: () => identity,
    assertFlags() {}
  });
  const gate = createMcpGate({
    pairings,
    getAccess: () => access,
    flags,
    taskExecutor: executor,
    audit: { append() {} },
    tools: {
      notes_read: {
        run() {
          assert.fail();
        }
      },
      knowledge_read: {
        knowledgeRead: true,
        run() {
          assert.fail();
        }
      }
    }
  });
  const service = createMcpPairingService({
    pairings,
    getAccess: () => access,
    audit: { append() {} },
    gate,
    socketPath: path.join(directory, 'runtime.sock'),
    dataDirectory: directory,
    flags,
    getTaskService,
    getTaskIdentity: () => identity
  });
  const grant = {
    workspaceId: 'workspace',
    read: true,
    writeDocuments: true,
    executeTasks: true,
    includeImages: false
  };
  const input = {
    label: '任务客户端',
    scope: { kind: 'none' },
    egressConfirmed: true,
    taskWorkspaceGrants: [grant],
    taskWorkspaceConfirmed: true
  };
  const token = pairing => JSON.parse(fs.readFileSync(pairing.pairingFile, 'utf8')).token;
  return { pairings, identity, state, service, gate, executor, input, grant, token, getTaskService };
}

test('仅任务真实配对不产生notes policy，清单不含私人工具且禁止知识权限提升', async t => {
  const f = fixture(t),
    pairing = await f.service.create(f.input),
    token = f.token(pairing);
  assert.equal(f.state.policyCalls, 0);
  assert.equal(f.pairings.get(pairing.pairingId).policyId, '');
  assert.equal(pairing.taskWorkspaceDatasetEpoch, undefined);
  assert.equal(pairing.taskWorkspaceDatasetId, undefined);
  const tools = f.gate.describeTools({ token });
  assert(tools.some(tool => tool.name === 'tasks_claim'));
  assert(!tools.some(tool => tool.name === 'notes_read' || tool.name === 'knowledge_read'));
  for (const tool of ['notes_read', 'knowledge_read'])
    await assert.rejects(f.gate.call({ token, tool, input: {} }), { code: 'MCP_SCOPE_FORBIDDEN' });
  assert.throws(
    () => f.service.setKnowledgeRead(pairing.pairingId, { allowKnowledgeRead: true, knowledgeReadConfirmed: true }),
    { code: 'MCP_SCOPE_INVALID' }
  );
  const result = await f.gate.call({ token, tool: 'task_workspaces_list' });
  assert.equal(JSON.parse(result.taskContent[0].text).items[0].id, 'workspace');
});

test('任务授权确认在创建notes policy之前校验；无工具none配对拒绝', async t => {
  const f = fixture(t);
  await assert.rejects(
    f.service.create({ ...f.input, scope: { kind: 'library' }, spaceId: 'space', taskWorkspaceConfirmed: false }),
    { code: 'MCP_TASK_EGRESS_UNCONFIRMED' }
  );
  await assert.rejects(f.service.create({ ...f.input, taskWorkspaceGrants: [] }), { code: 'MCP_SCOPE_INVALID' });
  assert.equal(f.state.policyCalls, 0);
  assert.equal(f.pairings.list().length, 0);
});

test('mixed配对createPolicy等待期间epoch/service/归档变化拒绝且撤销新policy', async t => {
  for (const mode of ['epoch', 'service', 'archived']) {
    const f = fixture(t, {
      onPolicy({ identity, state, replaceService }) {
        if (mode === 'epoch') identity.datasetEpoch = 'epoch-2';
        else if (mode === 'service') replaceService();
        else state.archived = true;
      }
    });
    await assert.rejects(f.service.create({ ...f.input, scope: { kind: 'library' }, spaceId: 'space' }), error =>
      ['MCP_TASK_ACCESS_REVOKED', 'MCP_TASK_SCOPE_INVALID'].includes(error.code)
    );
    assert.equal(f.pairings.list().length, 0);
    assert.deepEqual(f.state.revokedPolicies, ['policy']);
  }
});

test('授权绑定epoch，恢复同UUID不自动继承；明确再授权才能恢复', async t => {
  const f = fixture(t),
    pairing = await f.service.create(f.input),
    token = f.token(pairing);
  assert.equal(f.pairings.get(pairing.pairingId).taskWorkspaceDatasetEpoch, 'epoch-1');
  f.identity.datasetEpoch = 'epoch-2';
  assert.deepEqual(f.gate.describeTools({ token }), []);
  assert.equal(f.service.list()[0].taskWorkspaceReauthorizationRequired, true);
  await assert.rejects(f.gate.call({ token, tool: 'task_workspaces_list' }), { code: 'MCP_TASK_ACCESS_REVOKED' });
  const updated = f.service.setTaskWorkspaceGrants(pairing.pairingId, {
    taskWorkspaceGrants: [f.grant],
    taskWorkspaceConfirmed: true
  });
  assert.equal(updated.taskWorkspaceReauthorizationRequired, false);
  assert(f.gate.describeTools({ token }).length);
});

test('修改grants撤销在途结果，已生成结果末端复核仍拒绝', async t => {
  const f = fixture(t),
    pairing = await f.service.create(f.input),
    token = f.token(pairing);
  let finish, started;
  const entry = new Promise(resolve => {
    started = resolve;
  });
  f.getTaskService().listWorkspaces = async () => {
    started();
    return new Promise(resolve => {
      finish = () => resolve({ items: [{ id: 'workspace', name: '不应外发' }], nextCursor: null });
    });
  };
  const pending = f.gate.call({ token, tool: 'task_workspaces_list' });
  await entry;
  f.service.setTaskWorkspaceGrants(pairing.pairingId, { taskWorkspaceGrants: [] });
  finish();
  await assert.rejects(pending, { code: 'MCP_TASK_ACCESS_REVOKED' });
  assert.deepEqual(f.gate.describeTools({ token }), []);
});

test('文本预算独立且超限显式拒绝', () => {
  assert.throws(
    () =>
      taskTextResult('listWorkspaces', { items: [{ id: 'workspace', name: '大'.repeat(100000) }], nextCursor: null }),
    { code: 'MCP_RESULT_TOO_LARGE' }
  );
});

test('HTTP任务授权必须匹配展示时epoch，恢复同UUID后旧确认不能重绑', async t => {
  const { Readable } = await import('node:stream');
  const { handleMcpPairingRoute } = await import('../src/mcp/pairing-routes.mjs');
  const { parseBody } = await import('../../api/src/http/request.ts');
  const f = fixture(t);
  async function request(epoch) {
    const req = Readable.from([Buffer.from(JSON.stringify(f.input))]);
    req.method = 'POST';
    req.headers = {
      'content-type': 'application/json',
      'x-knowra-mcp-pairing': '1',
      ...(epoch ? { 'x-task-workspace-epoch': epoch } : {})
    };
    const response = {
      writeHead(status) {
        this.status = status;
      },
      end(body) {
        this.body = JSON.parse(body);
      }
    };
    await handleMcpPairingRoute({
      request: req,
      response,
      url: new URL('http://localhost/api/local-runtime/mcp/pairings'),
      mcp: { service: f.service },
      parseBody
    });
    return response;
  }
  assert.equal((await request()).status, 409);
  f.identity.datasetEpoch = 'epoch-2';
  assert.equal((await request('epoch-1')).status, 409);
  assert.equal(f.pairings.list().length, 0);
  assert.equal((await request('epoch-2')).status, 201);
});
