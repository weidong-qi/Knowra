import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { startLocalRuntime } from '../src/runtime-server.mjs';
import { createOptionalAiRuntime } from '../../api/src/modules/ai/runtime.ts';
import { connectMcpRuntime } from '../src/mcp/client.mjs';
import { temporaryDirectory } from './helpers.mjs';

const P1 = '线粒体是细胞的能量工厂，通过有氧呼吸产生大部分ATP。';
const P2 = '线粒体拥有自己的DNA，可以半自主复制。';
const P3 = '叶绿体负责光合作用，不属于动物细胞。';
const BODY = `${P1}\n\n${P2}\n\n${P3}`;
const HEADERS = { 'X-Knowra-MCP-Pairing': '1' };

async function setup(t, { limits, dataDirectory, proposals = true, hooks = {} } = {}) {
  const root = temporaryDirectory(t),
    distRoot = path.join(root, 'dist');
  fs.mkdirSync(distRoot, { recursive: true });
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><head></head></html>');
  const data = dataDirectory ?? path.join(root, 'data');
  // 在“保存候选”这个提交边界注入暂停或故障，用来复现处理中的竞态与响应丢失。
  const aiRuntimeFactory = (options, meta) => {
    const ai = createOptionalAiRuntime(options, meta);
    if (ai.knowledgeCommit && hooks.commit) {
      const original = ai.knowledgeCommit.commit.bind(ai.knowledgeCommit);
      ai.knowledgeCommit.commit = args => hooks.commit(original, args);
    }
    if (ai.knowledgeCommit && hooks.find) {
      const original = ai.knowledgeCommit.findCommitted.bind(ai.knowledgeCommit);
      ai.knowledgeCommit.findCommitted = args => hooks.find(original, args);
    }
    return ai;
  };
  const start = () =>
    startLocalRuntime({
      dataDirectory: data,
      distRoot,
      syncOptions: { autoSync: false },
      mcpLimits: limits,
      mcpNow: hooks.now,
      aiRuntimeFactory,
      logger: { warn() {}, error() {} }
    });
  let runtime = await start();
  t.after(() => runtime?.close());
  const env = { data, root };
  const login = async () => {
    env.cookie = (await fetch(runtime.launchUrl, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  };
  await login();
  env.call = async (route, method = 'GET', body, headers = {}) => {
    const response = await fetch(`${runtime.origin}${route}`, {
      method,
      headers: {
        Cookie: env.cookie,
        'Content-Type': 'application/json',
        'X-Knowra-Dataset': runtime.store.getStatus().datasetId,
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, ...(await response.json()) };
  };
  env.space = (await env.call('/api/knowledge/spaces/default', 'POST', {})).data;
  env.setProposals = async enabled =>
    env.call('/api/ai/features', 'PUT', { knowledgeProposals: enabled }, { 'X-Knowra-AI-Features': '1' });
  if (proposals) await env.setProposals(true);
  env.note = async (title, extra = {}) =>
    (await env.call('/api/knowledge/notes', 'POST', { spaceId: env.space.id, title, rawMarkdown: BODY, ...extra }))
      .data;
  env.pair = async (body = {}) =>
    await env.call(
      '/api/local-runtime/mcp/pairings',
      'POST',
      {
        label: '提议测试',
        spaceId: env.space.id,
        scope: { kind: 'library' },
        egressConfirmed: true,
        allowPropose: true,
        proposeConfirmed: true,
        ...body
      },
      HEADERS
    );
  env.client = pairing => connectMcpRuntime({ pairingFile: pairing.pairingFile });
  env.items = async () => (await env.call('/api/knowledge/items')).data;
  env.restart = async () => {
    await runtime.close();
    runtime = await start();
    await login();
  };
  env.stop = async () => {
    await runtime.close();
    runtime = null;
  };
  return env;
}
const rejects = (promise, code) =>
  assert.rejects(promise, error => {
    assert.equal(error.code, code, error.message);
    return true;
  });
const propose = (client, noteId, quote, extra = {}) =>
  client.call('knowledge_propose', {
    candidates: [
      {
        title: `知识：${quote.slice(0, 6)}`,
        canonicalStatement: `依据原文整理：${quote}`,
        knowledgeType: 'concept',
        citations: [{ noteId, quote }]
      }
    ],
    ...extra
  });
const readAll = (client, noteId) => client.call('notes_read', { noteId, start: 0, end: BODY.length });

test('提交候选：读取后提交成功，只成为待审核候选；来源摘要是 mcp 模式且不含对话内容', async t => {
  const env = await setup(t);
  const note = await env.note('细胞器');
  const pairing = (await env.pair()).data;
  assert.equal(pairing.allowPropose, true);
  const client = env.client(pairing);
  await readAll(client, note.id);
  const result = await propose(client, note.id, P1);
  assert.deepEqual(result.meta, { saved: true, candidates: 1, reused: false });
  assert.deepEqual(result.fragments, []);
  const items = await env.items();
  assert.equal(items.length, 1);
  assert.equal(items[0].reviewStatus, 'candidate');
  assert.equal(items[0].sourceMode, 'ai');
  const provenance = (await env.call(`/api/knowledge/items/${items[0].id}/provenance`)).data;
  const record = provenance.record;
  assert.equal(record.executionMode, 'mcp');
  assert.equal(record.provider, 'external-client');
  assert.equal(record.modelId, 'unreported');
  assert.deepEqual(Object.keys(record.origin).sort(), ['callId', 'pairingId', 'receiptHash', 'requestId', 'spaceId']);
  assert.equal(record.origin.pairingId, pairing.pairingId);
  assert.equal(record.sources[0].quoteText, P1);
  assert.equal(record.sources[0].noteId, note.id);
  assert(!JSON.stringify(record).includes('对话'));
  // 审计：只有工具名与结果，没有候选内容。
  const audit = (await env.call('/api/local-runtime/mcp/audit')).data.items.find(
    item => item.tool === 'knowledge_propose'
  );
  assert.equal(audit.status, 'ok');
  assert(!JSON.stringify(audit).includes('依据原文整理'));
  // 外部客户端无法确认：调用结果与可用工具里都没有确认能力，候选保持 candidate。
  const tools = (await client.listTools()).map(tool => tool.name).sort();
  assert.deepEqual(tools, [
    'annotations_list',
    'knowledge_propose',
    'notes_list',
    'notes_read',
    'notes_search',
    'proposals_get',
    'workspace_describe'
  ]);
  await rejects(propose(client, note.id, P1, { reviewStatus: 'confirmed' }), 'MCP_REQUEST_INVALID');
  await rejects(
    client.call('knowledge_propose', {
      candidates: [
        {
          title: 't',
          canonicalStatement: '陈述',
          knowledgeType: 'concept',
          reviewStatus: 'confirmed',
          citations: [{ noteId: note.id, quote: P1 }]
        }
      ]
    }),
    'MCP_REQUEST_INVALID'
  );
  assert.equal((await env.items())[0].reviewStatus, 'candidate');
});

test('幂等：相同内容或相同幂等键重试返回同一结果，不重复创建', async t => {
  const env = await setup(t);
  const note = await env.note('幂等');
  const client = env.client((await env.pair()).data);
  await readAll(client, note.id);
  assert.equal((await propose(client, note.id, P1)).meta.reused, false);
  assert.deepEqual((await propose(client, note.id, P1)).meta, { saved: true, candidates: 1, reused: true });
  assert.equal((await env.items()).length, 1);
  const keyed = await propose(client, note.id, P2, { idempotencyKey: 'retry-key-0001' });
  assert.equal(keyed.meta.reused, false);
  assert.equal((await propose(client, note.id, P2, { idempotencyKey: 'retry-key-0001' })).meta.reused, true);
  assert.equal((await env.items()).length, 2);
});

test('三层开关：没有开启的配对看不到也调不了；全局“AI 提炼知识点”关闭、AI 或外发关闭时一律拒绝且不保存', async t => {
  const env = await setup(t);
  const note = await env.note('开关');
  const readOnly = (await env.pair({ allowPropose: false, proposeConfirmed: undefined })).data;
  assert.equal(readOnly.allowPropose, false);
  const readClient = env.client(readOnly);
  assert.deepEqual((await readClient.listTools()).map(tool => tool.name).sort(), [
    'annotations_list',
    'notes_list',
    'notes_read',
    'notes_search',
    'proposals_get',
    'workspace_describe'
  ]);
  await rejects(propose(readClient, note.id, P1), 'MCP_PROPOSE_NOT_ALLOWED');
  // 开启提交必须单独确认。
  assert.equal((await env.pair({ proposeConfirmed: undefined })).error.code, 'MCP_PROPOSE_UNCONFIRMED');
  assert.equal((await env.pair({ proposeConfirmed: false })).error.code, 'MCP_PROPOSE_UNCONFIRMED');
  const client = env.client((await env.pair()).data);
  await readAll(client, note.id);
  await env.setProposals(false);
  await rejects(propose(client, note.id, P1), 'MCP_PROPOSALS_DISABLED');
  assert.equal((await readAll(client, note.id)).fragments.length, 1, '关闭提议开关不影响只读');
  await env.setProposals(true);
  for (const [name, code] of [
    ['KNOWRA_AI_EGRESS_ENABLED', 'MCP_EGRESS_DISABLED'],
    ['KNOWRA_AI_ENABLED', 'MCP_AI_DISABLED']
  ]) {
    const previous = process.env[name];
    process.env[name] = '0';
    try {
      await rejects(propose(client, note.id, P1), code);
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  }
  assert.equal((await env.items()).length, 0);
  assert.equal((await propose(client, note.id, P1)).meta.saved, true);
});

test('已读约束：未读、读过之外的原文、别的配对读过的原文、重启后都不能引用', async t => {
  const env = await setup(t);
  const note = await env.note('已读约束');
  const a = env.client((await env.pair({ label: 'A' })).data),
    b = env.client((await env.pair({ label: 'B' })).data);
  await rejects(propose(a, note.id, P1), 'MCP_PROPOSAL_NOT_READ');
  await a.call('notes_read', { noteId: note.id, start: 0, end: P1.length });
  await rejects(propose(a, note.id, P3), 'MCP_PROPOSAL_INVALID');
  await rejects(propose(a, note.id, P1.slice(0, 5) + '被篡改的引文'), 'MCP_PROPOSAL_INVALID');
  await rejects(propose(b, note.id, P1), 'MCP_PROPOSAL_NOT_READ');
  await rejects(propose(a, 'no-such-note', P1), 'MCP_PROPOSAL_INVALID');
  assert.equal((await env.items()).length, 0);
  assert.equal((await propose(a, note.id, P1)).meta.saved, true);
  await env.restart();
  await rejects(propose(a, note.id, P2, { idempotencyKey: 'after-restart-1' }), 'MCP_PROPOSAL_NOT_READ');
  await a.call('notes_read', { noteId: note.id, start: 0, end: BODY.length });
  assert.equal((await propose(a, note.id, P2, { idempotencyKey: 'after-restart-1' })).meta.saved, true);
});

test('来源变化与越权：读取后正文被修改、笔记超出范围/被排除/变私密，都不能保存', async t => {
  const env = await setup(t);
  const inside = await env.note('范围内'),
    outside = await env.note('范围外'),
    excluded = await env.note('被排除'),
    secret = await env.note('私密', { aiVisibility: 'private' });
  const client = env.client(
    (
      await env.pair({
        scope: { kind: 'fixed', noteIds: [inside.id, excluded.id, secret.id] },
        excludedNoteIds: [excluded.id]
      })
    ).data
  );
  await readAll(client, inside.id);
  for (const target of [outside, excluded, secret]) {
    // 别的笔记读过原文不等于这篇读过：引文必须落在“这篇笔记”已读的片段里。
    await rejects(propose(client, target.id, P1), 'MCP_PROPOSAL_INVALID');
    await rejects(readAll(client, target.id), 'MCP_ACCESS_REVOKED');
  }
  const fresh = (await env.call(`/api/knowledge/notes/${inside.id}`)).data;
  assert.equal(
    (
      await env.call(`/api/knowledge/notes/${inside.id}`, 'PATCH', {
        rawMarkdown: `${BODY}\n\n新增段落`,
        expectedUpdatedAt: fresh.updatedAt
      })
    ).status,
    200
  );
  await rejects(propose(client, inside.id, P1), 'MCP_SOURCE_CHANGED');
  await readAll(client, inside.id);
  assert.equal((await propose(client, inside.id, P1)).meta.saved, true);
  assert.equal((await env.call(`/api/knowledge/notes/${inside.id}`, 'PATCH', { aiVisibility: 'private' })).status, 200);
  await rejects(propose(client, inside.id, P2, { idempotencyKey: 'after-private-1' }), 'MCP_ACCESS_REVOKED');
  assert.equal((await env.items()).length, 1);
});

test('原子与去重：任一候选与已有知识重复，整批不保存', async t => {
  const env = await setup(t);
  const note = await env.note('去重');
  const client = env.client((await env.pair()).data);
  await readAll(client, note.id);
  await propose(client, note.id, P1);
  const duplicateOf = `依据原文整理：${P1}`;
  const candidate = (quote, statement) => ({
    title: statement.slice(0, 6),
    canonicalStatement: statement,
    knowledgeType: 'concept',
    citations: [{ noteId: note.id, quote }]
  });
  await rejects(
    client.call('knowledge_propose', {
      candidates: [candidate(P2, '线粒体拥有自己的DNA。'), candidate(P1, duplicateOf)]
    }),
    'MCP_PROPOSAL_DUPLICATE'
  );
  assert.equal((await env.items()).length, 1, '整批回滚，第二条重复时第一条也没有保存');
});

test('数量上限：每个配对每天提交的候选条数有上限，超限返回稳定错误与重试时间', async t => {
  const env = await setup(t, { limits: { maxCandidatesPerDay: 2 } });
  const note = await env.note('配额');
  const client = env.client((await env.pair()).data);
  await readAll(client, note.id);
  const candidate = (quote, title) => ({
    title,
    canonicalStatement: `${title}的陈述`,
    knowledgeType: 'concept',
    citations: [{ noteId: note.id, quote }]
  });
  assert.equal(
    (await client.call('knowledge_propose', { candidates: [candidate(P1, '一'), candidate(P2, '二')] })).meta
      .candidates,
    2
  );
  const limited = await client.call('knowledge_propose', { candidates: [candidate(P3, '三')] }).catch(error => error);
  assert.equal(limited.code, 'MCP_RATE_LIMITED');
  assert(limited.retryAfterSeconds >= 1);
  assert.equal((await env.items()).length, 2);
});

test('撤销后不能再提交，已提交的候选保留且仍是待审核', async t => {
  const env = await setup(t);
  const note = await env.note('撤销');
  const pairing = (await env.pair()).data;
  const client = env.client(pairing);
  await readAll(client, note.id);
  await propose(client, note.id, P1);
  await env.call(`/api/local-runtime/mcp/pairings/${pairing.pairingId}/revoke`, 'POST', {}, HEADERS);
  await rejects(propose(client, note.id, P2), 'MCP_PAIRING_FILE_MISSING');
  const items = await env.items();
  assert.equal(items.length, 1);
  assert.equal(items[0].reviewStatus, 'candidate');
});

test('一篇笔记读后被改动，不影响引用另一篇仍然有效的已读原文', async t => {
  const env = await setup(t);
  const changed = await env.note('会被改动'),
    stable = await env.note('保持不变');
  const client = env.client((await env.pair()).data);
  await readAll(client, changed.id);
  await readAll(client, stable.id);
  const fresh = (await env.call(`/api/knowledge/notes/${changed.id}`)).data;
  assert.equal(
    (
      await env.call(`/api/knowledge/notes/${changed.id}`, 'PATCH', {
        rawMarkdown: `${BODY}\n\n新增`,
        expectedUpdatedAt: fresh.updatedAt
      })
    ).status,
    200
  );
  assert.equal((await propose(client, stable.id, P1)).meta.saved, true, '被改动那篇的旧已读记录不能拖累其他笔记的提议');
  await rejects(propose(client, changed.id, P2), 'MCP_PROPOSAL_INVALID');
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('处理中关闭“AI 提炼知识点”：事务内复核最近的开关值，候选不会保存', async t => {
  let release;
  const hold = new Promise(resolve => {
    release = resolve;
  });
  const env = await setup(t, {
    hooks: {
      commit: async (original, args) => {
        await hold;
        return original(args);
      }
    }
  });
  const note = await env.note('处理中关开关');
  const client = env.client((await env.pair()).data);
  await readAll(client, note.id);
  const inflight = propose(client, note.id, P1).then(
    () => 'saved',
    error => error.code
  );
  await wait(200);
  assert.equal((await env.setProposals(false)).status, 200);
  release();
  assert.equal(await inflight, 'MCP_PROPOSALS_DISABLED');
  assert.equal((await env.items()).length, 0);
});

test('每日配额与保存原子：并发提交只有一个通过；确认丢失后按回执恢复只计一次', async t => {
  const env = await setup(t, {
    limits: { maxCandidatesPerDay: 1 },
    hooks: {
      commit: async (original, args) => {
        await wait(100);
        return original(args);
      }
    }
  });
  const note = await env.note('并发配额');
  const client = env.client((await env.pair()).data);
  await readAll(client, note.id);
  const outcomes = await Promise.all(
    [
      propose(client, note.id, P1, { idempotencyKey: 'concurrent-a' }),
      propose(client, note.id, P2, { idempotencyKey: 'concurrent-b' })
    ].map(call =>
      call.then(
        () => 'saved',
        error => error.code
      )
    )
  );
  assert.deepEqual(outcomes.sort(), ['MCP_RATE_LIMITED', 'saved']);
  assert.equal((await env.items()).length, 1);

  // 提交成功但响应丢失：回执恢复分支同样计入配额，下一次不同的提交必须被限流。
  let lose = true;
  const lost = await setup(t, {
    limits: { maxCandidatesPerDay: 1 },
    hooks: {
      commit: async (original, args) => {
        const result = await original(args);
        if (lose) {
          lose = false;
          throw new Error('响应丢失');
        }
        return result;
      }
    }
  });
  const other = await lost.note('确认丢失');
  const second = lost.client((await lost.pair()).data);
  await readAll(second, other.id);
  assert.deepEqual((await propose(second, other.id, P1, { idempotencyKey: 'lost-ack-001' })).meta, {
    saved: true,
    candidates: 1,
    reused: true
  });
  await rejects(propose(second, other.id, P2, { idempotencyKey: 'lost-ack-002' }), 'MCP_RATE_LIMITED');
  assert.equal((await lost.items()).length, 1);
  assert.equal(
    (await propose(second, other.id, P1, { idempotencyKey: 'lost-ack-001' })).meta.reused,
    true,
    '幂等重试不再计数'
  );
});

test('计划生成后、保存前笔记被改写：事务内对照当前正文，整批拒绝', async t => {
  let env;
  env = await setup(t, {
    hooks: {
      commit: async (original, args) => {
        const fresh = (await env.call(`/api/knowledge/notes/${env.target}`)).data;
        await env.call(`/api/knowledge/notes/${env.target}`, 'PATCH', {
          rawMarkdown: '整篇被替换的新正文',
          expectedUpdatedAt: fresh.updatedAt
        });
        return original(args);
      }
    }
  });
  const note = await env.note('改写');
  env.target = note.id;
  const client = env.client((await env.pair()).data);
  await readAll(client, note.id);
  await rejects(propose(client, note.id, P1), 'MCP_SOURCE_CHANGED');
  assert.equal((await env.items()).length, 0, '没有保存一开始就是 stale 的候选');
});

test('调用超时后迟到的写入被事务内复核拦下，预留的配额归还', async t => {
  let slow = true;
  const env = await setup(t, {
    limits: { toolTimeoutMs: 250, maxCandidatesPerDay: 1 },
    hooks: {
      commit: async (original, args) => {
        if (slow) {
          slow = false;
          await wait(600);
        }
        return original(args);
      }
    }
  });
  const note = await env.note('超时');
  const client = env.client((await env.pair()).data);
  await readAll(client, note.id);
  await rejects(propose(client, note.id, P1, { idempotencyKey: 'timeout-0001' }), 'MCP_TIMEOUT');
  await wait(900);
  assert.equal((await env.items()).length, 0, '客户端已收到超时，之后不能再有候选落库');
  // 预留的配额已归还：每日上限只有 1，之后同样大小的提交仍能成功。
  assert.equal((await propose(client, note.id, P2, { idempotencyKey: 'timeout-0002' })).meta.saved, true);
  assert.equal((await env.items()).length, 1);
});

test('回执读不出来不等于没提交：结果未知时保留预留，同一幂等键重试再对账', async t => {
  // 场景一：提交成功，但回执查询暂时失败。
  let finds = 0,
    failAt = 2;
  const committed = await setup(t, {
    limits: { maxCandidatesPerDay: 1 },
    hooks: {
      find: async (original, args) => {
        finds += 1;
        if (finds === failAt) throw new Error('回执暂时读不出来');
        return original(args);
      },
      commit: async (original, args) => {
        const result = await original(args);
        throw new Error('响应丢失');
      }
    }
  });
  const note = await committed.note('结果未知');
  const client = committed.client((await committed.pair()).data);
  await readAll(client, note.id);
  await rejects(propose(client, note.id, P1, { idempotencyKey: 'unknown-001' }), 'MCP_COMMIT_UNKNOWN');
  assert.equal((await committed.items()).length, 1, '候选其实已经保存');
  await rejects(propose(client, note.id, P2, { idempotencyKey: 'unknown-002' }), 'MCP_RATE_LIMITED');
  assert.equal((await propose(client, note.id, P1, { idempotencyKey: 'unknown-001' })).meta.reused, true);
  await rejects(propose(client, note.id, P2, { idempotencyKey: 'unknown-003' }), 'MCP_RATE_LIMITED');
  assert.equal((await committed.items()).length, 1, '全程配额只计一次');

  // 场景二：提交没有落库、回执也读不出来；之后确认没有提交，重试时归还上次预留再重新预留，只计一次。
  let attempts = 0;
  finds = 0;
  failAt = 2;
  const failed = await setup(t, {
    limits: { maxCandidatesPerDay: 1 },
    hooks: {
      find: async (original, args) => {
        finds += 1;
        if (finds === failAt) throw new Error('回执暂时读不出来');
        return original(args);
      },
      commit: async (original, args) => {
        attempts += 1;
        if (attempts === 1) throw new Error('保存失败');
        return original(args);
      }
    }
  });
  const second = await failed.note('确实没提交');
  const retryClient = failed.client((await failed.pair()).data);
  await readAll(retryClient, second.id);
  await rejects(propose(retryClient, second.id, P1, { idempotencyKey: 'unknown-101' }), 'MCP_COMMIT_UNKNOWN');
  assert.equal((await failed.items()).length, 0);
  assert.equal(
    (await propose(retryClient, second.id, P1, { idempotencyKey: 'unknown-101' })).meta.reused,
    false,
    '确认上次没有提交后重新提交成功'
  );
  assert.equal((await failed.items()).length, 1);
  await rejects(propose(retryClient, second.id, P2, { idempotencyKey: 'unknown-102' }), 'MCP_RATE_LIMITED');
});

test('跨 UTC 日期归还配额：只归还原预留所在日期，不扣新一天的计数', async t => {
  // 配对策略由真实时钟校验有效期，跨日夹具不能固定在会过期的历史日期。
  const day = new Date().toISOString().slice(0, 10);
  let current = Date.parse(`${day}T23:59:59.000Z`),
    calls = 0,
    releaseFirst;
  const gate = new Promise(resolve => {
    releaseFirst = resolve;
  });
  const env = await setup(t, {
    limits: { maxCandidatesPerDay: 1 },
    hooks: {
      now: () => new Date(current),
      commit: async (original, args) => {
        calls += 1;
        if (calls === 1) {
          await gate;
          throw new Error('保存失败');
        }
        return original(args);
      }
    }
  });
  const note = await env.note('跨日');
  const pairing = await env.pair();
  assert.equal(pairing.status, 201, JSON.stringify(pairing));
  const client = env.client(pairing.data);
  await readAll(client, note.id);
  const first = propose(client, note.id, P1, { idempotencyKey: 'cross-day-01' }).then(
    () => 'saved',
    error => error.code
  );
  await wait(200);
  current += 6000;
  assert.equal(
    (await propose(client, note.id, P2, { idempotencyKey: 'cross-day-02' })).meta.saved,
    true,
    '新一天的第一条'
  );
  releaseFirst();
  assert.equal(await first, 'MCP_INTERNAL');
  // 前一天的失败请求归还的是前一天的预留；新一天的计数不能被它扣掉，每日上限 1 的第二条必须被限流。
  await rejects(propose(client, note.id, P3, { idempotencyKey: 'cross-day-03' }), 'MCP_RATE_LIMITED');
  assert.equal((await env.items()).length, 1);
});

test('同一幂等键并发重试只预留、结算一次', async t => {
  const env = await setup(t, {
    limits: { maxCandidatesPerDay: 2 },
    hooks: {
      commit: async (original, args) => {
        await wait(100);
        return original(args);
      }
    }
  });
  const note = await env.note('并发同键');
  const client = env.client((await env.pair()).data);
  await readAll(client, note.id);
  const outcomes = await Promise.all(
    [1, 2].map(() => propose(client, note.id, P1, { idempotencyKey: 'same-key-001' }))
  );
  assert.deepEqual(outcomes.map(item => item.meta.reused).sort(), [false, true]);
  assert.equal((await env.items()).length, 1);
  assert.equal(
    (await propose(client, note.id, P2, { idempotencyKey: 'same-key-002' })).meta.saved,
    true,
    '只占用了一个名额'
  );
  await rejects(propose(client, note.id, P3, { idempotencyKey: 'same-key-003' }), 'MCP_RATE_LIMITED');
});

test('回执稳定 ID 跨重试和重启，状态查询只限本配对且不含知识自由文本', async t => {
  const env = await setup(t),
    note = await env.note('回执来源');
  const pairing = (await env.pair()).data,
    client = env.client(pairing);
  await readAll(client, note.id);
  const saved = await propose(client, note.id, P1, { idempotencyKey: 'receipt-stable-001' });
  assert.equal(saved.data.saved, true);
  assert.equal(saved.data.candidateIds.length, 1);
  const {
    requestId,
    candidateIds: [candidateId]
  } = saved.data;
  const retry = await propose(client, note.id, P1, { idempotencyKey: 'receipt-stable-001' });
  assert.equal(retry.data.requestId, requestId);
  assert.deepEqual(retry.data.candidateIds, [candidateId]);
  let status = await client.call('proposals_get', { requestId });
  assert.deepEqual(status.data, {
    requestId,
    candidateIds: [candidateId],
    candidates: [{ candidateId, reviewStatus: 'candidate' }]
  });
  assert(!JSON.stringify(status).includes('依据原文整理'));
  const other = env.client((await env.pair()).data);
  await rejects(other.call('proposals_get', { requestId }), 'MCP_ENTITY_UNAVAILABLE');
  await rejects(client.call('proposals_get', { requestId: 'does-not-exist' }), 'MCP_ENTITY_UNAVAILABLE');
  await env.restart();
  status = await client.call('proposals_get', { requestId });
  assert.equal(status.data.candidates[0].reviewStatus, 'candidate');
  const item = (await env.items()).find(row => row.id === candidateId);
  const confirmed = await env.call(`/api/knowledge/items/${candidateId}/confirm`, 'POST', {
    expectedUpdatedAt: item.updatedAt
  });
  assert.equal(confirmed.status, 200);
  assert.equal((await client.call('proposals_get', { requestId })).data.candidates[0].reviewStatus, 'confirmed');
  assert.equal((await env.call(`/api/knowledge/notes/${note.id}`, 'PATCH', { aiVisibility: 'private' })).status, 200);
  await rejects(client.call('proposals_get', { requestId }), 'MCP_ENTITY_UNAVAILABLE');
});

test('导航只包含本配对可读笔记，空正文也可发现，元数据不计入已读引文', async t => {
  const env = await setup(t);
  const first = await env.note('可见一'),
    second = await env.note('可见二');
  const empty = await env.note('空笔记', { rawMarkdown: '' });
  await env.note('不应暴露的私密标题', { aiVisibility: 'private' });
  const client = env.client(
    (await env.pair({ scope: { kind: 'fixed', noteIds: [first.id, second.id, empty.id] } })).data
  );
  const summary = await client.call('workspace_describe', {});
  assert.equal(summary.data.noteCount, 3);
  const found = [],
    cursors = new Set();
  let cursor;
  do {
    const page = await client.call('notes_list', { limit: 1, ...(cursor ? { cursor } : {}) });
    found.push(...page.data.notes);
    assert(!JSON.stringify(page).includes('不应暴露'));
    cursor = page.data.nextCursor;
    if (cursor) {
      assert(!cursors.has(cursor));
      cursors.add(cursor);
    }
  } while (cursor);
  assert.deepEqual(found.map(row => row.noteId).sort(), [first.id, second.id, empty.id].sort());
  await rejects(propose(client, first.id, P1), 'MCP_PROPOSAL_NOT_READ');
});

test('知识读取总开关独立授权改写/手工正文，状态过滤、私密来源和关闭在途保护', async t => {
  const env = await setup(t),
    note = await env.note('知识来源');
  const pairing = (await env.pair({ allowKnowledgeRead: true, knowledgeReadConfirmed: true })).data;
  const client = env.client(pairing);
  assert((await client.listTools()).some(tool => tool.name === 'knowledge_read'));
  await readAll(client, note.id);
  const receipt = await propose(client, note.id, P1);
  const knowledgeId = receipt.data.candidateIds[0];
  const result = await client.call('knowledge_read', { knowledgeId });
  assert.equal(result.data.canonicalStatement, `依据原文整理：${P1}`);
  assert.equal(result.data.reviewStatus, 'candidate');
  assert.equal(result.data.sources[0].noteId, note.id);
  assert.equal((await client.call('knowledge_search', { query: '依据原文整理' })).data.items.length, 0);
  assert.equal(
    (await client.call('knowledge_search', { query: '依据原文整理', reviewStatus: 'candidate' })).data.items[0]
      .knowledgeId,
    knowledgeId
  );
  const manual = await env.call('/api/knowledge/items', 'POST', {
    title: '独立手写知识',
    canonicalStatement: '手工知识不要求字面来自笔记。',
    userExplanation: '全知识独立许可覆盖这个解释。',
    sourceMode: 'manual',
    knowledgeType: 'concept'
  });
  assert.equal(manual.status, 201);
  const manualId = manual.data.item?.id ?? manual.data.id;
  assert.equal(
    (await client.call('knowledge_read', { knowledgeId: manualId })).data.userExplanation,
    '全知识独立许可覆盖这个解释。'
  );
  await env.call(`/api/knowledge/notes/${note.id}`, 'PATCH', { aiVisibility: 'private' });
  await rejects(client.call('knowledge_read', { knowledgeId }), 'MCP_ENTITY_UNAVAILABLE');
  assert.equal(
    (await client.call('knowledge_search', { query: '依据原文整理', reviewStatus: 'all' })).data.items.length,
    0
  );
  assert.equal(
    (
      await env.call(
        `/api/local-runtime/mcp/pairings/${pairing.pairingId}/knowledge-read`,
        'POST',
        { allowKnowledgeRead: false },
        HEADERS
      )
    ).status,
    200
  );
  assert(!(await client.listTools()).some(tool => tool.name === 'knowledge_read'));
  await rejects(client.call('knowledge_read', { knowledgeId: manualId }), 'MCP_KNOWLEDGE_READ_NOT_ALLOWED');
});
