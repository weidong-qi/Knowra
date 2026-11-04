// 本机 MCP（AI-03-07 M4）的 Claude Code 真实验收脚本：只用合成笔记与临时数据目录，不读写你的知境资料，也不改动你自己的 Claude 配置。
// 用法（在已登录 Claude Code 的终端里，仓库根目录）：node scripts/mcp-acceptance-claude.mjs [报告输出路径]
// 第一部分（不需要登录）：用设置页生成的同一个片段添加服务，让 `claude mcp list` 做连接健康检查。
// 第二部分（需要已登录，会消耗少量 Claude 额度，使用 haiku 模型、最多 10 轮）：让 Claude 通过 knowra 工具检索、读取、列重点，
//   并尝试查找私密笔记与范围外笔记的暗号；然后撤销配对，确认客户端立即失败。
// 合成数据会发送给 Anthropic（客户端自己的模型），其中没有任何真实笔记。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluate, parseClaudeStream } from './mcp-acceptance-lib.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.resolve(
  process.argv[2] ?? path.join(os.tmpdir(), `knowra-mcp-claude-acceptance-${Date.now()}.json`)
);
const { build } = await import(pathToFileURL(path.join(repo, 'node_modules/esbuild/lib/main.js')));
const { startLocalRuntime } = await import(
  pathToFileURL(path.join(repo, 'apps/desktop-runtime/src/runtime-server.mjs'))
);
const { anchorForBlock, projectMarkdown, calculateContentHash } = await import(
  pathToFileURL(path.join(repo, 'packages/content-anchor/src/index.js'))
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-m4-'));
const dist = path.join(root, 'dist');
fs.mkdirSync(dist);
fs.writeFileSync(path.join(dist, 'index.html'), '<html><head></head></html>');
const runtime = await startLocalRuntime({
  dataDirectory: path.join(root, 'data'),
  distRoot: dist,
  syncOptions: { autoSync: false },
  logger: { warn() {}, error() {} }
});
const cookie = (await fetch(runtime.launchUrl, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
const call = async (route, method = 'GET', body, headers = {}) =>
  (
    await fetch(runtime.origin + route, {
      method,
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Knowra-Dataset': runtime.store.getStatus().datasetId,
        ...headers
      },
      body: body && JSON.stringify(body)
    })
  ).json();

const CANARY_PRIVATE = 'PRIVATE-CANARY-7731',
  CANARY_OUTSIDE = 'OUTSIDE-CANARY-4410';
const space = (await call('/api/knowledge/spaces/default', 'POST', {})).data;
const bio = (await call('/api/knowledge/folders', 'POST', { spaceId: space.id, name: '生物' })).data;
const history = (await call('/api/knowledge/folders', 'POST', { spaceId: space.id, name: '历史' })).data;
const note = async (folderId, title, rawMarkdown, extra = {}) =>
  (await call('/api/knowledge/notes', 'POST', { spaceId: space.id, folderId, title, rawMarkdown, ...extra })).data;
const mito = await note(
  bio.id,
  '线粒体与能量',
  '线粒体是细胞的能量工厂，通过有氧呼吸产生大部分ATP。\n\n线粒体拥有自己的DNA，可以半自主复制。\n\n叶绿体负责光合作用，不属于动物细胞。'
);
const nucleus = await note(bio.id, '细胞核', '细胞核储存遗传信息，指导蛋白质合成。\n\n核仁参与核糖体RNA的合成。');
await note(bio.id, '私密日记', `这是私密笔记，里面有一个暗号：${CANARY_PRIVATE}。线粒体也被提到过。`, {
  aiVisibility: 'private'
});
await note(history.id, '秦朝制度', `秦朝统一后推行郡县制。线粒体与此无关。范围外暗号：${CANARY_OUTSIDE}。`);
for (const [index, importance] of [
  [0, 'core'],
  [1, 'important']
]) {
  const anchor = anchorForBlock(projectMarkdown(mito.rawMarkdown), index);
  const created = await call('/api/knowledge/annotations', 'POST', {
    noteId: mito.id,
    spaceId: space.id,
    schemaVersion: 2,
    scopeType: 'blocks',
    anchor,
    quoteText: anchor.quoteText,
    fromPosition: anchor.sourceStart,
    toPosition: anchor.sourceEnd,
    noteContentHash: calculateContentHash(mito.rawMarkdown),
    anchorFingerprint: `m4-${index}`,
    idempotencyKey: `m4-${index}`,
    importance
  });
  if (!created.data) throw new Error(`标注创建失败：${JSON.stringify(created)}`);
}
const pairing = (
  await call(
    '/api/local-runtime/mcp/pairings',
    'POST',
    {
      label: 'Claude Code 验收',
      spaceId: space.id,
      scope: { kind: 'folder', folderId: bio.id },
      expiresInDays: 1,
      egressConfirmed: true
    },
    { 'X-Knowra-MCP-Pairing': '1' }
  )
).data;
const adapter = (await call('/api/local-runtime/mcp/pairings')).data.adapter;
const mcpConfig = path.join(root, 'mcp.json');
fs.writeFileSync(
  mcpConfig,
  JSON.stringify({
    mcpServers: {
      knowra: {
        type: 'stdio',
        command: adapter.command,
        args: [...adapter.args, '--pairing-file', pairing.pairingFile],
        env: adapter.env
      }
    }
  })
);

// ---- 第一部分：真实 Claude Code 的 mcp list 健康检查（独立的 CLAUDE_CONFIG_DIR，不触碰用户配置；不需要登录）----
const run = (command, args, options = {}) =>
  new Promise(resolve => {
    const child = spawn(command, args, options);
    let out = '';
    child.stdout.on('data', d => {
      out += d;
    });
    child.stderr.on('data', d => {
      out += d;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.on('exit', status => {
      clearTimeout(timer);
      resolve({ status, out });
    });
  });
fs.writeFileSync(path.join(root, 'stub.mjs'), 'export const apiClient = {};');
await build({
  entryPoints: [path.join(repo, 'apps/web/src/features/settings/externalClients.ts')],
  outfile: path.join(root, 'snippets.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  alias: { '@study-accelerator/web-core': path.join(root, 'stub.mjs') }
});
const { claudeCodeSnippet } = await import(pathToFileURL(path.join(root, 'snippets.mjs')));
const claudeHome = path.join(root, 'claude-home'),
  work = path.join(root, 'work');
fs.mkdirSync(claudeHome);
fs.mkdirSync(work);
const cliEnv = { ...process.env, CLAUDE_CONFIG_DIR: claudeHome, HOME: claudeHome };
const added = await run('sh', ['-c', claudeCodeSnippet(adapter, pairing.pairingFile)], { cwd: work, env: cliEnv });
const listed = await run('claude', ['mcp', 'list'], { cwd: work, env: cliEnv });
const health = {
  addJsonExit: added.status,
  addJsonOutput: added.out.trim(),
  mcpListExit: listed.status,
  connected: /knowra:.*✔ Connected/.test(listed.out.replaceAll('\n', ' '))
};

const runClaude = prompt =>
  new Promise(resolve => {
    const args = [
      '-p',
      prompt,
      '--mcp-config',
      mcpConfig,
      '--strict-mcp-config',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--model',
      'haiku',
      '--max-turns',
      '10',
      '--permission-mode',
      'dontAsk',
      '--allowedTools',
      'mcp__knowra__notes_search',
      'mcp__knowra__notes_read',
      'mcp__knowra__annotations_list',
      '--disallowedTools',
      'Bash',
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'Task',
      'NotebookEdit'
    ];
    const child = spawn('claude', args, {
      cwd: root,
      env: { ...process.env, CLAUDECODE: '' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '',
      err = '';
    child.stdout.on('data', chunk => {
      out += chunk;
    });
    child.stderr.on('data', chunk => {
      err += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 240_000);
    child.on('exit', code => {
      clearTimeout(timer);
      resolve({ ...parseClaudeStream(out), code, err: err.slice(0, 500) });
    });
  });

// 同一连接的撤销检查：撤销前先用 SDK 客户端连上并成功调用一次，撤销后在这同一个连接上再调用。
const { Client } = await import(
  pathToFileURL(path.join(repo, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'))
);
const { StdioClientTransport } = await import(
  pathToFileURL(path.join(repo, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'))
);
const sdk = new Client({ name: 'knowra-acceptance', version: '0' });
await sdk.connect(
  new StdioClientTransport({
    command: adapter.command,
    args: [...adapter.args, '--pairing-file', pairing.pairingFile],
    env: { ...process.env, ...adapter.env }
  })
);
const beforeRevoke = await sdk.callTool({ name: 'notes_search', arguments: { query: '线粒体' } });
if (beforeRevoke.isError) throw new Error(`撤销前的同一连接调用失败：${beforeRevoke.content?.[0]?.text}`);

const prompt1 = `你只能使用 knowra 提供的笔记工具（notes_search、notes_read、annotations_list）。请依次完成：1) 搜索“线粒体”；2) 读取《线粒体与能量》这篇笔记的前 60 个字符；3) 列出这篇笔记的重点及其重要度；4) 用 notes_search 搜索“${CANARY_PRIVATE}”；5) 用 notes_search 搜索“${CANARY_OUTSIDE}”。最后用中文简要汇报你实际看到的内容与每次搜索是否有结果，不要编造。`;
const first = await runClaude(prompt1);
const loggedIn = !/Not logged in|\/login/.test(first.answer);
const audit = (await call(`/api/local-runtime/mcp/audit?pairingId=${pairing.pairingId}&limit=50`)).data.items;

await call(`/api/local-runtime/mcp/pairings/${pairing.pairingId}/revoke`, 'POST', {}, { 'X-Knowra-MCP-Pairing': '1' });
const afterSame = await sdk.callTool({ name: 'notes_search', arguments: { query: '线粒体' } });
await sdk.close().catch(() => undefined);
const sameConnection = { isError: afterSame.isError === true, text: afterSame.content?.[0]?.text ?? '' };
const listedAfter = await run('claude', ['mcp', 'list'], { cwd: work, env: cliEnv });
const listAfterRevoke = {
  connected: /knowra:.*✔ Connected/.test(listedAfter.out.replaceAll('\n', ' ')),
  output: listedAfter.out.trim().slice(0, 400)
};
// 撤销后新启动的客户端会在连接阶段就被明确拒绝（取不到工具清单），模型无法调用，所以这里只检查它没有读到任何正文。
const afterRevoke = loggedIn
  ? await runClaude('请用 knowra 的 notes_search 搜索“线粒体”，如实说明你能否使用这个工具以及结果是什么。')
  : null;

const checks = evaluate({
  health,
  first,
  afterRevoke,
  sameConnection,
  listAfterRevoke,
  audit,
  canaries: { private: CANARY_PRIVATE, outside: CANARY_OUTSIDE },
  target: { noteId: mito.id, opening: '线粒体是细胞的能量工厂' }
});
if (!loggedIn) {
  // 未登录时模型驱动的检查没有意义：只保留不需要登录的三项，避免把“没跑”当成“通过”或“失败”。
  for (const key of Object.keys(checks)) if (!/add-json|同一连接|mcp list 不再/.test(key)) delete checks[key];
  console.log('提示：本终端里的 claude 未登录，只完成了不需要登录的检查；请在已登录的终端重新运行以完成工具调用验收。');
}
const claudeVersion = (await run('claude', ['--version'])).out.trim();
const brief = item => ({
  name: item.name,
  input: item.input,
  result: item.result && { isError: item.result.isError, text: item.result.text.slice(0, 300) }
});
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      claudeVersion,
      health,
      checks,
      loggedIn,
      sameConnection,
      listAfterRevoke,
      first: {
        calls: first.calls.map(brief),
        answer: first.answer,
        turns: first.turns,
        cost: first.cost,
        mcpServers: first.mcpServers,
        code: first.code,
        err: first.err
      },
      afterRevoke: afterRevoke && {
        calls: afterRevoke.calls.map(brief),
        answer: afterRevoke.answer,
        mcpServers: afterRevoke.mcpServers
      },
      audit: audit.map(({ at, event, tool, status, code, fragments }) => ({ at, event, tool, status, code, fragments }))
    },
    null,
    2
  )
);
await runtime.close();
fs.rmSync(root, { recursive: true, force: true });
const failed = Object.entries(checks)
  .filter(([, value]) => !value)
  .map(([key]) => key);
console.log(JSON.stringify({ checks, report: reportPath, cost: first.cost, turns: first.turns }, null, 2));
if (failed.length) {
  console.log(`\n未通过：\n- ${failed.join('\n- ')}`);
  process.exitCode = 1;
}
