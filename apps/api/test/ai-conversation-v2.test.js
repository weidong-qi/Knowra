import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import { createPersistentAppContext } from '../src/app.factory.js';
import { createServer } from '../src/server.js';
import { aiRecords, insertAiRecords } from './ai-record-fixtures.js';
import { createEmptyAiState } from '../src/modules/ai/record-state.ts';
import { createJsonAiConversationStore } from '../src/modules/ai/conversation-store.js';
import { aiAgentCheckpointTests } from './ai-agent-checkpoint.test.js';

async function withStore(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-conversation-'));
  try {
    await run(createFileDataStore(path.join(root, 'data.json')), root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const source = {
  noteId: 'note-1',
  noteVersionId: 'version-1',
  contentHash: 'a'.repeat(64),
  start: 0,
  end: 4,
  quoteHash: 'b'.repeat(64)
};

export const aiConversationV2Tests = [
  ...aiAgentCheckpointTests,
  {
    name: 'R03 JSON 写盘失败不留下半条任务或消息',
    async run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-conversation-failure-'));
      try {
        let fail = false;
        const file = path.join(root, 'data.json');
        const data = createFileDataStore(file, {
          writeJson(target, value) {
            if (fail) throw new Error('simulated disk failure');
            fs.writeFileSync(target, JSON.stringify(value));
          }
        });
        const conversation = await data.aiConversationStore.createConversation({
          ownerId: 'demo',
          actorId: 'demo',
          spaceId: 'space-1'
        });
        fail = true;
        await assert.rejects(
          data.aiConversationStore.submitTurn({
            ownerId: 'demo',
            conversationId: conversation.conversationId,
            content: '不能半写',
            idempotencyKey: 'request-failure-1'
          }),
          { code: 'STORAGE_WRITE_FAILED' }
        );
        assert.deepEqual(await data.aiConversationStore.listMessages(conversation.conversationId), []);
        assert.deepEqual(await data.aiConversationStore.listTurns(conversation.conversationId), []);
        fail = false;
        const retried = await data.aiConversationStore.submitTurn({
          ownerId: 'demo',
          conversationId: conversation.conversationId,
          content: '不能半写',
          idempotencyKey: 'request-failure-1'
        });
        assert.equal((await data.aiConversationStore.listMessages(conversation.conversationId)).length, 1);
        assert.equal(
          (await createFileDataStore(file).aiConversationStore.getTurn(retried.turnId)).turnId,
          retried.turnId
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'R03 JSON 会话消息序号、请求幂等及重启回读与业务快照隔离',
    run: () =>
      withStore(async (data, root) => {
        const store = data.aiConversationStore;
        const conversation = await store.createConversation({
          ownerId: 'demo',
          actorId: 'demo',
          spaceId: 'space-1',
          conversationId: 'conversation-1'
        });
        const first = await store.submitTurn({
          ownerId: 'demo',
          conversationId: conversation.conversationId,
          content: '第一问',
          idempotencyKey: 'request-0001'
        });
        const replay = await store.submitTurn({
          ownerId: 'demo',
          conversationId: conversation.conversationId,
          content: '第一问',
          idempotencyKey: 'request-0001'
        });
        assert.equal(replay.turnId, first.turnId);
        await assert.rejects(
          store.submitTurn({
            ownerId: 'demo',
            conversationId: conversation.conversationId,
            content: '改写',
            idempotencyKey: 'request-0001'
          }),
          { code: 'AI_IDEMPOTENCY_CONFLICT' }
        );
        await assert.rejects(
          store.submitTurn({
            ownerId: 'demo',
            conversationId: conversation.conversationId,
            content: '第二问',
            idempotencyKey: 'request-0002'
          }),
          { code: 'AI_TURN_ACTIVE' }
        );
        const claimed = await store.claimTurn(first.turnId);
        await store.completeTurn(first.turnId, claimed.leaseGeneration, { content: '第一答', sourceFree: true });
        const second = await store.submitTurn({
          ownerId: 'demo',
          conversationId: conversation.conversationId,
          content: '第二问',
          idempotencyKey: 'request-0002'
        });
        assert.equal(second.ordinal, 2);
        assert.deepEqual(
          (await store.listMessages(conversation.conversationId)).map(row => row.sequence),
          [1, 2, 3]
        );
        assert.equal(JSON.stringify(data.exportSnapshot()).includes('第一问'), false);
        assert.equal(JSON.stringify(data.getSyncJournal()).includes('第一问'), false);
        const reopened = createFileDataStore(path.join(root, 'data.json'));
        assert.equal((await reopened.aiConversationStore.getTurn(second.turnId)).status, 'staged');
        assert.deepEqual(
          (await reopened.aiConversationStore.listMessages(conversation.conversationId, 1)).map(row => row.sequence),
          [2, 3]
        );
        reopened.importSnapshot(reopened.exportSnapshot());
        assert.equal(
          (await reopened.aiConversationStore.getConversation(conversation.conversationId)).conversationId,
          conversation.conversationId
        );
        await assert.rejects(
          reopened.aiConversationStore.submitTurn({
            ownerId: 'demo',
            conversationId: conversation.conversationId,
            content: '旧会话',
            idempotencyKey: 'request-0003'
          }),
          { code: 'AI_DATASET_STALE' }
        );
      })
  },
  {
    name: 'R03 执行租约、工具 call/result 与失败恢复拒绝迟到结果',
    async run() {
      let clock = new Date('2026-09-27T00:00:00.000Z');
      const state = createEmptyAiState();
      const store = createJsonAiConversationStore(
        { getState: () => state, runTransaction: action => action(), onChange() {} },
        { now: () => clock }
      );
      const conversation = await store.createConversation({ ownerId: 'demo', actorId: 'demo', spaceId: 'space-1' });
      const turn = await store.submitTurn({
        ownerId: 'demo',
        conversationId: conversation.conversationId,
        content: '阅读笔记',
        idempotencyKey: 'request-0004'
      });
      const first = await store.claimTurn(turn.turnId, 1000);
      await store.setPhase(turn.turnId, first.leaseGeneration, 'retrieving');
      const call = await store.appendToolCall(turn.turnId, first.leaseGeneration, {
        callId: 'call-1',
        toolName: 'notes_read',
        argumentsJson: { noteId: 'note-1' }
      });
      assert.equal(call.ordinal, 1);
      clock = new Date('2026-09-27T00:00:02.000Z');
      assert.deepEqual(await store.recoverInterrupted(), [turn.turnId]);
      await assert.rejects(
        store.settleToolCall(turn.turnId, first.leaseGeneration, 'call-1', { resultJson: { content: '迟到正文' } }),
        { code: 'AI_LEASE_STALE' }
      );
      const resumed = await store.claimTurn(turn.turnId);
      assert.equal(resumed.leaseGeneration, 2);
      await store.settleToolCall(turn.turnId, resumed.leaseGeneration, 'call-1', {
        resultJson: { noteId: 'note-1' },
        sourceRefs: [source]
      });
      await store.bindToolResultManifest(turn.turnId, resumed.leaseGeneration, 'call-1', 'manifest-tool-1');
      await assert.rejects(
        store.bindToolResultManifest(turn.turnId, resumed.leaseGeneration, 'call-1', 'manifest-other'),
        { code: 'AI_IDEMPOTENCY_CONFLICT' }
      );
      await assert.rejects(
        store.completeTurn(turn.turnId, resumed.leaseGeneration, { content: '无清单回答', sourceRefs: [source] }),
        { code: 'AI_SOURCE_REQUIRED' }
      );
      await store.completeTurn(turn.turnId, resumed.leaseGeneration, {
        content: '有来源回答',
        sourceRefs: [source],
        provenanceManifestId: 'manifest-1'
      });
      assert.equal((await store.listToolCalls(turn.turnId))[0].status, 'succeeded');
      assert.deepEqual(
        (await store.listMessages(conversation.conversationId)).map(row => row.sequence),
        [1, 2]
      );
      await assert.rejects(store.failTurn(turn.turnId, resumed.leaseGeneration, 'AI_FAILED'), {
        code: 'AI_LEASE_STALE'
      });
      const another = await store.submitTurn({
        ownerId: 'demo',
        conversationId: conversation.conversationId,
        content: '取消',
        idempotencyKey: 'request-0005'
      });
      const running = await store.claimTurn(another.turnId);
      await store.cancelTurn(another.turnId);
      await assert.rejects(
        store.completeTurn(another.turnId, running.leaseGeneration, { content: '迟到回答', sourceFree: true }),
        { code: 'AI_LEASE_STALE' }
      );
    }
  },
  {
    name: 'R03 HTTP 会话权限、持久回看及 v1 历史任务只读',
    async run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-conversation-http-'));
      try {
        const context = createPersistentAppContext({ storageRootDir: root, ownerId: 'demo' });
        const space = context.http.knowledge.createDefaultKnowledgeSpace({});
        context.modules.knowledge.repositories.knowledgeSpaceRepository.save({
          id: 'space-1',
          userId: 'demo',
          name: '历史空间'
        });
        context.modules.knowledge.repositories.knowledgeSpaceRepository.save({
          id: 'space-other',
          userId: 'other',
          name: '他人空间'
        });
        const old = aiRecords(context.ai.repository.identity());
        insertAiRecords(context.ai.repository, old);
        const server = createServer({ appContext: context, logger: { warn() {}, error() {} } });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
          const base = `http://127.0.0.1:${server.address().port}/api/ai/conversations`;
          const request = async (route, body) => {
            const response = await fetch(
              `${base}${route}`,
              body === undefined
                ? undefined
                : {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Knowra-AI-Conversation': '1' },
                    body: JSON.stringify(body)
                  }
            );
            return { status: response.status, payload: await response.json() };
          };
          const created = await request('', { spaceId: space.id, conversationId: 'conversation-http' });
          assert.equal(created.status, 201);
          assert.equal((await request('', { spaceId: 'space-other' })).status, 403);
          const staged = await request('/conversation-http/messages', {
            content: '你好',
            idempotencyKey: 'request-http-1'
          });
          assert.equal(staged.status, 202);
          assert.equal(staged.payload.data.executionAvailable, false);
          assert.equal((await request('/conversation-http/messages')).payload.data[0].content, '你好');
          assert.equal(
            (await request(`/conversation-http/turns/${staged.payload.data.turnId}`)).payload.data.status,
            'staged'
          );
          assert.equal(
            (await request(`/conversation-http/turns/${staged.payload.data.turnId}/cancel`, {})).payload.data.status,
            'cancelled'
          );
          assert.equal((await request('/legacy-jobs?spaceId=space-1')).payload.data[0].readOnly, true);
          const legacy = await request(`/legacy-jobs/${old.job.jobId}`);
          assert.equal(legacy.status, 200);
          assert.equal(legacy.payload.data.contractVersion, 1);
          assert.equal(legacy.payload.data.diagnostics.length, 1);
          assert.equal((await request(`/legacy-jobs/${old.job.jobId}/cancel`, {})).status, 404);
          context.dataStore.importSnapshot(context.dataStore.exportSnapshot());
          const historical = await request(`/legacy-jobs/${old.job.jobId}`);
          assert.equal(historical.status, 200);
          assert.equal(historical.payload.data.historicalDataset, true);
          assert.equal((await request(`?spaceId=${space.id}`)).payload.data[0].readOnly, true);
          assert.equal(
            (await request('/conversation-http/messages', { content: '旧会话继续', idempotencyKey: 'request-http-2' }))
              .status,
            409
          );
          assert.equal((await request('/unknown')).status, 404);
        } finally {
          await new Promise(resolve => server.close(resolve));
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
];
