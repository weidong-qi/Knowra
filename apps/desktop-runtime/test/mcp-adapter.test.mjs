import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startLocalRuntime } from '../src/runtime-server.mjs';
import { temporaryDirectory, markText } from './helpers.mjs';

const ADAPTER = fileURLToPath(new URL('../src/mcp/adapter.mjs', import.meta.url));
const BODY =
  '线粒体是细胞的能量工厂，负责有氧呼吸。\n\n细胞核储存遗传信息，指导蛋白质合成。\n\n核糖体在细胞质中合成蛋白质。';

async function setup(t, { dataDirectory, limits } = {}) {
  const root = temporaryDirectory(t),
    distRoot = path.join(root, 'dist');
  fs.mkdirSync(distRoot, { recursive: true });
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><head></head><body>Knowra</body></html>');
  const data = dataDirectory ?? path.join(root, 'data');
  let runtime = await startLocalRuntime({
    dataDirectory: data,
    distRoot,
    syncOptions: { autoSync: false },
    mcpLimits: limits,
    logger: { warn() {}, error() {} }
  });
  t.after(() => runtime?.close());
  const env = {
    data,
    distRoot,
    root,
    get runtime() {
      return runtime;
    }
  };
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
  env.note = async (title, extra = {}) =>
    (await env.call('/api/knowledge/notes', 'POST', { spaceId: env.space.id, title, rawMarkdown: BODY, ...extra }))
      .data;
  env.pair = async (body = {}) =>
    (
      await env.call(
        '/api/local-runtime/mcp/pairings',
        'POST',
        { label: '适配器测试', spaceId: env.space.id, scope: { kind: 'library' }, egressConfirmed: true, ...body },
        { 'X-Knowra-MCP-Pairing': '1' }
      )
    ).data;
  env.restart = async () => {
    await runtime?.close();
    runtime = await startLocalRuntime({
      dataDirectory: data,
      distRoot,
      syncOptions: { autoSync: false },
      logger: { warn() {}, error() {} }
    });
    await login();
  };
  env.stop = async () => {
    await runtime.close();
    runtime = null;
  };
  return env;
}

async function connect(t, pairingFile) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ADAPTER, '--pairing-file', pairingFile],
    stderr: 'pipe'
  });
  const stderr = [];
  transport.stderr?.on('data', chunk => stderr.push(chunk));
  const client = new Client({ name: 'acceptance', version: '0.0.0' });
  await client.connect(transport);
  t.after(() => client.close());
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.[0]?.text ?? '';
    assert.equal(result.structuredContent, undefined, '只返回文本内容，避免最终消息翻倍');
    return {
      ...result,
      text,
      data: result.isError ? undefined : JSON.parse(text),
      stderr: () => Buffer.concat(stderr).toString()
    };
  };
  return { client, call, stderr: () => Buffer.concat(stderr).toString() };
}
const errorCode = result => {
  assert.equal(result.isError, true, result.text);
  return result.text.split('：')[0];
};

test('真实 stdio 子进程：initialize、列工具、检索、读取、重点列表，结果带偏移与片段', async t => {
  const env = await setup(t);
  const note = await env.note('细胞器');
  // 重点写在正文标记里；单独一篇带标记的笔记测重点列表，上面这篇保持纯文本以核对读取偏移。
  const [first, second, third] = BODY.split('\n\n');
  const marked = await env.note('细胞器重点', {
    rawMarkdown: [markText(first, 'a0', 'core'), markText(second, 'a1', 'important'), third].join('\n\n')
  });
  const pairing = await env.pair();
  const { client, call } = await connect(t, pairing.pairingFile);
  assert.equal(client.getServerVersion().name, 'knowra');
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    'annotations_list',
    'notes_list',
    'notes_read',
    'notes_search',
    'proposals_get',
    'workspace_describe'
  ]);
  for (const tool of tools) {
    assert(tool.description.length > 10);
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }

  const found = await call('notes_search', { query: '线粒体' });
  assert.equal(found.isError, undefined, found.text);
  const hit = found.data.fragments.find(fragment => fragment.noteId === note.id);
  assert.ok(hit, '搜索结果应包含原笔记');
  assert.match(hit.text, /线粒体/);
  assert.equal(BODY.slice(hit.start, hit.end), hit.text);

  const read = await call('notes_read', { noteId: note.id, start: 0, end: 12 });
  assert.equal(read.data.fragments[0].text, BODY.slice(0, 12));
  assert.deepEqual(read.data.meta, { length: BODY.length, hasMore: true });
  const more = await call('notes_read', { noteId: note.id, start: 12 });
  assert.equal(more.data.fragments[0].end, BODY.length);
  assert.equal(more.data.meta.hasMore, false);

  const annotations = await call('annotations_list', { noteId: marked.id });
  assert.equal(annotations.data.fragments.length, 2);
  assert.equal(annotations.data.fragments[0].attrs.importance, 'core');
  assert.match(annotations.data.fragments[0].text, /线粒体/);
  assert.equal(annotations.data.meta.total, 2);
  const important = await call('annotations_list', { noteId: marked.id, minImportance: 'core' });
  assert.equal(important.data.fragments.length, 1);
  const paged = await call('annotations_list', { noteId: marked.id, limit: 1, offset: 1 });
  assert.equal(paged.data.fragments.length, 1);
  assert.equal(paged.data.meta.hasMore, false);

  const token = JSON.parse(fs.readFileSync(pairing.pairingFile, 'utf8')).token;
  assert(!found.stderr().includes(token) && !JSON.stringify(found).includes(token), '令牌不出现在输出里');
  const audit = (await env.call('/api/local-runtime/mcp/audit')).data.items;
  assert(audit.filter(item => item.event === 'call' && item.status === 'ok').length >= 6);
  assert(!JSON.stringify(audit).includes('线粒体'));
});

test('越权、私密、被排除、非法与伪造参数：工具错误且不返回正文', async t => {
  const env = await setup(t);
  const inside = await env.note('范围内'),
    outside = await env.note('范围外'),
    excluded = await env.note('被排除'),
    secret = await env.note('私密', { aiVisibility: 'private' });
  const pairing = await env.pair({
    scope: { kind: 'fixed', noteIds: [inside.id, excluded.id, secret.id] },
    excludedNoteIds: [excluded.id]
  });
  const { call } = await connect(t, pairing.pairingFile);
  assert.equal((await call('notes_read', { noteId: inside.id, start: 0, end: 5 })).isError, undefined);
  for (const target of [outside, excluded, secret]) {
    for (const tool of ['notes_read', 'annotations_list']) {
      const result = await call(tool, { noteId: target.id });
      assert.equal(errorCode(result), 'MCP_ACCESS_REVOKED');
      assert(!result.text.includes('线粒体'));
    }
  }
  const search = await call('notes_search', { query: '线粒体' });
  assert.deepEqual(
    search.data.fragments.map(item => item.noteId),
    [inside.id],
    '检索只返回授权范围内的笔记'
  );
  // 参数：多余字段（owner/授权/审核状态）、类型错误、越界。
  for (const [tool, args] of [
    ['notes_read', { noteId: inside.id, ownerId: 'x' }],
    ['notes_read', { noteId: inside.id, start: -1 }],
    ['notes_read', { noteId: inside.id, start: 99999 }],
    ['notes_read', { noteId: 5 }],
    ['notes_search', { query: '' }],
    ['notes_search', { query: '线粒体', limit: 99 }],
    ['notes_search', { query: '线粒体', limit: 6 }],
    ['notes_search', { query: '线粒体', policyId: 'p' }],
    ['annotations_list', { noteId: inside.id, minImportance: 'x' }],
    ['annotations_list', { noteId: inside.id, minImportance: ['core'] }],
    ['annotations_list', { noteId: inside.id, minImportance: 'constructor' }],
    ['annotations_list', { noteId: inside.id, limit: null }],
    ['annotations_list', { noteId: inside.id, offset: null }],
    ['annotations_list', { noteId: inside.id, limit: '2' }],
    ['notes_read', { noteId: inside.id, start: null }],
    ['notes_read', { noteId: inside.id, end: null }],
    ['notes_read', { noteId: inside.id, start: '0' }],
    ['notes_read', { noteId: inside.id, end: 0 }],
    ['notes_search', { query: '线粒体', limit: null }],
    ['notes_search', { query: ['线粒体'] }],
    ['notes_search', {}],
    ['annotations_list', { noteId: inside.id, grantId: 'g', status: 'confirmed' }]
  ]) {
    assert.equal(errorCode(await call(tool, args)), 'MCP_REQUEST_INVALID', `${tool} ${JSON.stringify(args)}`);
  }
  assert.equal(errorCode(await call('notes_write', { noteId: inside.id })), 'MCP_TOOL_UNKNOWN');
  // 提交候选需要配对时单独开启：没有开启的配对看不到该工具，直接调用也被明确拒绝。
  assert.equal(errorCode(await call('knowledge_propose', {})), 'MCP_PROPOSE_NOT_ALLOWED');
  // 笔记在授权后改为私密：立即不可读。
  assert.equal((await env.call(`/api/knowledge/notes/${inside.id}`, 'PATCH', { aiVisibility: 'private' })).status, 200);
  assert.equal(errorCode(await call('notes_read', { noteId: inside.id })), 'MCP_ACCESS_REVOKED');
});

test('知境未运行、重启重连、撤销：适配器不读数据库，错误清晰', async t => {
  const env = await setup(t);
  const note = await env.note('重连');
  const pairing = await env.pair();
  const { call } = await connect(t, pairing.pairingFile);
  assert.equal((await call('notes_read', { noteId: note.id, start: 0, end: 4 })).isError, undefined);
  await env.restart();
  assert.equal(
    (await call('notes_read', { noteId: note.id, start: 0, end: 4 })).isError,
    undefined,
    '运行端重启后无需重启适配器'
  );
  await env.stop();
  assert.equal(errorCode(await call('notes_read', { noteId: note.id })), 'MCP_RUNTIME_UNAVAILABLE');
  // 适配器只依赖本机通道：不包含任何数据库、存储或 API 业务模块。
  for (const name of ['adapter.mjs', 'stdio-server.mjs', 'adapter-core.mjs', 'client.mjs']) {
    const source = fs.readFileSync(path.join(path.dirname(ADAPTER), name), 'utf8');
    assert(
      !/sqlite|data-store|api\/src|node:sqlite|prisma/i.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
      `${name} 不应依赖数据库或业务模块`
    );
  }
  await env.restart();
  const revoked = await env.call(
    `/api/local-runtime/mcp/pairings/${pairing.pairingId}/revoke`,
    'POST',
    {},
    { 'X-Knowra-MCP-Pairing': '1' }
  );
  assert.equal(revoked.data.status, 'revoked');
  assert.equal(errorCode(await call('notes_read', { noteId: note.id })), 'MCP_PAIRING_FILE_MISSING');
});

test('协议健壮性：非法行、未知方法不使进程崩溃，stdout 只含 JSON-RPC，缺少参数时退出', async t => {
  const env = await setup(t);
  const pairing = await env.pair();
  const missing = await new Promise(resolve => {
    const child = spawn(process.execPath, [ADAPTER]);
    let out = '';
    child.stdout.on('data', c => {
      out += c;
    });
    child.on('exit', code => resolve({ code, out }));
  });
  assert.equal(missing.code, 2);
  assert.equal(missing.out, '');

  const child = spawn(process.execPath, [ADAPTER, '--pairing-file', pairing.pairingFile]);
  t.after(() => child.kill());
  const lines = [];
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      lines.push(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
  });
  const waitFor = async predicate => {
    for (let i = 0; i < 100; i += 1) {
      const found = lines
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .find(item => item && predicate(item));
      if (found) return found;
      await new Promise(r => setTimeout(r, 30));
    }
    throw new Error(`no response: ${lines}`);
  };
  const send = message => child.stdin.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
  send('{ 这不是 json');
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'raw', version: '0' } }
  });
  const init = await waitFor(item => item.id === 1);
  assert.equal(init.result.serverInfo.name, 'knowra');
  assert.deepEqual(Object.keys(init.result.capabilities), ['tools']);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'resources/list' });
  assert((await waitFor(item => item.id === 2)).error, '未知方法返回协议错误');
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope', arguments: {} } });
  assert.match((await waitFor(item => item.id === 3)).result.content[0].text, /MCP_TOOL_UNKNOWN/);
  send({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
  assert.deepEqual((await waitFor(item => item.id === 4)).result.tools.map(tool => tool.name).sort(), [
    'annotations_list',
    'notes_list',
    'notes_read',
    'notes_search',
    'proposals_get',
    'workspace_describe'
  ]);
  assert(
    lines.every(line => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    }),
    `stdout 出现非 JSON-RPC 内容：${lines}`
  );
  assert.equal(child.exitCode, null, '进程仍在运行');
});

test('空笔记：读取返回空片段与 length 0，不是参数错误；越界起点仍被拒', async t => {
  const env = await setup(t);
  const empty = await env.note('空笔记', { rawMarkdown: '' });
  const pairing = await env.pair();
  const { call } = await connect(t, pairing.pairingFile);
  const read = await call('notes_read', { noteId: empty.id });
  assert.equal(read.isError, undefined, read.text);
  assert.deepEqual(read.data, { fragments: [], meta: { length: 0, hasMore: false } });
  assert.deepEqual((await call('notes_read', { noteId: empty.id, start: 0, end: 10 })).data.meta, {
    length: 0,
    hasMore: false
  });
  assert.equal(errorCode(await call('notes_read', { noteId: empty.id, start: 1 })), 'MCP_REQUEST_INVALID');
  const full = await env.note('有内容');
  const tail = await call('notes_read', { noteId: full.id, start: BODY.length });
  assert.deepEqual(
    tail.data,
    { fragments: [], meta: { length: BODY.length, hasMore: false } },
    '恰好读到末尾得到空片段'
  );
  assert.equal(errorCode(await call('notes_read', { noteId: full.id, start: BODY.length + 1 })), 'MCP_REQUEST_INVALID');
  assert.deepEqual((await call('annotations_list', { noteId: empty.id })).data.fragments, []);
});

test('大小上限对最终消息生效：转义后超限被拒，成功响应的完整 stdio 消息不超过上限', async t => {
  const limit = 3200;
  const env = await setup(t, { limits: { maxResultBytes: limit } });
  const quotes = await env.note('引号', { rawMarkdown: '"'.repeat(1000) });
  const plain = await env.note('普通', { rawMarkdown: '知'.repeat(300) });
  const pairing = await env.pair();
  const child = spawn(process.execPath, [ADAPTER, '--pairing-file', pairing.pairingFile]);
  t.after(() => child.kill());
  const lines = [];
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      lines.push(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
  });
  const rpc = async (id, method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    for (let i = 0; i < 100; i += 1) {
      const line = lines.find(item => JSON.parse(item).id === id);
      if (line) return line;
      await new Promise(r => setTimeout(r, 30));
    }
    throw new Error('no response');
  };
  await rpc(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'raw', version: '0' }
  });
  // 1000 个双引号：运行端 JSON 约 2.5 KB 可放行，但进入文本内容后被再次转义，最终消息超过上限。
  const big = await rpc(2, 'tools/call', { name: 'notes_read', arguments: { noteId: quotes.id } });
  assert.match(JSON.parse(big).result.content[0].text, /MCP_RESULT_TOO_LARGE/);
  // 同一正文只读一部分则放行，且完整消息（含 JSON-RPC 信封）不超过上限。
  for (const [index, args] of [
    [3, { noteId: quotes.id, start: 0, end: 400 }],
    [4, { noteId: plain.id }]
  ]) {
    const line = await rpc(index, 'tools/call', { name: 'notes_read', arguments: args });
    assert.equal(JSON.parse(line).result.isError, undefined, line);
    assert(Buffer.byteLength(line) <= limit, `完整消息 ${Buffer.byteLength(line)} 字节超过上限 ${limit}`);
  }
});

test('随应用打包的单文件适配器（esbuild）无需 node_modules 即可运行：握手、列工具、读取', async t => {
  const { build } = await import('esbuild');
  const env = await setup(t);
  const bundle = path.join(env.root, 'bundle', 'mcp-adapter.mjs');
  await build({
    entryPoints: [ADAPTER],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
    }
  });
  const note = await env.note('打包验证');
  const pairing = await env.pair();
  // 在没有 node_modules 的目录里运行打包文件，确认依赖都已内联。
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundle, '--pairing-file', pairing.pairingFile],
    cwd: env.root
  });
  const client = new Client({ name: 'bundle', version: '0' });
  await client.connect(transport);
  t.after(() => client.close());
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), [
    'annotations_list',
    'notes_list',
    'notes_read',
    'notes_search',
    'proposals_get',
    'workspace_describe'
  ]);
  const read = await client.callTool({ name: 'notes_read', arguments: { noteId: note.id, start: 0, end: 6 } });
  assert.equal(JSON.parse(read.content[0].text).fragments[0].text, BODY.slice(0, 6));
});
