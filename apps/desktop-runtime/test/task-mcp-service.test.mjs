import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { createTaskWorkspaceService } from '../../api/src/modules/task-workspaces/service.ts';
import { createSqliteTaskWorkspaceStore } from '../src/task-workspaces/sqlite-store.mjs';
import { createTaskWorkspaceFiles } from '../src/task-workspaces/files.mjs';
import { createTaskMcpExecutor } from '../src/mcp/task-executor.mjs';
import { authorizeTaskMcpContext } from '../src/mcp/task-access.mjs';

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-task-mcp-'));
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('datasetId', randomUUID());
  const store = createSqliteTaskWorkspaceStore(db),
    files = createTaskWorkspaceFiles({ uploadsDirectory: root });
  let now = Date.now();
  const service = createTaskWorkspaceService({
    store,
    files,
    clock: () => now,
    authorize: (ctx, scope) => ctx.actor.kind === 'user' || authorizeTaskMcpContext(ctx, scope)
  });
  const user = () => ({ actor: { kind: 'user', id: 'owner' }, ...store.identity(), guard() {} });
  const workspaceId = service.createWorkspace(user(), { operationId: randomUUID(), name: '合成工作区' }).data.workspace
    .id;
  const hidden = service.createWorkspace(user(), { operationId: randomUUID(), name: '不可见' }).data.workspace.id;
  const rows = ['first', 'second'].map(pairingId => ({
    pairingId,
    taskWorkspaceDatasetId: store.identity().datasetId,
    taskWorkspaceDatasetEpoch: store.identity().datasetEpoch,
    expiresAt: '2099-01-01',
    taskWorkspaceGrants: [{ workspaceId, read: true, writeDocuments: true, executeTasks: true, includeImages: true }]
  }));
  const pairings = {
    get: id => rows.find(r => r.pairingId === id),
    assertActive(row) {
      if (row.revokedAt) throw Object.assign(new Error(), { code: 'MCP_REVOKED' });
    }
  };
  const executor = createTaskMcpExecutor({
    pairings,
    getService: () => service,
    getIdentity: store.identity,
    assertFlags() {}
  });
  const call = async (name, input, who = 0) => {
    const response = await executor.call(rows[who], name, input);
    return JSON.parse(response.taskContent[0].text);
  };
  const document = service.createDocument(user(), {
    operationId: randomUUID(),
    workspaceId,
    title: '说明',
    markdown: '合成要求'
  }).data.document;
  const makeTask = () => {
    const created = service.createTask(user(), { operationId: randomUUID(), workspaceId, title: '合成任务' }).data.task;
    return service.publishTask(user(), {
      operationId: randomUUID(),
      workspaceId,
      taskId: created.id,
      expectedRevision: created.revision,
      description: { documentId: document.id, versionId: document.currentVersionId },
      acceptanceCriteria: ['符合说明'],
      inScope: '协作文档',
      outOfScope: '私人笔记'
    }).data.task;
  };
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    service,
    user,
    workspaceId,
    hidden,
    document,
    rows,
    executor,
    call,
    makeTask,
    store,
    advance: ms => {
      now += ms;
    }
  };
}

test('真实SQLite服务：领取→协写→原图→提交→人类验收，回执重试与CAS隔离', async t => {
  const f = await setup(t),
    task = f.makeTask();
  const workspaces = await f.call('task_workspaces_list', {});
  assert.deepEqual(
    workspaces.items.map(w => w.id),
    [f.workspaceId]
  );
  await assert.rejects(f.call('task_documents_list', { workspaceId: f.hidden }), { code: 'MCP_TASK_ACCESS_REVOKED' });
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#287abc' } })
    .png()
    .toBuffer();
  const uploaded = await f.service.uploadAttachment(f.user(), {
    operationId: randomUUID(),
    workspaceId: f.workspaceId,
    documentId: f.document.id,
    expectedRevision: f.document.revision,
    fileName: '图.png',
    mimeType: 'image/png',
    bytes: image
  });
  const input = {
    operationId: randomUUID(),
    workspaceId: f.workspaceId,
    taskId: task.id,
    expectedRevision: task.revision
  };
  const claimed = await f.call('tasks_claim', input);
  assert.equal((await f.call('tasks_claim', input)).reused, true);
  const { attempt } = claimed.data;
  const edited = await f.call('task_documents_update', {
    operationId: randomUUID(),
    workspaceId: f.workspaceId,
    documentId: f.document.id,
    expectedRevision: uploaded.data.documentRevision,
    markdown: `协作成果\n\n![合成图](${uploaded.data.imageUri})`
  });
  const doc = edited.data.document;
  const imageInput = {
    workspaceId: f.workspaceId,
    documentId: doc.id,
    versionId: doc.currentVersionId,
    attachmentId: uploaded.data.attachment.id
  };
  const read = await f.executor.call(f.rows[0], 'task_images_read', imageInput);
  assert.equal(read.taskContent[0].type, 'image');
  assert(Buffer.from(read.taskContent[0].data, 'base64').equals(image));
  await assert.rejects(
    f.executor.call(f.rows[0], 'task_images_read', { ...imageInput, versionId: f.document.currentVersionId }),
    { code: 'MCP_TASK_WORKSPACE_FORBIDDEN' }
  );
  const lease = {
    operationId: randomUUID(),
    workspaceId: f.workspaceId,
    taskId: task.id,
    attemptId: attempt.id,
    generation: attempt.generation
  };
  const submitted = await f.call('tasks_submit', {
    ...lease,
    summary: '已完成协作',
    artifacts: [{ documentId: doc.id, versionId: doc.currentVersionId }]
  });
  assert.equal(submitted.data.task.status, 'review');
  assert.equal(submitted.data.attempt.leaseExpiresAt, null);
  const reviewed = f.service.reviewSubmission(f.user(), {
    operationId: randomUUID(),
    workspaceId: f.workspaceId,
    taskId: task.id,
    expectedRevision: submitted.data.task.revision,
    submissionId: submitted.data.attempt.submission.id,
    decision: 'accepted'
  });
  assert.equal(reviewed.data.task.status, 'accepted');
  await assert.rejects(
    f.call('task_documents_update', {
      operationId: randomUUID(),
      workspaceId: f.workspaceId,
      documentId: doc.id,
      expectedRevision: 1,
      markdown: '覆盖'
    }),
    { code: 'MCP_TASK_WORKSPACE_CONFLICT' }
  );
});

test('真实SQLite服务：并发领取唯一、他人/旧generation/到期/撤销/epoch隔离', async t => {
  const f = await setup(t),
    task = f.makeTask();
  const base = { workspaceId: f.workspaceId, taskId: task.id, expectedRevision: task.revision };
  const results = await Promise.allSettled(
    [0, 1].map(who => f.call('tasks_claim', { ...base, operationId: randomUUID() }, who))
  );
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const winner = results.findIndex(r => r.status === 'fulfilled'),
    attempt = results[winner].value.data.attempt;
  const lease = { workspaceId: f.workspaceId, taskId: task.id, attemptId: attempt.id, generation: attempt.generation };
  await assert.rejects(f.call('tasks_renew', { ...lease, operationId: randomUUID() }, 1 - winner), {
    code: 'MCP_TASK_WORKSPACE_LEASE_EXPIRED'
  });
  await assert.rejects(
    f.call('tasks_renew', { ...lease, operationId: randomUUID(), generation: attempt.generation + 1 }, winner),
    { code: 'MCP_TASK_WORKSPACE_LEASE_EXPIRED' }
  );
  f.advance(300001);
  await assert.rejects(f.call('tasks_renew', { ...lease, operationId: randomUUID() }, winner), {
    code: 'MCP_TASK_WORKSPACE_LEASE_EXPIRED'
  });
  const current = f.service.getTask(f.user(), { workspaceId: f.workspaceId, taskId: task.id });
  const next = await f.call(
    'tasks_claim',
    { ...base, operationId: randomUUID(), expectedRevision: current.revision },
    winner
  );
  assert.equal(next.data.attempt.generation, attempt.generation + 1);
  f.rows[winner].taskWorkspaceGrants = [];
  await assert.rejects(f.call('tasks_progress', { ...lease, operationId: randomUUID(), message: '迟到' }, winner), {
    code: 'MCP_TASK_ACCESS_REVOKED'
  });
  f.store.rotateEpoch();
  // workspace UUID仍保留，但旧pair不得自动读取恢复后的资料。
  assert.deepEqual(f.executor.describe(f.rows[1 - winner]), []);
  await assert.rejects(
    f.call('task_documents_read', { workspaceId: f.workspaceId, documentId: f.document.id }, 1 - winner),
    { code: 'MCP_TASK_ACCESS_REVOKED' }
  );
  const reset = f.service.getTask(f.user(), { workspaceId: f.workspaceId, taskId: task.id });
  assert.notEqual(reset.status, 'running');
});

test('最后输出快照复核：服务返回后归档仍拦截正文，撤销仍拦截已生成结果', async t => {
  const f = await setup(t);
  const result = await f.executor.call(f.rows[0], 'task_documents_read', {
    workspaceId: f.workspaceId,
    documentId: f.document.id
  });
  f.executor.assertCurrent(result);
  f.rows[0].taskWorkspaceGrantRevision = 1;
  assert.throws(() => f.executor.assertCurrent(result), { code: 'MCP_TASK_ACCESS_REVOKED' });
  const next = await f.executor.call(f.rows[0], 'task_documents_read', {
    workspaceId: f.workspaceId,
    documentId: f.document.id
  });
  f.service.archiveWorkspace(f.user(), { operationId: randomUUID(), workspaceId: f.workspaceId, expectedRevision: 1 });
  assert.throws(() => f.executor.assertCurrent(next), { code: 'TASK_WORKSPACE_CONFLICT' });
});
