import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { createPairingStore } from '../src/mcp/pairing-store.mjs';
import { createMcpPairingService } from '../src/mcp/pairing-service.mjs';
import { handleMcpPairingRoute } from '../src/mcp/pairing-routes.mjs';
import { createAuditLog } from '../src/mcp/audit-log.mjs';
import { parseBody } from '../../api/src/http/request.ts';
import { temporaryDirectory } from './helpers.mjs';

function setup(t) {
  const root = temporaryDirectory(t),
    directory = path.join(root, 'mcp');
  let current = Date.parse('2026-10-09T10:00:00Z');
  const now = () => new Date(current);
  const store = createPairingStore({ directory, now });
  const create = overrides =>
    store.create({
      label: '测试客户端',
      spaceId: 's-1',
      scope: { kind: 'library' },
      excludedNoteIds: [],
      policyId: 'policy-1',
      policyRevision: 1,
      expiresInDays: 7,
      socketPath: path.join(root, 'runtime.sock'),
      dataDirectory: root,
      ...overrides
    });
  return {
    root,
    directory,
    store,
    create,
    now,
    advance: days => {
      current += days * 86_400_000;
    }
  };
}

test('旧配对兼容：缺失或非布尔字段均为关闭，不重写旧文件或自动扩大权限', t => {
  const env = setup(t);
  const created = env.create();
  const file = path.join(env.directory, 'pairings.json');
  const [row] = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const value of [undefined, false, 'true', 1]) {
    if (value === undefined) delete row.allowKnowledgeRead;
    else row.allowKnowledgeRead = value;
    delete row.knowledgeReadConfirmedAt;
    const serialized = JSON.stringify([row]);
    fs.writeFileSync(file, serialized);
    const restored = createPairingStore({ directory: env.directory, now: env.now });
    assert.equal(restored.get(created.pairingId).allowKnowledgeRead, false);
    assert.equal(restored.list()[0].allowKnowledgeRead, false);
    assert.equal(restored.list()[0].knowledgeReadConfirmedAt, null);
    assert.equal(fs.readFileSync(file, 'utf8'), serialized, '只读升级不会覆盖原始记录');
  }
});

test('切换会更新现有认证行引用；失败回滚，成功后存储状态一致', t => {
  const env = setup(t),
    created = env.create();
  const { token } = JSON.parse(fs.readFileSync(created.pairingFile, 'utf8'));
  const row = env.store.authenticate(token);
  assert.equal(row.allowKnowledgeRead, false);
  env.store.setKnowledgeRead(created.pairingId, true);
  assert.equal(row.allowKnowledgeRead, true);
  assert.equal(env.store.get(created.pairingId), row);
  env.store.setKnowledgeRead(created.pairingId, false);
  assert.equal(row.allowKnowledgeRead, false);
  assert.equal(row.knowledgeReadConfirmedAt, null);
  const file = path.join(env.directory, 'pairings.json');
  fs.renameSync(file, `${file}.saved`);
  fs.mkdirSync(file);
  assert.throws(() => env.store.setKnowledgeRead(created.pairingId, true));
  assert.equal(row.allowKnowledgeRead, false, '写盘失败不能在内存里偷偷扩大权限');
  assert.equal(row.knowledgeReadConfirmedAt, null);
  fs.rmSync(file, { recursive: true });
  fs.renameSync(`${file}.saved`, file);
  env.store.setKnowledgeRead(created.pairingId, true);
  assert.equal(
    createPairingStore({ directory: env.directory, now: env.now }).get(created.pairingId).allowKnowledgeRead,
    true
  );
});

test('总开关不接受隐式真值，过期和撤销配对不能重新启用', t => {
  const env = setup(t),
    revoked = env.create(),
    expired = env.create({ expiresInDays: 1 });
  assert.throws(
    () => env.store.setKnowledgeRead(revoked.pairingId, 'true'),
    error => error.code === 'MCP_REQUEST_INVALID'
  );
  env.store.revoke(revoked.pairingId);
  assert.throws(
    () => env.store.setKnowledgeRead(revoked.pairingId, true),
    error => error.code === 'MCP_PAIRING_REVOKED'
  );
  env.advance(2);
  assert.throws(
    () => env.store.setKnowledgeRead(expired.pairingId, true),
    error => error.code === 'MCP_PAIRING_EXPIRED'
  );
});

test('真实路由、服务与存储联测：防 CSRF、独立确认、字段校验、保存及重载', async t => {
  const env = setup(t);
  const audit = createAuditLog({ directory: env.directory, now: env.now });
  let policyCalls = 0;
  const access = {
    async createPolicy(input) {
      policyCalls += 1;
      return { ...input, policyId: `policy-${policyCalls}`, revision: 1 };
    },
    async narrowPolicy() {}
  };
  const service = createMcpPairingService({
    pairings: env.store,
    getAccess: () => access,
    audit,
    gate: { forgetGrant() {} },
    socketPath: path.join(env.root, 'runtime.sock'),
    dataDirectory: env.root,
    now: env.now,
    flags: () => ({ aiEnabled: true, allowExternal: true })
  });
  const invoke = async (route, body, headers = { 'x-knowra-mcp-pairing': '1' }, method = 'POST') => {
    const request = Readable.from([JSON.stringify(body)]);
    Object.assign(request, { method, headers: { 'content-type': 'application/json', ...headers } });
    let result;
    const response = {
      writeHead(status, responseHeaders) {
        this.status = status;
        this.headers = responseHeaders;
      },
      end(serialized) {
        result = { status: this.status, headers: this.headers, ...JSON.parse(serialized) };
      }
    };
    assert.equal(
      await handleMcpPairingRoute({
        request,
        response,
        url: new URL(route, 'http://localhost'),
        mcp: { service },
        parseBody
      }),
      true
    );
    return result;
  };
  const input = { label: 'Codex', spaceId: 's-1', scope: { kind: 'library' }, egressConfirmed: true };
  const base = '/api/local-runtime/mcp/pairings';
  const denied = await invoke(base, { ...input, allowKnowledgeRead: true, allowPropose: true, proposeConfirmed: true });
  assert.equal(denied.error.code, 'MCP_KNOWLEDGE_READ_UNCONFIRMED');
  assert.equal(policyCalls, 0);
  assert.equal(
    (await invoke(base, { ...input, allowKnowledgeRead: 'true', knowledgeReadConfirmed: true })).status,
    400
  );
  const created = await invoke(base, input);
  assert.equal(created.status, 201);
  assert.equal(created.data.allowKnowledgeRead, false);
  const endpoint = `${base}/${created.data.pairingId}/knowledge-read`;
  assert.equal((await invoke(endpoint, { allowKnowledgeRead: true, knowledgeReadConfirmed: true }, {})).status, 403);
  assert.equal((await invoke(endpoint, { allowKnowledgeRead: true })).error.code, 'MCP_KNOWLEDGE_READ_UNCONFIRMED');
  for (const body of [
    {},
    null,
    [],
    { allowKnowledgeRead: 'true' },
    { allowKnowledgeRead: true, knowledgeReadConfirmed: 'yes' },
    { allowKnowledgeRead: false, allowPropose: true },
    { allowKnowledgeRead: true, knowledgeReadConfirmed: true, noteIds: ['n-1'] }
  ]) {
    assert.equal((await invoke(endpoint, body)).status, 400);
  }
  assert.equal((await invoke(endpoint, { allowKnowledgeRead: true, padding: 'x'.repeat(9000) })).status, 413);
  const enabled = await invoke(endpoint, { allowKnowledgeRead: true, knowledgeReadConfirmed: true });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.headers['Cache-Control'], 'no-store');
  assert.equal(enabled.data.allowKnowledgeRead, true);
  assert.equal(enabled.data.allowPropose, false);
  assert.equal(enabled.data.knowledgeReadConfirmedAt, env.now().toISOString());
  assert.equal(createPairingStore({ directory: env.directory, now: env.now }).list()[0].allowKnowledgeRead, true);
  assert.equal((await invoke(base, {}, {}, 'GET')).data.items[0].allowKnowledgeRead, true);
  const disabled = await invoke(endpoint, { allowKnowledgeRead: false });
  assert.equal(disabled.data.allowKnowledgeRead, false);
  assert.equal(disabled.data.knowledgeReadConfirmedAt, null);
  assert.equal(createPairingStore({ directory: env.directory, now: env.now }).list()[0].allowKnowledgeRead, false);
  assert.deepEqual(
    audit.recent().map(item => item.event),
    ['knowledge_read_disabled', 'knowledge_read_enabled', 'created']
  );
  const other = await invoke(base, { ...input, allowKnowledgeRead: true, knowledgeReadConfirmed: true });
  assert.equal(other.data.allowKnowledgeRead, true);
  assert.equal(other.data.allowPropose, false);
  await invoke(`${base}/${created.data.pairingId}/revoke`, {});
  assert.equal(
    (await invoke(endpoint, { allowKnowledgeRead: true, knowledgeReadConfirmed: true })).error.code,
    'MCP_PAIRING_REVOKED'
  );
  assert.equal((await invoke(`${base}/not-found/knowledge-read`, { allowKnowledgeRead: false })).status, 404);
});
