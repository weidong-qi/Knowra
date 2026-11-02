import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createRuntimeBackup, inspectRuntimeBackup } from '../src/backup.mjs';
import { temporaryDirectory } from './helpers.mjs';
import { emptyAgentCheckpoint } from '../../api/src/modules/ai/agent-checkpoint.ts';

test('SQLite v6→v7 会话表升级保留旧记录，消息不进入业务同步且备份可验证', async t => {
  const root = temporaryDirectory(t),
    file = path.join(root, 'local.sqlite');
  let data = createSqliteDataStore(file);
  const identity = data.aiRepository.identity();
  data.close();
  const raw = new DatabaseSync(file);
  raw.exec('DROP TABLE ai_conversation_records; PRAGMA user_version = 6');
  raw.close();
  data = createSqliteDataStore(file);
  assert(fs.readdirSync(root).some(name => name.startsWith('local.sqlite.before-v7-')));
  assert.deepEqual(data.aiRepository.identity(), identity);
  const outbox = data.readOutbox();
  const conversation = await data.aiConversationStore.createConversation({
    ownerId: 'demo',
    actorId: 'demo',
    spaceId: 'space-1'
  });
  const turn = await data.aiConversationStore.submitTurn({
    ownerId: 'demo',
    conversationId: conversation.conversationId,
    content: '保存私有会话',
    idempotencyKey: 'request-sqlite-1'
  });
  assert.deepEqual(data.readOutbox(), outbox);
  assert.equal(JSON.stringify(data.exportSnapshot()).includes('保存私有会话'), false);
  const backup = createRuntimeBackup(data, root);
  assert.equal(inspectRuntimeBackup(backup).valid, true);
  data.close();
  data = createSqliteDataStore(file);
  assert.equal((await data.aiConversationStore.getTurn(turn.turnId)).status, 'staged');
  assert.equal((await data.aiConversationStore.listMessages(conversation.conversationId))[0].content, '保存私有会话');
  data.close();
});

test('SQLite 会话正文损坏只关闭 AI，核心存储和备份保护继续有效', async t => {
  const root = temporaryDirectory(t),
    file = path.join(root, 'local.sqlite');
  let data = createSqliteDataStore(file);
  const conversation = await data.aiConversationStore.createConversation({
    ownerId: 'demo',
    actorId: 'demo',
    spaceId: 'space-1'
  });
  data.close();
  const raw = new DatabaseSync(file);
  raw
    .prepare('UPDATE ai_conversation_records SET record_json = ? WHERE record_id = ?')
    .run('{"broken":true}', conversation.conversationId);
  raw.close();
  data = createSqliteDataStore(file);
  assert(data.aiRuntimeError);
  assert.equal(data.aiConversationStore, null);
  const backup = createRuntimeBackup(data, root);
  assert.throws(() => inspectRuntimeBackup(backup), /会话记录无效|AI 私有/);
  data.close();
});

test('SQLite R04 模型逐次尝试与引用消息可重启回读并进入完整备份校验', async t => {
  const root = temporaryDirectory(t),
    file = path.join(root, 'local.sqlite');
  let data = createSqliteDataStore(file);
  const conversation = await data.aiConversationStore.createConversation({
    ownerId: 'demo',
    actorId: 'demo',
    spaceId: 'space-1'
  });
  const turn = await data.aiConversationStore.submitTurn({
    ownerId: 'demo',
    conversationId: conversation.conversationId,
    content: '合成提问',
    idempotencyKey: 'request-sqlite-r04'
  });
  const running = await data.aiConversationStore.claimTurn(turn.turnId);
  await data.aiConversationStore.createModelAttempt(turn.turnId, running.leaseGeneration, {
    attemptId: 'attempt-sqlite-r04',
    modelId: 'deepseek-flash',
    payloadHash: 'a'.repeat(64),
    reservedMicrounits: 1000
  });
  await data.aiConversationStore.advanceModelAttempt('attempt-sqlite-r04', 'reserved', {
    generation: running.leaseGeneration
  });
  await data.aiConversationStore.advanceModelAttempt('attempt-sqlite-r04', 'sent', {
    generation: running.leaseGeneration
  });
  await data.aiConversationStore.advanceModelAttempt('attempt-sqlite-r04', 'settled', { actualMicrounits: 100 });
  await data.aiConversationStore.completeTurn(turn.turnId, running.leaseGeneration, {
    content: '合成回答',
    sourceFree: true
  });
  const backup = createRuntimeBackup(data, root);
  assert.equal(inspectRuntimeBackup(backup).valid, true);
  data.close();
  data = createSqliteDataStore(file);
  assert.equal((await data.aiConversationStore.getTurn(turn.turnId)).status, 'succeeded');
  assert.equal((await data.aiConversationStore.listModelAttempts(turn.turnId))[0].actualMicrounits, 100);
  data.close();
});

test('SQLite Agent 检查点及持久工具请求重启回读，租约与单调预算计数保持', async t => {
  const root = temporaryDirectory(t),
    file = path.join(root, 'checkpoint.sqlite');
  let data = createSqliteDataStore(file);
  const store = data.aiConversationStore;
  const conversation = await store.createConversation({ ownerId: 'demo', actorId: 'demo', spaceId: 'space-1' });
  const turn = await store.submitTurn({
    ownerId: 'demo',
    conversationId: conversation.conversationId,
    content: '合成恢复场景',
    idempotencyKey: 'sqlite-checkpoint-1'
  });
  const running = await store.claimTurn(turn.turnId);
  await store.createModelAttempt(turn.turnId, running.leaseGeneration, {
    attemptId: 'sqlite-checkpoint-attempt',
    modelId: 'deepseek-flash',
    payloadHash: 'a'.repeat(64),
    reservedMicrounits: 1000
  });
  await store.advanceModelAttempt('sqlite-checkpoint-attempt', 'reserved', { generation: running.leaseGeneration });
  await store.advanceModelAttempt('sqlite-checkpoint-attempt', 'sent', { generation: running.leaseGeneration });
  const response = {
    content: '',
    json: null,
    toolCalls: [{ id: 'tool-1', name: 'notes_search', arguments: { query: '合成' } }],
    finishReason: 'tool_calls',
    truncated: false,
    refused: false,
    usage: { unknown: true }
  };
  await store.advanceModelAttempt('sqlite-checkpoint-attempt', 'unknown', {
    generation: running.leaseGeneration,
    modelResult: response
  });
  const checkpoint = { ...emptyAgentCheckpoint(), nextRound: 1, initialSearchDone: true, handledAttemptOrdinal: 1 };
  await store.saveCheckpoint(turn.turnId, running.leaseGeneration, checkpoint);
  await store.failTurn(turn.turnId, running.leaseGeneration, 'AI_TASK_INTERRUPTED');
  assert.equal(inspectRuntimeBackup(createRuntimeBackup(data, root)).valid, true);
  data.close();
  data = createSqliteDataStore(file);
  assert.deepEqual((await data.aiConversationStore.getTurn(turn.turnId)).checkpoint, checkpoint);
  assert.deepEqual((await data.aiConversationStore.listModelAttempts(turn.turnId))[0].modelResult, response);
  const resumed = await data.aiConversationStore.claimTurn(turn.turnId);
  assert.equal(resumed.leaseGeneration, 2);
  await assert.rejects(
    data.aiConversationStore.saveCheckpoint(turn.turnId, resumed.leaseGeneration, { ...checkpoint, nextRound: 0 }),
    { code: 'AI_CHECKPOINT_INVALID' }
  );
  data.close();
});

test('SQLite 持久拒绝响应跨重启仅显式重试推进，领取后崩溃不再回放', async t => {
  const root = temporaryDirectory(t),
    file = path.join(root, 'rejected.sqlite');
  let data = createSqliteDataStore(file);
  const store = data.aiConversationStore;
  const conversation = await store.createConversation({ ownerId: 'demo', actorId: 'demo', spaceId: 'space-1' });
  const turn = await store.submitTurn({
    ownerId: 'demo',
    conversationId: conversation.conversationId,
    content: '合成拒绝响应',
    idempotencyKey: 'sqlite-rejected-1'
  });
  const claimed = await store.claimTurn(turn.turnId);
  await store.createModelAttempt(turn.turnId, claimed.leaseGeneration, {
    attemptId: 'sqlite-rejected-attempt',
    modelId: 'deepseek-flash',
    payloadHash: 'a'.repeat(64),
    reservedMicrounits: 1000
  });
  await store.advanceModelAttempt('sqlite-rejected-attempt', 'reserved', { generation: claimed.leaseGeneration });
  await store.advanceModelAttempt('sqlite-rejected-attempt', 'sent', { generation: claimed.leaseGeneration });
  await store.advanceModelAttempt('sqlite-rejected-attempt', 'settled', {
    generation: claimed.leaseGeneration,
    actualMicrounits: 100,
    modelResult: { content: '截断回答', toolCalls: [], finishReason: 'length', truncated: true, refused: false }
  });
  await store.rejectModelResult(turn.turnId, claimed.leaseGeneration, 1, 'AI_OUTPUT_TRUNCATED');
  await store.failTurn(turn.turnId, claimed.leaseGeneration, 'AI_OUTPUT_TRUNCATED');
  data.close();
  data = createSqliteDataStore(file);
  assert.equal(
    (await data.aiConversationStore.listModelAttempts(turn.turnId))[0].responseRejectedCode,
    'AI_OUTPUT_TRUNCATED'
  );
  await assert.rejects(data.aiConversationStore.claimTurn(turn.turnId), { code: 'AI_RESPONSE_REJECTED' });
  const retry = await data.aiConversationStore.claimTurn(turn.turnId, 60000, { mode: 'retry' });
  assert.equal(retry.checkpoint.nextRound, 1);
  await data.aiConversationStore.failTurn(turn.turnId, retry.leaseGeneration, 'AI_TASK_INTERRUPTED');
  data.close();
  data = createSqliteDataStore(file);
  const resumed = await data.aiConversationStore.claimTurn(turn.turnId);
  assert.equal(resumed.checkpoint.nextRound, 1);
  assert.equal(resumed.checkpoint.handledAttemptOrdinal, 1);
  assert.equal((await data.aiConversationStore.listModelAttempts(turn.turnId)).length, 1);
  assert.equal(inspectRuntimeBackup(createRuntimeBackup(data, root)).valid, true);
  data.close();
});
