import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startLocalRuntime } from '../../src/runtime-server.mjs';
import { withPageFailureDiagnostics } from '../fixtures/page-failure-diagnostics.mjs';

// Real built UI, authenticated runtime, pairing files, Unix socket and stdio adapter.
// No route interception or synthetic audit injection: a successful call must cross the adapter.
const ADAPTER = fileURLToPath(new URL('../../src/mcp/adapter.mjs', import.meta.url));
const PAIRINGS = '/api/local-runtime/mcp/pairings';

async function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-mcp-ui-'));
  let runtime, browser;
  const clients = new Set();
  t.after(async () => {
    try {
      for (const client of clients) await client.close();
      await browser?.close();
    } finally {
      await runtime?.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  runtime = await startLocalRuntime({
    dataDirectory: directory,
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url)),
    syncOptions: { autoSync: false }
  });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(runtime.launchUrl);
  const request = async (route, method = 'get', data) => {
    const response = await page.request[method](`${runtime.origin}${route}`, data === undefined ? {} : { data });
    assert.equal(response.ok(), true, `HTTP ${response.status()} ${route}`);
    return (await response.json()).data;
  };
  const space = await request('/api/knowledge/spaces/default', 'post', {});
  const note = await request('/api/knowledge/notes', 'post', {
    spaceId: space.id,
    title: 'MCP 本地连接验收',
    rawMarkdown: '这是一篇只用于端到端验收的合成笔记。'
  });
  const privateNote = await request('/api/knowledge/notes', 'post', {
    spaceId: space.id,
    title: 'MCP 私密验收',
    rawMarkdown: '私密合成正文不得外发。',
    aiVisibility: 'private'
  });
  await page.goto(`${runtime.origin}/#/settings`);
  await expect(page.getByRole('button', { name: '添加外部客户端', exact: true })).toBeEnabled();
  const connect = async pairing => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [ADAPTER, '--pairing-file', pairing.pairingFile],
      stderr: 'pipe'
    });
    const client = new Client({ name: 'knowra-onboarding-e2e', version: '1.0.0' });
    clients.add(client);
    await client.connect(transport);
    return {
      client,
      close: async () => {
        await client.close();
        clients.delete(client);
      }
    };
  };
  return { page, runtime, request, note, privateNote, connect, errors };
}

async function createInUi(page, request, name, snippetId) {
  await page.getByRole('button', { name: '添加外部客户端', exact: true }).click();
  const selection = page.getByRole('dialog', { name: '选择客户端', exact: true });
  await expect(selection).toBeVisible();
  await selection.getByRole('button', { name: `使用 ${name}`, exact: true }).click();
  const consent = page.getByRole('dialog', { name: '选择外部 AI 客户端权限', exact: true });
  await expect(consent.getByRole('textbox', { name: '客户端名称' })).toHaveValue(name);
  await expect(consent.getByRole('button', { name: '创建配对', exact: true })).toBeDisabled();
  assert.equal((await request(PAIRINGS)).items.length, 0, '选择客户端不会提前创建授权');
  const scope = consent.getByRole('button', { name: /授权范围/ });
  await expect(scope).toContainText('不授权普通笔记（仅任务工作区）');
  await scope.click();
  await page.getByRole('option', { name: '当前知识空间', exact: true }).click();
  await expect(scope).toContainText('当前知识空间');
  await expect(consent.getByRole('button', { name: '创建配对', exact: true })).toBeDisabled();
  assert.equal((await request(PAIRINGS)).items.length, 0, '选择普通笔记范围仍需明确同意，不能提前创建授权');
  const egressConsent = consent.getByRole('checkbox', {
    name: '我了解所选范围内的笔记片段会发给该客户端所属的厂商',
    exact: true
  });
  await expect(egressConsent).not.toBeChecked();
  // react-aria 的真实 input 为读屏/键盘保留，指针交互应点击可见 label。
  await consent.getByText('我了解所选范围内的笔记片段会发给该客户端所属的厂商', { exact: true }).click();
  await expect(egressConsent).toBeChecked();
  await consent.getByRole('button', { name: '创建配对', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `连接方式：${name}`, exact: true });
  await expect(dialog).toBeVisible();
  const overview = await request(PAIRINGS);
  assert.equal(overview.items.length, 1);
  const pairing = overview.items[0];
  assert.equal(pairing.label, name);
  assert.equal(pairing.status, 'active');
  assert.deepEqual(pairing.scope, { kind: 'library' });
  assert.deepEqual(pairing.taskWorkspaceGrants, []);
  assert.equal(pairing.allowKnowledgeRead, false);
  assert.equal(pairing.allowPropose, false);
  const snippet = dialog.locator(`pre[aria-label="${snippetId} 配置"]`);
  await expect(snippet).toBeVisible();
  await expect(snippet).toContainText(pairing.pairingFile);
  await expect(dialog.locator('pre')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: `复制 ${snippetId} 配置`, exact: true })).toBeVisible();
  assert.equal(fs.existsSync(pairing.pairingFile), true);
  const token = JSON.parse(fs.readFileSync(pairing.pairingFile, 'utf8')).token;
  assert(!JSON.stringify(overview).includes(token), '概览不返回配对令牌');
  assert(!(await dialog.innerText()).includes(token), '配置界面不显示配对令牌');
  return { dialog, pairing };
}

async function checkConnection(page, dialog) {
  // Require both real requests on every click, rather than accepting stale dialog text.
  const overviewResponse = page.waitForResponse(
    response => new URL(response.url()).pathname === PAIRINGS && response.request().method() === 'GET'
  );
  const auditResponse = page.waitForResponse(
    response => new URL(response.url()).pathname === '/api/local-runtime/mcp/audit'
  );
  await dialog.getByRole('button', { name: '检查连接', exact: true }).click();
  for (const response of await Promise.all([overviewResponse, auditResponse])) assert.equal(response.ok(), true);
  await expect(dialog.getByRole('status', { name: '连接检查结果' })).toContainText('本地设置接口可用');
}

test('MCP 真实桌面向导：Claude 配置、拒绝不算成功、stdio 成功证据、断开与撤销', { timeout: 90000 }, async t => {
  const { page, request, note, privateNote, connect, errors } = await setup(t);
  await withPageFailureDiagnostics(page, async () => {
    const { dialog, pairing } = await createInUi(page, request, 'Claude Code', 'claude');
    await expect(dialog.locator('pre')).toContainText('claude mcp add-json knowra');
    const audit = async () =>
      (await request(`/api/local-runtime/mcp/audit?pairingId=${encodeURIComponent(pairing.pairingId)}`)).items;
    assert((await audit()).some(entry => entry.event === 'created' && entry.status === 'ok'));
    await checkConnection(page, dialog);
    await expect(dialog.getByRole('status', { name: '连接检查结果' })).toContainText('最近记录中尚无成功工具调用');

    const connection = await connect(pairing);
    const tools = await connection.client.listTools();
    assert(tools.tools.some(tool => tool.name === 'notes_read'));
    const denied = await connection.client.callTool({ name: 'notes_read', arguments: { noteId: privateNote.id } });
    assert.equal(denied.isError, true);
    assert.match(denied.content[0].text, /MCP_ACCESS_REVOKED/);
    const admittedPairing = (await request(PAIRINGS)).items[0];
    assert(admittedPairing.calls > 0 && admittedPairing.lastUsedAt, '拒绝调用也更新准入计数，不能当作成功证据');
    assert(
      !(await audit()).some(entry => entry.event === 'call' && entry.status === 'ok'),
      '创建、握手、列工具和拒绝均不是成功工具调用'
    );
    await checkConnection(page, dialog);
    await expect(dialog.getByRole('status', { name: '连接检查结果' })).toContainText('最近记录中尚无成功工具调用');

    const read = await connection.client.callTool({ name: 'notes_read', arguments: { noteId: note.id } });
    assert.notEqual(read.isError, true);
    assert.equal(JSON.parse(read.content[0].text).fragments[0].noteId, note.id);
    assert(
      (await audit()).some(entry => entry.event === 'call' && entry.status === 'ok' && entry.tool === 'notes_read')
    );
    await checkConnection(page, dialog);
    await expect(dialog.getByRole('status', { name: '连接检查结果' })).toContainText('曾成功调用 notes_read');
    await expect(dialog.getByRole('status', { name: '连接检查结果' })).toContainText('不代表客户端持续在线');

    await connection.close();
    await checkConnection(page, dialog);
    await expect(dialog.getByRole('status', { name: '连接检查结果' })).toContainText('曾成功调用 notes_read');
    await expect(dialog.getByRole('status', { name: '连接检查结果' })).toContainText('不代表客户端持续在线');
    await dialog.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByRole('button', { name: '查看连接方式：Claude Code', exact: true }).click();
    await expect(dialog.locator('pre[aria-label="claude 配置"]')).toBeVisible();
    await expect(dialog.locator('pre')).toHaveCount(1);
    await dialog.getByRole('button', { name: '完成', exact: true }).click();

    await page.getByRole('button', { name: '撤销：Claude Code', exact: true }).click();
    const revoke = page.getByRole('dialog', { name: '撤销“Claude Code”？', exact: true });
    await expect(revoke).toContainText('配对文件会被删除');
    await revoke.getByRole('button', { name: '确认撤销', exact: true }).click();
    await expect(revoke).toBeHidden();
    await expect(page.getByRole('list', { name: '已配对的外部客户端' })).toContainText('已撤销');
    assert.equal((await request(PAIRINGS)).items[0].status, 'revoked');
    assert.equal(fs.existsSync(pairing.pairingFile), false);
    await expect(page.getByRole('button', { name: '查看连接方式：Claude Code', exact: true })).toHaveCount(0);
    assert.deepEqual(errors, []);
  });
});

test('MCP 真实桌面向导：Codex 单一配置、未调用检查、刷新与撤销状态同步', { timeout: 60000 }, async t => {
  const { page, runtime, request, errors } = await setup(t);
  await withPageFailureDiagnostics(page, async () => {
    const { dialog, pairing } = await createInUi(page, request, 'Codex', 'codex');
    await expect(dialog.locator('pre')).toContainText('[mcp_servers.knowra]');
    await expect(dialog.locator('pre')).not.toContainText('claude mcp');
    await checkConnection(page, dialog);
    await expect(dialog.getByRole('status', { name: '连接检查结果' })).toContainText('最近记录中尚无成功工具调用');
    await dialog.getByRole('button', { name: '完成', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: '查看连接方式：Codex', exact: true }).click();
    await expect(dialog.locator('pre[aria-label="codex 配置"]')).toBeVisible();
    await expect(dialog.locator('pre')).toHaveCount(1);
    await checkConnection(page, dialog);
    await expect(dialog.getByRole('status', { name: '连接检查结果' })).toContainText('最近记录中尚无成功工具调用');
    // Simulate another authenticated settings window revoking while this dialog is open.
    const revoked = await page.request.post(
      `${runtime.origin}${PAIRINGS}/${encodeURIComponent(pairing.pairingId)}/revoke`,
      {
        headers: { 'X-Knowra-MCP-Pairing': '1' },
        data: {}
      }
    );
    assert.equal(revoked.ok(), true);
    await checkConnection(page, dialog);
    await expect(dialog.getByRole('status', { name: '连接检查结果' })).toContainText('配对已撤销');
    await expect(dialog.locator('pre')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '复制 codex 配置', exact: true })).toHaveCount(0);
    assert.equal(fs.existsSync(pairing.pairingFile), false);
    assert.deepEqual(errors, []);
  });
});
