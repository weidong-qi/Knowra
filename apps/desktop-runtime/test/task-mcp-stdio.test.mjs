import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createTaskWorkspaceService } from '../../api/src/modules/task-workspaces/service.ts';
import { createSqliteTaskWorkspaceStore } from '../src/task-workspaces/sqlite-store.mjs';
import { createTaskWorkspaceFiles } from '../src/task-workspaces/files.mjs';
import { authorizeTaskMcpContext } from '../src/mcp/task-access.mjs';
import { startMcpRuntime } from '../src/mcp/index.mjs';

// 此测试不skip：受限沙盒不能listen时会明确失败，由Linux CI运行完整生产socket+stdio链路。
test('真实stdio/配对/SQLite：领取协写读图提交人工验收，默认关闭、并发、越权、撤销', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-task-stdio-'));
  const db = new DatabaseSync(path.join(root, 'task.sqlite'));
  db.exec('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('datasetId', randomUUID());
  const store = createSqliteTaskWorkspaceStore(db);
  const files = createTaskWorkspaceFiles({ uploadsDirectory: root });
  const service = createTaskWorkspaceService({
    store,
    files,
    authorize: (ctx, scope) => ctx.actor.kind === 'user' || authorizeTaskMcpContext(ctx, scope)
  });
  const user = { actor: { kind: 'user', id: 'owner' }, ...store.identity(), guard() {} };
  const workspaceId = service.createWorkspace(user, { operationId: randomUUID(), name: 'stdio合成资料' }).data.workspace
    .id;
  const hidden = service.createWorkspace(user, { operationId: randomUUID(), name: '未授权工作区' }).data.workspace.id;
  const doc = service.createDocument(user, {
    operationId: randomUUID(),
    workspaceId,
    title: '图文说明',
    markdown: '合成资料'
  }).data.document;
  const pixels = await sharp({ create: { width: 16, height: 8, channels: 3, background: '#1d7bb0' } })
    .png()
    .toBuffer();
  const uploaded = await service.uploadAttachment(user, {
    operationId: randomUUID(),
    workspaceId,
    documentId: doc.id,
    expectedRevision: doc.revision,
    fileName: 'synthetic.png',
    mimeType: 'image/png',
    bytes: pixels
  });
  const saved = service.updateDocument(user, {
    operationId: randomUUID(),
    workspaceId,
    documentId: doc.id,
    expectedRevision: uploaded.data.documentRevision,
    markdown: `图文任务\n\n![示意](${uploaded.data.imageUri})`
  }).data.document;
  const draft = service.createTask(user, { operationId: randomUUID(), workspaceId, title: '核对图文' }).data.task;
  const task = service.publishTask(user, {
    operationId: randomUUID(),
    workspaceId,
    taskId: draft.id,
    expectedRevision: draft.revision,
    description: { documentId: doc.id, versionId: saved.currentVersionId },
    acceptanceCriteria: ['核对图片'],
    inScope: '工作区文档',
    outOfScope: '普通笔记'
  }).data.task;
  const runtime = await startMcpRuntime({
    dataDirectory: root,
    // 任务分支不得调用知识grant；这里只满足创建配对时既有知识policy入口。
    getAccess: () => ({
      createPolicy: async args => ({ ...args, policyId: randomUUID(), revision: 1 }),
      narrowPolicy: async () => {}
    }),
    getTaskService: () => service,
    getTaskIdentity: store.identity,
    flags: () => ({ aiEnabled: true, allowExternal: true }),
    limits: { perMinute: 100 },
    logger: { warn() {} }
  });
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(c => c.close()));
    await runtime.close();
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function connect(grants) {
    const pairing = await runtime.service.create({
      label: '合成Agent',
      ...(grants ? { scope: { kind: 'none' } } : { spaceId: 'synthetic-space', scope: { kind: 'library' } }),
      egressConfirmed: true,
      ...(grants ? { taskWorkspaceGrants: grants, taskWorkspaceConfirmed: true, taskImagesConfirmed: true } : {})
    });
    const client = new Client({ name: 'synthetic-task-agent', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../src/mcp/adapter.mjs', import.meta.url)), '--pairing-file', pairing.pairingFile],
      stderr: 'pipe'
    });
    await client.connect(transport);
    clients.push(client);
    return { client, pairing, call: (name, args = {}) => client.callTool({ name, arguments: args }) };
  }
  const old = await connect();
  assert(!(await old.client.listTools()).tools.some(t => t.name.startsWith('tasks_') || t.name.startsWith('task_')));
  assert.equal((await old.call('tasks_list', { workspaceId })).isError, true);
  const grants = [{ workspaceId, read: true, writeDocuments: true, executeTasks: true, includeImages: true }];
  const a = await connect(grants),
    b = await connect(grants);
  const names = (await a.client.listTools()).tools.map(t => t.name);
  assert(!names.includes('notes_read'));
  assert(!names.includes('knowledge_read'));
  assert.equal((await a.call('notes_read', { noteId: 'private-note' })).isError, true);
  assert(names.includes('task_images_read'));
  assert(!names.includes('tasks_review'));
  assert(!names.includes('tasks_publish'));
  assert.equal((await a.call('task_documents_list', { workspaceId: hidden })).isError, true);
  const claims = await Promise.all(
    [a, b].map(agent =>
      agent.call('tasks_claim', {
        operationId: randomUUID(),
        workspaceId,
        taskId: task.id,
        expectedRevision: task.revision
      })
    )
  );
  assert.equal(claims.filter(r => !r.isError).length, 1);
  const winner = claims[0].isError ? b : a;
  const claimed = JSON.parse(claims.find(r => !r.isError).content[0].text);
  const edit = await winner.call('task_documents_update', {
    operationId: randomUUID(),
    workspaceId,
    documentId: doc.id,
    expectedRevision: saved.revision,
    markdown: `已核对\n\n![示意](${uploaded.data.imageUri})`
  });
  assert(!edit.isError, JSON.stringify(edit));
  const artifact = JSON.parse(edit.content[0].text).data.document;
  const image = await winner.call('task_images_read', {
    workspaceId,
    documentId: doc.id,
    versionId: artifact.currentVersionId,
    attachmentId: uploaded.data.attachment.id
  });
  assert(!image.isError, JSON.stringify(image));
  assert.equal(image.content[0].type, 'image');
  assert(Buffer.from(image.content[0].data, 'base64').equals(pixels));
  const submitted = await winner.call('tasks_submit', {
    operationId: randomUUID(),
    workspaceId,
    taskId: task.id,
    attemptId: claimed.data.attempt.id,
    generation: claimed.data.attempt.generation,
    summary: '已核对图文',
    artifacts: [{ documentId: doc.id, versionId: artifact.currentVersionId }]
  });
  assert(!submitted.isError, JSON.stringify(submitted));
  const result = JSON.parse(submitted.content[0].text);
  assert.equal(result.data.task.status, 'review');
  const accepted = service.reviewSubmission(user, {
    operationId: randomUUID(),
    workspaceId,
    taskId: task.id,
    expectedRevision: result.data.task.revision,
    submissionId: result.data.attempt.submission.id,
    decision: 'accepted'
  });
  assert.equal(accepted.data.task.status, 'accepted');
  await runtime.service.setTaskWorkspaceGrants(winner.pairing.pairingId, { taskWorkspaceGrants: [] });
  assert.equal((await winner.call('task_documents_read', { workspaceId, documentId: doc.id })).isError, true);
});
