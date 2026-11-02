import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { startLocalRuntime } from '../src/runtime-server.mjs';
import { temporaryDirectory } from './helpers.mjs';

async function localRequests(t, options = {}) {
  const root = temporaryDirectory(t),
    distRoot = path.join(root, 'dist');
  fs.mkdirSync(distRoot);
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><head></head><body>Knowra</body></html>');
  const runtime = await startLocalRuntime({
    dataDirectory: path.join(root, 'data'),
    distRoot,
    syncOptions: { autoSync: false },
    ...options
  });
  t.after(() => runtime.close());
  const cookie = (await fetch(runtime.launchUrl, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  async function call(route, method = 'GET', body, headers = {}) {
    const response = await fetch(`${runtime.origin}${route}`, {
      method,
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Knowra-Dataset': runtime.store.getStatus().datasetId,
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, ...(await response.json()) };
  }
  const space = (await call('/api/knowledge/spaces/default', 'POST', {})).data;
  return { runtime, call, space };
}

test('可选 AI 工厂装配失败只关闭助手，核心保存仍可用且日志不泄漏异常内容', async t => {
  const warnings = [];
  const { call, space } = await localRequests(t, {
    aiRuntimeFactory() {
      throw new Error('synthetic-secret-do-not-log');
    },
    logger: { warn: (...args) => warnings.push(args), error() {} }
  });
  const status = await call('/api/ai/assistant/status');
  assert.equal(status.data.generationAvailable, false);
  assert.match(status.data.unavailableReason, /装配失败/);
  const note = await call('/api/knowledge/notes', 'POST', {
    spaceId: space.id,
    title: '故障仍保存',
    rawMarkdown: '核心资料'
  });
  assert.equal(note.status, 201);
  assert.equal((await call(`/api/knowledge/notes/${note.data.id}`)).data.rawMarkdown, '核心资料');
  assert(warnings.some(args => args[1]?.code === 'AI_ASSEMBLY_FAILED'));
  assert(!JSON.stringify(warnings).includes('synthetic-secret'));
});

test('AI 关闭开关在调用可选工厂之前生效', async t => {
  const previous = process.env.KNOWRA_AI_ENABLED;
  process.env.KNOWRA_AI_ENABLED = '0';
  try {
    let calls = 0;
    const { call, space } = await localRequests(t, {
      aiRuntimeFactory() {
        calls++;
        throw new Error('must not be invoked');
      }
    });
    assert.equal(calls, 0);
    assert.match((await call('/api/ai/assistant/status')).data.unavailableReason, /已关闭/);
    assert.equal(
      (await call('/api/knowledge/notes', 'POST', { spaceId: space.id, title: '关闭仍保存', rawMarkdown: '核心资料' }))
        .status,
      201
    );
  } finally {
    if (previous === undefined) delete process.env.KNOWRA_AI_ENABLED;
    else process.env.KNOWRA_AI_ENABLED = previous;
  }
});

test('真实本地入口开放会话与授权写入，仍限制永久删除和试题', async t => {
  const { call, space } = await localRequests(t);
  const headers = { 'X-Knowra-AI-Conversation': '1' };
  const created = await call('/api/ai/conversations', 'POST', { spaceId: space.id }, headers);
  assert.equal(created.status, 201, JSON.stringify(created));
  const id = created.data.conversationId;
  const submitted = await call(
    `/api/ai/conversations/${id}/messages`,
    'POST',
    { content: '合成消息', idempotencyKey: 'local-01' },
    headers
  );
  assert.equal(submitted.status, 202, JSON.stringify(submitted));
  const turnId = submitted.data.turnId;
  const retry = await call(`/api/ai/conversations/${id}/turns/${turnId}/retry`, 'POST', undefined, headers);
  assert.notEqual(retry.error?.code, 'LOCAL_FEATURE_UNAVAILABLE');
  assert([202, 422].includes(retry.status), JSON.stringify(retry));
  const resumed = await call(`/api/ai/conversations/${id}/turns/${turnId}/resume`, 'POST', undefined, headers);
  assert.notEqual(resumed.error?.code, 'LOCAL_FEATURE_UNAVAILABLE');
  assert([202, 422].includes(resumed.status), JSON.stringify(resumed));
  const cancelled = await call(`/api/ai/conversations/${id}/turns/${turnId}/cancel`, 'POST', undefined, headers);
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled));
  const policy = await call(
    '/api/ai/access-policies',
    'POST',
    {
      spaceId: space.id,
      scope: { kind: 'library' },
      excludedNoteIds: [],
      includeAttachments: false,
      read: true,
      egress: false,
      recipients: [],
      expiresAt: new Date(Date.now() + 86400000).toISOString()
    },
    { 'X-Knowra-AI-Access': '1' }
  );
  assert.equal(policy.status, 201, JSON.stringify(policy));
  const revoked = await call(
    `/api/ai/access-policies/${policy.data.policyId}`,
    'PATCH',
    { revision: policy.data.revision, revoke: true },
    { 'X-Knowra-AI-Access': '1' }
  );
  assert.equal(revoked.status, 200, JSON.stringify(revoked));
  for (const route of [
    '/api/ai/conversations/unknown/delete',
    '/api/knowledge/notes/unknown/permanent',
    '/api/questions'
  ]) {
    assert.equal(
      (await call(route, route.endsWith('permanent') ? 'DELETE' : 'POST', {})).error.code,
      'LOCAL_FEATURE_UNAVAILABLE'
    );
  }
});

test('真实本地入口知识回收站恢复与来源重新采用保留版本和审核保护', async t => {
  const { runtime, call } = await localRequests(t);
  const created = await call('/api/knowledge/items', 'POST', {
    title: '本地生命周期',
    canonicalStatement: '可人工核对的陈述',
    sourceMode: 'annotation',
    evidence: [{ sourceType: 'manual', quoteText: '不可覆盖的历史摘录' }]
  });
  assert.equal(created.status, 201, JSON.stringify(created));
  const { item, evidence } = created.data;
  const root = `/api/knowledge/items/${item.id}`;
  const confirmed = await call(`${root}/confirm`, 'POST', { expectedUpdatedAt: item.updatedAt });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
  const retired = await call(`${root}/evidence/${evidence[0].id}/retire`, 'POST', {
    expectedUpdatedAt: evidence[0].updatedAt
  });
  assert.equal(retired.status, 200, JSON.stringify(retired));
  assert.equal(retired.data.item.reviewStatus, 'needsRevision');
  const readopted = await call(`${root}/evidence/${evidence[0].id}/readopt`, 'POST', {
    expectedUpdatedAt: retired.data.evidence.updatedAt
  });
  assert.equal(readopted.status, 200, JSON.stringify(readopted));
  assert.equal(readopted.data.evidence.applicabilityStatus, 'active');
  assert.equal(readopted.data.evidence.quoteText, evidence[0].quoteText);
  assert.equal(readopted.data.item.reviewStatus, 'needsRevision');
  const trashed = await call(`${root}/trash`, 'POST', { expectedUpdatedAt: readopted.data.item.updatedAt });
  assert.equal(trashed.status, 200, JSON.stringify(trashed));
  assert(trashed.data.deletedAt);
  assert.equal(
    (await call('/api/knowledge/items')).data.some(row => row.id === item.id),
    false
  );
  assert.equal(
    (await call('/api/knowledge/items?includeDeleted=true')).data.find(row => row.id === item.id).deletedAt,
    trashed.data.deletedAt
  );
  assert.equal(
    (await call(`${root}/restore-deleted`, 'POST', { expectedUpdatedAt: readopted.data.item.updatedAt })).status,
    409
  );
  const restored = await call(`${root}/restore-deleted`, 'POST', { expectedUpdatedAt: trashed.data.updatedAt });
  assert.equal(restored.status, 200, JSON.stringify(restored));
  assert.equal(restored.data.deletedAt, null);
  assert.equal(restored.data.reviewStatus, 'needsRevision');
  const blockedPurge = await call(`${root}/permanent`, 'DELETE', { expectedUpdatedAt: restored.data.updatedAt });
  assert.equal(blockedPurge.status, 409);
  assert.equal(blockedPurge.error.code, 'LOCAL_PURGE_PREVIEW_REQUIRED');
  assert(runtime.store.getStatus().pendingOperations > 0);
  assert.equal(runtime.store.deletionFacts.has('knowledgeItems', item.id), false);
});

test('本地 HTTP 闭环：单实例、会话、跨源隔离、笔记保存及重启恢复', async t => {
  const root = temporaryDirectory(t);
  const distRoot = path.join(root, 'dist');
  fs.mkdirSync(distRoot);
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><head></head><body>Knowra</body></html>');
  const options = { dataDirectory: path.join(root, 'data'), distRoot };
  let runtime = await startLocalRuntime(options);
  t.after(async () => {
    await runtime.close();
  });
  await assert.rejects(startLocalRuntime(options), /已被使用/);
  assert.equal((await fetch(`${runtime.origin}/api/knowledge/notes`)).status, 401);
  const launch = await fetch(runtime.launchUrl, { redirect: 'manual' });
  let cookie = launch.headers.get('set-cookie').split(';')[0];
  const request = async (pathname, method = 'GET', body) => {
    const response = await fetch(`${runtime.origin}${pathname}`, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
  };
  const html = await fetch(runtime.origin, { headers: { Cookie: cookie } }).then(r => r.text());
  assert.match(html, /knowraRuntime/);
  assert.equal(
    (
      await fetch(`${runtime.origin}/api/knowledge/notes`, {
        headers: { Cookie: cookie, Origin: 'https://example.com' }
      })
    ).status,
    403
  );
  assert.equal((await request('/api/storage/import', 'POST', {})).status, 409);
  assert.equal((await request('/api/knowledge/analysis-scopes', 'POST', {})).status, 409);
  const space = (await request('/api/knowledge/spaces/default', 'POST', {})).body.data;
  const created = await request('/api/knowledge/notes', 'POST', {
    spaceId: space.id,
    title: '本地验证',
    rawMarkdown: '第一版'
  });
  assert.equal(created.status, 201);
  const note = created.body.data;
  const pendingBeforePreview = runtime.store.getStatus().pendingOperations;
  const analysisPreview = await request('/api/knowledge/analysis-scopes/preview', 'POST', {
    spaceId: space.id,
    noteIds: [note.id],
    mode: 'all'
  });
  assert.equal(analysisPreview.status, 200);
  assert.equal(analysisPreview.body.data.segments[0].markdown, '第一版');
  assert.equal(runtime.store.getStatus().pendingOperations, pendingBeforePreview);
  assert.equal(runtime.store.state.analysisScopeSnapshots.length, 0);
  const attachment = await request('/api/storage/attachments', 'POST', {
    noteId: note.id,
    fileName: '离线.txt',
    contentBase64: Buffer.from('已保存附件').toString('base64')
  });
  assert.equal(attachment.status, 201);
  const saved = await request(`/api/knowledge/notes/${note.id}`, 'PATCH', {
    rawMarkdown: '断网后保存',
    expectedUpdatedAt: note.updatedAt
  });
  assert.equal(saved.status, 200);
  assert.equal(
    (
      await request(`/api/knowledge/notes/${note.id}`, 'PATCH', {
        rawMarkdown: '过期窗口',
        expectedUpdatedAt: note.updatedAt
      })
    ).status,
    409
  );
  assert.equal((await request(`/api/knowledge/notes/${note.id}/permanent`, 'DELETE')).status, 409);
  const status = (await request('/api/local-runtime/status')).body.data;
  assert.equal(status.cloudSync, 'not-configured');
  const assistantStatus = await fetch(`${runtime.origin}/api/ai/assistant/status`, {
    headers: {
      Cookie: cookie,
      'X-Knowra-Dataset': status.datasetId
    }
  }).then(response => response.json());
  assert.equal(assistantStatus.data.configured, false);
  assert.equal(assistantStatus.data.generationAvailable, false);
  assert(status.pendingOperations > 0);
  assert.equal((await request('/api/local-runtime/backup', 'POST')).status, 201);
  await runtime.close();
  runtime = await startLocalRuntime(options);
  cookie = (await fetch(runtime.launchUrl, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  assert.equal((await request(`/api/knowledge/notes/${note.id}`)).body.data.rawMarkdown, '断网后保存');
  assert.equal(
    (await request('/api/local-runtime/status')).body.data.pendingOperations,
    status.pendingOperations,
    JSON.stringify(runtime.store.readOutbox().at(-1))
  );
});

test('桌面助手路由放行受信预览；预算账本在本机，未连接云端也可用，且所有助手请求绑定资料集', async t => {
  const root = temporaryDirectory(t);
  const distRoot = path.join(root, 'dist');
  fs.mkdirSync(distRoot);
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><head></head><body>Knowra</body></html>');
  const credentialSource = {
    credentialReference: async () => ({
      provider: 'deepseek',
      modelId: 'deepseek-flash',
      credentialRef: 'synthetic-ref'
    }),
    resolveCredential: async () => {
      throw new Error('合成验收不得读取真实密钥');
    }
  };
  const runtime = await startLocalRuntime({
    dataDirectory: path.join(root, 'data'),
    distRoot,
    credentialSource,
    syncOptions: { autoSync: false }
  });
  t.after(async () => runtime.close());
  const cookie = (await fetch(runtime.launchUrl, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  const dataset = runtime.store.getStatus().datasetId;
  async function call(route, method = 'GET', body, datasetHeader = dataset, extraHeaders = {}) {
    const response = await fetch(`${runtime.origin}${route}`, {
      method,
      headers: {
        Cookie: cookie,
        ...(datasetHeader ? { 'X-Knowra-Dataset': datasetHeader } : {}),
        'Content-Type': 'application/json',
        ...extraHeaders
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, payload: await response.json() };
  }
  assert.equal(
    (await call('/api/ai/assistant/status', 'GET', undefined, null)).payload.error.code,
    'LOCAL_DATASET_CHANGED'
  );
  assert.equal((await call('/api/ai/assistant/status', 'GET', undefined, 'other')).status, 409);
  const status = (await call('/api/ai/assistant/status')).payload.data;
  assert.equal(status.executionLocation, 'local');
  assert.equal(status.configured, true);
  assert.equal(status.generationAvailable, true, '没有连接任何云端：预算账本在本机，不再因云端不可用而禁止生成');
  assert.equal(status.budget.limitMicrounits, 20_000_000);
  assert.equal(status.budget.availableMicrounits, 20_000_000);
  assert.deepEqual(status.capabilities.readScopes, ['note', 'folder']);
  assert.equal(status.capabilities.writeTools, true);
  const space = (await call('/api/knowledge/spaces/default', 'POST', {})).payload.data;
  const note = (
    await call('/api/knowledge/notes', 'POST', { spaceId: space.id, title: '合成笔记', rawMarkdown: 'alpha 正文' })
  ).payload.data;
  const preview = await call(
    '/api/ai/assistant/preview',
    'POST',
    { spaceId: space.id, scope: { kind: 'note', noteId: note.id }, question: 'alpha 是什么？' },
    dataset,
    { 'X-Knowra-AI-Assistant': '1' }
  );
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  assert.deepEqual(
    preview.payload.data.sources.map(source => source.text),
    ['alpha 正文']
  );
  // 这里只验证预览与状态；真正发起生成会读取模型凭据并调用供应商，合成验收不执行。
  assert.equal((await call('/api/ai/assistant/jobs', 'GET')).status, 422);
  assert.equal((await runtime.store.aiRepository.list('aiJob')).length, 0);
});

test('P2 真实本地入口受信预览、确认、提交、草稿及撤销，旧 dataset 被拒绝', async t => {
  const { runtime, call, space } = await localRequests(t),
    headers = { 'X-Knowra-AI-Action': '1' };
  const input = {
    spaceId: space.id,
    requestId: 'local-p2-plan',
    toolName: 'notes_create',
    arguments: { title: '本地 P2 合成', rawMarkdown: '正文' }
  };
  assert.equal((await call('/api/ai/actions', 'POST', input)).status, 403);
  assert.equal(
    (await call('/api/ai/actions', 'POST', input, { ...headers, 'X-Knowra-Dataset': 'old' })).error.code,
    'LOCAL_DATASET_CHANGED'
  );
  const row = (await call('/api/ai/actions', 'POST', input, headers)).data;
  assert.equal(row.status, 'awaitingApproval');
  await call(`/api/ai/actions/${row.actionId}/approve`, 'POST', { planHash: row.plan.planHash }, headers);
  const applied = await call(`/api/ai/actions/${row.actionId}/apply`, 'POST', {}, headers);
  assert.equal(applied.data.status, 'applied');
  assert.equal(
    (
      await call(
        '/api/ai/actions/drafts',
        'POST',
        { noteId: row.plan.items[0].after.id, clientId: 'tab', dirty: true },
        headers
      )
    ).status,
    200
  );
  await call(
    '/api/ai/actions/drafts',
    'POST',
    { noteId: row.plan.items[0].after.id, clientId: 'tab', dirty: false },
    headers
  );
  const undo = (
    await call(`/api/ai/actions/${row.actionId}/undo-preview`, 'POST', { requestId: 'local-p2-undo' }, headers)
  ).data;
  await call(`/api/ai/actions/${undo.actionId}/approve`, 'POST', { planHash: undo.plan.planHash }, headers);
  assert.equal((await call(`/api/ai/actions/${undo.actionId}/apply`, 'POST', {}, headers)).data.status, 'applied');
  assert.equal(runtime.store.state.notes[0].deleted, true);
});

test('桌面端 AI 功能开关：默认关闭，经本地接口开启后保存在数据目录，重启保留；运行时每次读取当前值，且不碰模型凭据', async t => {
  const root = temporaryDirectory(t),
    distRoot = path.join(root, 'dist'),
    dataDirectory = path.join(root, 'data');
  fs.mkdirSync(distRoot);
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><head></head><body>Knowra</body></html>');
  const gates = [];
  const start = async () => {
    const runtime = await startLocalRuntime({
      dataDirectory,
      distRoot,
      syncOptions: { autoSync: false },
      aiRuntimeFactory(options) {
        gates.push(options.knowledgeProposals);
        return { ...options, unavailableReason: '测试' };
      }
    });
    const cookie = (await fetch(runtime.launchUrl, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
    const call = async (method, body, headers = {}) => {
      const response = await fetch(`${runtime.origin}/api/ai/features`, {
        method,
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          'X-Knowra-Dataset': runtime.store.getStatus().datasetId,
          ...headers
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, ...(await response.json()) };
    };
    return { runtime, call };
  };
  const first = await start();
  assert.deepEqual((await first.call('GET')).data, { knowledgeProposals: false });
  assert.equal(typeof gates.at(-1), 'function');
  assert.equal(await gates.at(-1)(), false);
  assert.equal((await first.call('PUT', { knowledgeProposals: true })).status, 403);
  assert.equal(await gates.at(-1)(), false, '缺少请求头的写入不生效');
  assert.deepEqual((await first.call('PUT', { knowledgeProposals: true }, { 'X-Knowra-AI-Features': '1' })).data, {
    knowledgeProposals: true
  });
  assert.equal(await gates.at(-1)(), true, '无需重启，运行时读取到新值');
  assert.equal(
    (await first.call('PUT', { knowledgeProposals: 'yes' }, { 'X-Knowra-AI-Features': '1' })).error.code,
    'AI_FEATURES_INVALID'
  );
  assert.equal(fs.existsSync(path.join(dataDirectory, 'ai-features.json')), true);
  assert.equal(fs.existsSync(path.join(dataDirectory, 'ai-provider.json')), false, '不写模型凭据文件');
  await first.runtime.close();
  const second = await start();
  t.after(() => second.runtime.close());
  assert.deepEqual((await second.call('GET')).data, { knowledgeProposals: true });
  assert.equal(await gates.at(-1)(), true);
});
