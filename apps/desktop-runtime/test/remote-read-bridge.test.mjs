import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createTaskWorkspaceService } from '../../api/src/modules/task-workspaces/service.ts';
import { createSqliteTaskWorkspaceStore } from '../src/task-workspaces/sqlite-store.mjs';
import { createTaskWorkspaceFiles } from '../src/task-workspaces/files.mjs';
import { authorizeTaskMcpContext } from '../src/mcp/task-access.mjs';
import { createTaskMcpExecutor } from '../src/mcp/task-executor.mjs';
import { createPairingStore } from '../src/mcp/pairing-store.mjs';
import { createMcpGate } from '../src/mcp/mcp-gate.mjs';
import { createRemoteReadBridge } from '../src/mcp/remote-read-bridge.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(t, { authorityEnabled = true, timeoutMs = 15000 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-remote-read-'));
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('datasetId', randomUUID());
  const store = createSqliteTaskWorkspaceStore(db),
    files = createTaskWorkspaceFiles({ uploadsDirectory: root });
  const service = createTaskWorkspaceService({
    store,
    files,
    authorize: (ctx, scope) => ctx.actor.kind === 'user' || authorizeTaskMcpContext(ctx, scope)
  });
  const user = () => ({ actor: { kind: 'user', id: 'owner' }, ...store.identity(), guard() {} });
  const workspaceId = service.createWorkspace(user(), { operationId: randomUUID(), name: '合成工作区' }).data.workspace
    .id;
  const hidden = service.createWorkspace(user(), { operationId: randomUUID(), name: '另外的本地授权' }).data.workspace
    .id;
  const document = service.createDocument(user(), {
    operationId: randomUUID(),
    workspaceId,
    title: '说明',
    markdown: '只有本机测试的合成正文'
  }).data.document;
  const task = service.createTask(user(), { operationId: randomUUID(), workspaceId, title: '合成任务' }).data.task;
  const pairings = createPairingStore({ directory: path.join(root, 'mcp') });
  const pair = pairings.create({
    label: '本地测试',
    spaceId: '',
    scope: { kind: 'none' },
    excludedNoteIds: [],
    policyId: '',
    policyRevision: 0,
    expiresInDays: 1,
    socketPath: '/synthetic-not-opened',
    dataDirectory: root,
    taskWorkspaceGrants: [workspaceId, hidden].map(workspaceId => ({ workspaceId, read: true, writeDocuments: true })),
    taskWorkspaceDatasetId: store.identity().datasetId,
    taskWorkspaceDatasetEpoch: store.identity().datasetEpoch
  });
  const handle = Object.freeze({}),
    state = { active: true, enabled: true, consent: true, service, checks: 0 };
  let binding = Object.freeze({
    issuer: 'test-issuer',
    subject: 'test-subject',
    clientId: 'test-client',
    deviceId: 'test-device',
    grantId: 'test-grant',
    grantRevision: 1,
    sessionGeneration: 'generation-1',
    pairingId: pair.pairingId,
    ...store.identity(),
    remoteConsent: true
  });
  // 只有 tests 签发 handle；结构相同的外部 JSON 不被 WeakMap 识别。
  const handles = new WeakMap([[handle, true]]);
  const authority = {
    resolve(candidate) {
      if (!handles.has(candidate)) return null;
      if (state.asyncResolve) return Promise.resolve(null);
      return {
        binding,
        assertCurrent({ tool, workspaceId: target }) {
          state.checks++;
          if (state.asyncCheck) return Promise.resolve(true);
          if (state.missingCheckResult) return undefined;
          return (
            state.active &&
            state.consent &&
            target === workspaceId &&
            ['tasks_get', 'task_documents_read'].includes(tool)
          );
        }
      };
    }
  };
  const audit = [],
    flags = () => ({ aiEnabled: state.enabled, allowExternal: state.enabled });
  const executor = createTaskMcpExecutor({
    pairings,
    getService: () => state.service,
    getIdentity: store.identity,
    assertFlags() {
      if (!state.enabled) throw Object.assign(new Error(), { code: 'MCP_DISABLED' });
    },
    timeoutMs
  });
  const gate = createMcpGate({
    pairings,
    taskExecutor: executor,
    flags,
    getAccess: () => null,
    audit: { append: row => audit.push(row) },
    remoteAuthority: authorityEnabled ? authority : null
  });
  const delivered = [],
    bridges = [];
  const bridge = options => {
    const value = createRemoteReadBridge({
      gate,
      handle,
      enabled: true,
      deliver: value => {
        delivered.push(value);
      },
      ...options
    });
    bridges.push(value);
    return value;
  };
  const request = (overrides = {}) =>
    JSON.stringify({
      version: 1,
      requestId: randomUUID(),
      deviceId: binding.deviceId,
      grantId: binding.grantId,
      grantRevision: binding.grantRevision,
      datasetEpoch: binding.datasetEpoch,
      sessionGeneration: binding.sessionGeneration,
      deadline: Date.now() + 10000,
      tool: 'task_documents_read',
      input: { workspaceId, documentId: document.id },
      ...overrides
    });
  t.after(() => {
    for (const b of bridges) b.disconnect();
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    pairings,
    pair,
    gate,
    service,
    state,
    store,
    document,
    task,
    workspaceId,
    hidden,
    handle,
    audit,
    delivered,
    request,
    bridge,
    updateBinding: changes => {
      binding = Object.freeze({ ...binding, ...changes });
    }
  };
}

test('真实配对、SQLite服务、gate贯通两个只读工具；不返回可重放正文，不记录正文', async t => {
  const f = setup(t),
    b = f.bridge();
  const result = await b.submit(f.request());
  assert.deepEqual(Object.keys(result), ['requestId', 'status']);
  assert.equal(JSON.parse(f.delivered[0].result.taskContent[0].text).markdown, '只有本机测试的合成正文');
  await b.submit(f.request({ tool: 'tasks_get', input: { workspaceId: f.workspaceId, taskId: f.task.id } }));
  assert.equal(JSON.parse(f.delivered[1].result.taskContent[0].text).id, f.task.id);
  assert(!JSON.stringify(f.audit).includes('合成正文'));
  assert(f.state.checks > 4);
});

test('默认关闭、缺authority、JSON伪造句柄、独立consent缺失均拒绝', async t => {
  const f = setup(t);
  await assert.rejects(f.bridge({ enabled: false }).submit(f.request()), { code: 'MCP_REMOTE_DISABLED' });
  await assert.rejects(f.bridge({ handle: JSON.parse(JSON.stringify(f.handle)) }).submit(f.request()), {
    code: 'MCP_REMOTE_DENIED'
  });
  f.state.consent = false;
  await assert.rejects(f.bridge().submit(f.request()), { code: 'MCP_REMOTE_DENIED' });
  const absent = setup(t, { authorityEnabled: false });
  await assert.rejects(absent.bridge().submit(absent.request()), { code: 'MCP_REMOTE_DENIED' });
  assert.equal(f.delivered.length, 0);
});

test('宽本地授权不提升remote范围；写、图、list、普通笔记及伪造ctx均拒绝', async t => {
  const f = setup(t),
    b = f.bridge();
  for (const tool of ['tasks_claim', 'task_images_read', 'tasks_list', 'notes_read']) {
    await assert.rejects(b.submit(f.request({ tool })), { code: 'MCP_REMOTE_DENIED' });
  }
  await assert.rejects(b.submit(f.request({ input: { workspaceId: f.hidden, documentId: f.document.id } })), {
    code: 'MCP_REMOTE_DENIED'
  });
  await assert.rejects(b.submit(f.request({ ctx: { actor: { kind: 'user' } } })), {
    code: 'MCP_REMOTE_REQUEST_INVALID'
  });
  await assert.rejects(
    b.submit(f.request({ input: { workspaceId: f.workspaceId, documentId: f.document.id, owner: 'owner' } })),
    { code: 'MCP_REQUEST_INVALID' }
  );
  for (const overrides of [
    { deviceId: 'wrong' },
    { grantId: 'wrong' },
    { grantRevision: 2 },
    { datasetEpoch: 'wrong-epoch' },
    { sessionGeneration: 'wrong' }
  ]) {
    await assert.rejects(b.submit(f.request(overrides)), { code: 'MCP_REMOTE_DENIED' });
  }
  assert.equal(f.delivered.length, 0);
});

test('请求ID防重复与冲突，已完成记录有界且不淘汰重放保护', async t => {
  const f = setup(t),
    b = f.bridge({ limits: { maxRequests: 1 } }),
    raw = f.request();
  await b.submit(raw);
  await assert.rejects(b.submit(raw), { code: 'MCP_REMOTE_DUPLICATE' });
  await assert.rejects(
    b.submit(JSON.stringify({ ...JSON.parse(raw), input: { ...JSON.parse(raw).input, start: 0 } })),
    { code: 'MCP_REMOTE_REQUEST_CONFLICT' }
  );
  await assert.rejects(b.submit(f.request()), { code: 'MCP_REMOTE_BUSY' });
  assert.equal(f.delivered.length, 1);
  assert.equal(b.stats().retainedIds, 1);
});

function blockRead(f) {
  let release,
    started = 0;
  const wait = new Promise(resolve => {
    release = resolve;
  });
  f.state.service = {
    ...f.service,
    async getDocument(ctx, input) {
      started++;
      await wait;
      return f.service.getDocument(ctx, input);
    }
  };
  return { release, started: () => started };
}

test('取消/断线及时终止，但真实读取结束前不释放并发；排队取消不执行', async t => {
  const f = setup(t),
    slow = blockRead(f),
    b = f.bridge();
  const a = JSON.parse(f.request()),
    c = JSON.parse(f.request());
  const pa = b.submit(JSON.stringify(a)),
    pc = b.submit(JSON.stringify(c));
  const ra = assert.rejects(pa, { code: 'MCP_REMOTE_CANCELLED' }),
    rc = assert.rejects(pc, { code: 'MCP_REMOTE_CANCELLED' });
  await flush();
  assert.equal(slow.started(), 1);
  b.cancel(a.requestId);
  b.cancel(c.requestId);
  await Promise.all([ra, rc]);
  assert.equal(b.stats().active, 1);
  assert.equal(b.stats().queued, 0);
  slow.release();
  await flush();
  await flush();
  assert.equal(b.stats().active, 0);
  assert.equal(f.delivered.length, 0);
  b.disconnect();
  await assert.rejects(b.submit(f.request()), { code: 'MCP_REMOTE_DISABLED' });
});

test('总deadline包含队列；过长deadline拒绝，gate自身超时也保留底层槽', async t => {
  const f = setup(t, { timeoutMs: 10 }),
    slow = blockRead(f),
    b = f.bridge();
  await assert.rejects(b.submit(f.request({ deadline: Date.now() + 60000 })), { code: 'MCP_REMOTE_EXPIRED' });
  const first = b.submit(f.request());
  const rejected = assert.rejects(first, { code: 'MCP_TIMEOUT' });
  await rejected;
  assert.equal(b.stats().active, 1);
  await assert.rejects(b.submit(f.request({ deadline: Date.now() + 20 })), { code: 'MCP_REMOTE_EXPIRED' });
  assert.equal(slow.started(), 1);
  slow.release();
  await flush();
  await flush();
  assert.equal(b.stats().active, 0);
  assert.equal(f.delivered.length, 0);
});

test('在途远程撤销/连接代际/本地epoch/全局关闭/本地撤销最终拒绝结果', async t => {
  for (const mode of ['remote', 'generation', 'epoch', 'flags', 'pairing', 'disconnect']) {
    const f = setup(t),
      slow = blockRead(f),
      b = f.bridge();
    const pending = b.submit(f.request()),
      rejected = assert.rejects(pending);
    await flush();
    if (mode === 'remote') f.state.active = false;
    if (mode === 'generation') f.updateBinding({ sessionGeneration: 'generation-2' });
    if (mode === 'epoch') f.pairings.get(f.pair.pairingId).taskWorkspaceDatasetEpoch = 'restored';
    if (mode === 'flags') f.state.enabled = false;
    if (mode === 'pairing') f.pairings.get(f.pair.pairingId).revokedAt = new Date().toISOString();
    if (mode === 'disconnect') b.disconnect();
    slow.release();
    await rejected;
    await flush();
    assert.equal(f.delivered.length, 0, mode);
  }
});

test('队列数量、排队字节、请求字节分别有界', async t => {
  const f = setup(t),
    slow = blockRead(f),
    b = f.bridge({ limits: { maxPending: 1 } });
  const first = b.submit(f.request()),
    second = b.submit(f.request());
  const rejected = [assert.rejects(first), assert.rejects(second)];
  await assert.rejects(b.submit(f.request()), { code: 'MCP_REMOTE_BUSY' });
  await assert.rejects(f.bridge({ limits: { maxQueuedBytes: 1 } }).submit(f.request()), { code: 'MCP_REMOTE_BUSY' });
  await assert.rejects(f.bridge({ limits: { maxRequestBytes: 1 } }).submit(f.request()), {
    code: 'MCP_REMOTE_REQUEST_INVALID'
  });
  b.disconnect();
  slow.release();
  await Promise.all(rejected);
  await flush();
});

test('原本地token调用不需远程authority；未知发送端错误不输出敏感错误正文', async t => {
  const f = setup(t, { authorityEnabled: false });
  const token = JSON.parse(fs.readFileSync(f.pair.pairingFile, 'utf8')).token;
  const result = await f.gate.call({
    token,
    tool: 'task_documents_read',
    input: { workspaceId: f.workspaceId, documentId: f.document.id }
  });
  assert(result.taskContent);
  const g = setup(t),
    b = g.bridge({
      deliver() {
        throw new Error('token/合成正文不可泄漏');
      }
    });
  await assert.rejects(
    b.submit(g.request()),
    error => !error.message.includes('合成正文') && !error.message.includes('token')
  );
  assert.throws(() => g.bridge({ deliver: async () => {} }), TypeError);
});

test('已使用的不透明句柄不能跨请求升级主体/代际/授权修订', async t => {
  for (const changes of [{ subject: 'other' }, { sessionGeneration: 'generation-2' }, { grantRevision: 2 }]) {
    const f = setup(t),
      b = f.bridge();
    await b.submit(f.request());
    f.updateBinding(changes);
    await assert.rejects(b.submit(f.request()), { code: 'MCP_REMOTE_DENIED' });
    assert.equal(f.delivered.length, 1);
  }
});

test('authority异步解析、异步复核与未显式返回true全部拒绝', async t => {
  for (const key of ['asyncResolve', 'asyncCheck', 'missingCheckResult']) {
    const f = setup(t);
    f.state[key] = true;
    await assert.rejects(f.bridge().submit(f.request()), { code: 'MCP_REMOTE_DENIED' });
    assert.equal(f.delivered.length, 0);
  }
});

test('remote允许不能覆盖本地任务授权缺失，权限交集另一向也拒绝', async t => {
  const f = setup(t);
  f.pairings.get(f.pair.pairingId).taskWorkspaceGrants = [];
  await assert.rejects(f.bridge().submit(f.request()), { code: 'MCP_TASK_ACCESS_REVOKED' });
  assert.equal(f.delivered.length, 0);
});
