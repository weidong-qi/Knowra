import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import { createInMemoryNoteRepository } from '../src/modules/knowledge/infrastructure/note-repository.js';
import { createInMemoryNoteVersionRepository } from '../src/modules/knowledge/infrastructure/note-version-repository.ts';
import { createInMemoryFolderRepository } from '../src/modules/knowledge/infrastructure/folder-repository.ts';
import { createInMemoryKnowledgeSpaceRepository } from '../src/modules/knowledge/infrastructure/knowledge-space-repository.ts';
import { NoteVersion } from '../src/modules/knowledge/domain/note-version.ts';
import { createAiAccessService } from '../src/modules/ai/access-service.js';
import { createAiAgentWorker } from '../src/modules/ai/agent-worker.js';
import { createAuthorizedKeywordSearch } from '../src/modules/ai/keyword-search.ts';
import { createAiConversationService } from '../src/modules/ai/conversation-service.js';
import { beijingDay } from '../src/modules/ai/budget-ledger.js';
import { createServer } from '../src/server.js';
import { createPersistentAppContext } from '../src/app.factory.js';
import { calculateContentHash } from '../src/modules/knowledge/domain/note-version.ts';
import { createEmptyAiState, validateAiState } from '../src/modules/ai/record-state.ts';

const priceProfile = {
  version: 'r04-test-price',
  modelId: 'deepseek-flash',
  expiresAt: '2030-01-01T00:00:00.000Z',
  inputMicrounitsPerMillion: 2_000_000,
  outputMicrounitsPerMillion: 8_000_000
};
const usage = { inputTokens: 10, outputTokens: 10, unknown: false };
const answer = (content, json = null) => ({
  content,
  json,
  toolCalls: [],
  finishReason: 'stop',
  truncated: false,
  refused: false,
  usage
});

async function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-agent-r04-'));
  try {
    const data = createFileDataStore(path.join(root, 'data.json'));
    const noteRepository = createInMemoryNoteRepository();
    const noteVersionRepository = createInMemoryNoteVersionRepository();
    const folderRepository = createInMemoryFolderRepository();
    const spaceRepository = createInMemoryKnowledgeSpaceRepository();
    spaceRepository.save({ id: 'space-1', userId: 'demo', name: '我的空间' });
    const access = createAiAccessService({
      store: data.aiAccessStore,
      noteRepository,
      noteVersionRepository,
      folderRepository,
      spaceRepository,
      ownerId: 'demo'
    });
    const addNote = (id, content) => {
      noteRepository.save({
        id,
        spaceId: 'space-1',
        folderId: null,
        title: id,
        rawMarkdown: content,
        deleted: false,
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      noteVersionRepository.save(new NoteVersion({ id: `version-${id}`, noteId: id, content }));
    };
    const policy = async noteIds =>
      access.createPolicy({
        spaceId: 'space-1',
        scope: { kind: 'fixed', noteIds },
        excludedNoteIds: [],
        includeAttachments: false,
        read: true,
        egress: true,
        recipients: ['deepseek'],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString()
      });
    const conversation = await data.aiConversationStore.createConversation({
      ownerId: 'demo',
      actorId: 'demo',
      spaceId: 'space-1'
    });
    const submit = (content, idempotencyKey, requestedPolicyId = null) =>
      data.aiConversationStore.submitTurn({
        ownerId: 'demo',
        conversationId: conversation.conversationId,
        content,
        idempotencyKey,
        requestedPolicyId
      });
    const worker = gateway =>
      createAiAgentWorker({
        store: data.aiConversationStore,
        access,
        modelSettings: { credentialReference: async () => ({ modelId: 'deepseek-flash', credentialRef: 'synthetic' }) },
        budget: data.aiBudgetAuthority,
        gateway,
        priceProfile
      });
    await run({ data, access, addNote, policy, conversation, submit, worker, noteRepository });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export const aiAgentR04Tests = [
  {
    name: 'Agent 请求上下文：mock 捕获普通历史转授权问题的逐字文本与历史字段',
    run: () =>
      withFixture(async ({ addNote, policy, submit, worker }) => {
        addNote('context-note', '合成资料');
        const selected = await policy(['context-note']);
        const requests = [];
        const agent = worker({
          capabilities: () => ({ provider: 'mock' }),
          async complete(request) {
            requests.push(request);
            return requests.length === 1 ? answer('前轮普通回答') : answer('', { answer: '授权回答', citations: [] });
          }
        });
        await agent.run((await submit('你好', 'context-plain')).turnId);
        assert.equal(requests[0].messages.at(-1).content, '你好');
        await agent.run((await submit('接着讨论', 'context-authorized', selected.policyId)).turnId);
        const body = JSON.parse(requests[1].messages.at(-1).content);
        assert.equal(
          body.question,
          '先前普通聊天：助手：前轮普通回答\n接着讨论\n真实联网尚未配置，核实时不能假称已联网。'
        );
        assert.deepEqual(requests[1].messages.slice(1, -1), [{ role: 'user', content: '你好' }]);
      })
  },
  {
    name: 'Agent 无效引用响应持久拒绝后显式重试生成有效回答，领取后崩溃不重复回放旧响应',
    run: () =>
      withFixture(async ({ data, addNote, policy, submit, worker }) => {
        addNote('rejected-citation-note', '光合作用需要阳光');
        const selected = await policy(['rejected-citation-note']);
        const turn = await submit('根据我的笔记解释光合作用', 'rejected-citation-retry', selected.policyId);
        let deliveries = 0;
        const agent = worker({
          capabilities: () => ({ provider: 'mock' }),
          async complete() {
            deliveries++;
            // 回合内会先让模型修正一次引文，所以前两次都无效才会持久拒绝。
            return deliveries <= 2
              ? answer('', { answer: '无效回答', citations: [{ sourceId: 'S1', quote: '不存在的来源句子' }] })
              : answer('', { answer: '光合作用需要阳光。', citations: [] });
          }
        });
        await assert.rejects(agent.run(turn.turnId), { code: 'AI_CITATION_INVALID' });
        assert.equal(
          (await data.aiConversationStore.listModelAttempts(turn.turnId))[0].responseRejectedCode,
          'AI_CITATION_INVALID'
        );
        await assert.rejects(agent.run(turn.turnId), { code: 'AI_RESPONSE_REJECTED' });
        assert.equal(deliveries, 2);
        const claimed = await data.aiConversationStore.claimTurn(turn.turnId, 60000, { mode: 'retry' });
        await data.aiConversationStore.failTurn(turn.turnId, claimed.leaseGeneration, 'AI_TASK_INTERRUPTED');
        await agent.run(turn.turnId);
        assert.equal(deliveries, 3);
        assert.equal((await data.aiConversationStore.getTurn(turn.turnId)).checkpoint.nextRound, 2);
        assert.equal((await data.aiConversationStore.getTurn(turn.turnId)).status, 'succeeded');
        const attempts = await data.aiConversationStore.listModelAttempts(turn.turnId);
        assert.equal(attempts.length, 3);
        assert.equal(attempts[0].actualMicrounits, attempts[1].actualMicrounits);
      })
  },
  {
    name: 'R04 v3 私有状态仅补逐次模型尝试空集合',
    async run() {
      const old = createEmptyAiState();
      old.version = 3;
      delete old.conversationModelAttempts;
      delete old.actionLedger;
      delete old.conversationAttachments;
      const upgraded = validateAiState(old);
      assert.equal(upgraded.version, 6);
      assert.deepEqual(upgraded.conversationModelAttempts, []);
      assert.deepEqual(upgraded.conversations, old.conversations);
    }
  },
  {
    name: 'R04 关键词检索按授权当前版本过滤并保持规范化文本原始偏移',
    run: () =>
      withFixture(async ({ access, addNote, policy, conversation }) => {
        addNote('allowed-note', '😀ＡＢＣ 相关内容');
        addNote('excluded-note', 'ＡＢＣ 私有内容');
        const selected = await policy(['allowed-note']);
        const grant = await access.createRunGrant({
          policyId: selected.policyId,
          conversationId: conversation.conversationId
        });
        const found = await createAuthorizedKeywordSearch({ access }).search({ grantId: grant.grantId, query: 'ABC' });
        assert.deepEqual(
          found.hits.map(hit => hit.noteId),
          ['allowed-note']
        );
        const hit = found.hits[0];
        assert.equal(hit.ref.quoteHash, calculateContentHash(hit.text));
        assert.equal(hit.text, '😀ＡＢＣ 相关内容');
        const broader = await policy(['allowed-note', 'excluded-note']);
        const broaderGrant = await access.createRunGrant({
          policyId: broader.policyId,
          conversationId: conversation.conversationId
        });
        const capped = await createAuthorizedKeywordSearch({ access, maxCandidates: 1 }).search({
          grantId: broaderGrant.grantId,
          query: 'ABC'
        });
        assert.equal(capped.truncated, true);
        const oversize = await createAuthorizedKeywordSearch({ access, maxNoteChars: 1 }).search({
          grantId: grant.grantId,
          query: 'ABC'
        });
        assert.equal(oversize.truncated, true);
        assert.deepEqual(oversize.hits, []);
        await access.narrowPolicy(selected.policyId, { revision: 1, revoke: true });
        await assert.rejects(
          createAuthorizedKeywordSearch({ access }).search({ grantId: grant.grantId, query: 'ABC' }),
          { code: 'AI_ACCESS_REVOKED' }
        );
      })
  },
  {
    name: 'R04 普通聊天不需要笔记授权，多轮继续且逐次模型费用落盘',
    run: () =>
      withFixture(async ({ data, conversation, submit, worker }) => {
        const requests = [];
        const agent = worker({
          capabilities: () => ({ provider: 'mock' }),
          async complete(request) {
            requests.push(request);
            return answer(requests.length === 1 ? '你好，可以继续提问。' : '第二轮回答。');
          }
        });
        const first = await submit('你好', 'plain-001');
        await agent.run(first.turnId);
        const second = await submit('继续说', 'plain-002');
        await agent.run(second.turnId);
        assert.equal(requests.length, 2);
        assert(
          requests[1].messages.some(
            message => message.role === 'assistant' && message.content === '你好，可以继续提问。'
          )
        );
        assert.deepEqual(
          (await data.aiConversationStore.listMessages(conversation.conversationId)).map(row => row.sourceFree),
          [true, true, true, true]
        );
        assert.deepEqual(
          (await data.aiConversationStore.listModelAttempts()).map(row => row.status),
          ['settled', 'settled']
        );
        assert(data.aiBudgetAuthority.status('deepseek-primary', beijingDay(new Date())).spentMicrounits > 0);
      })
  },
  {
    name: 'R04 授权检索和补查保留工具轨迹、实际引用，撤销后阻止下一轮外发',
    run: () =>
      withFixture(async ({ data, access, addNote, policy, conversation, submit, worker }) => {
        addNote('green-note', '光合作用需要阳光和水，产生氧气。');
        addNote('private-note', '私人资料绝不能外发。');
        const selected = await policy(['green-note']);
        const requests = [];
        const agent = worker({
          capabilities: () => ({ provider: 'mock' }),
          async complete(request) {
            requests.push(request);
            if (requests.length === 1)
              return {
                ...answer(''),
                content: '',
                finishReason: 'tool_calls',
                toolCalls: [{ id: 'search-1', name: 'notes_search', arguments: { query: '光合作用', limit: 2 } }]
              };
            return answer('', {
              answer: '笔记说明光合作用需要阳光和水。',
              citations: [{ sourceId: 'S1', quote: '光合作用需要阳光和水' }]
            });
          }
        });
        const first = await submit('根据我的笔记解释光合作用', 'scope-001', selected.policyId);
        await agent.run(first.turnId);
        const calls = await data.aiConversationStore.listToolCalls(first.turnId);
        const messages = await data.aiConversationStore.listMessages(conversation.conversationId);
        assert.equal(calls.length, 2);
        assert.deepEqual(
          calls.map(call => call.status),
          ['succeeded', 'succeeded']
        );
        assert(calls.every(call => call.resultJson.hits[0].noteId === 'green-note'));
        assert(calls.every(call => call.provenanceManifestId));
        assert.deepEqual(requests[1].tools, []);
        assert.equal(messages[1].citations[0].noteId, 'green-note');
        assert.equal(messages[1].sourceFree, false);
        assert(!JSON.stringify(requests).includes('私人资料绝不能外发'));
        await access.narrowPolicy(selected.policyId, { revision: 1, revoke: true });
        const next = await submit('继续根据我的笔记解释', 'scope-002', selected.policyId);
        await assert.rejects(agent.run(next.turnId), { code: 'AI_ACCESS_REVOKED' });
        assert.equal(requests.length, 2);
        assert.equal((await data.aiConversationStore.getTurn(next.turnId)).status, 'failed');
      })
  },
  {
    name: 'R04 阅读工具裁剪模型过长范围并把越权调用记为失败结果',
    run: () =>
      withFixture(async ({ data, addNote, policy, submit, worker }) => {
        addNote('read-note', '😀合成来源文字。');
        addNote('outside-note', '绝不能读取');
        const selected = await policy(['read-note']);
        let round = 0;
        const agent = worker({
          capabilities: () => ({ provider: 'mock' }),
          async complete() {
            round++;
            if (round === 1)
              return {
                ...answer(''),
                finishReason: 'tool_calls',
                toolCalls: [
                  { id: 'read-allowed', name: 'notes_read', arguments: { noteId: 'read-note', start: 0, end: 1000 } },
                  { id: 'read-denied', name: 'notes_read', arguments: { noteId: 'outside-note' } }
                ]
              };
            return answer('', { answer: '来源指出合成内容。', citations: [{ sourceId: 'S1', quote: '合成来源文字' }] });
          }
        });
        const turn = await submit('请阅读指定合成笔记', 'read-001', selected.policyId);
        await agent.run(turn.turnId);
        const calls = await data.aiConversationStore.listToolCalls(turn.turnId);
        assert.deepEqual(
          calls.map(call => call.status),
          ['succeeded', 'succeeded', 'failed']
        );
        assert.equal(calls[0].toolName, 'notes_search');
        assert.equal(calls[1].resultJson.text, '😀合成来源文字。');
        assert.equal(calls[2].errorCode, 'AI_SCOPE_FORBIDDEN');
        assert.equal((await data.aiConversationStore.getTurn(turn.turnId)).status, 'succeeded');
      })
  },
  {
    name: 'R04 无命中回答可声明无引用，授权清单仍保留并支持追问',
    run: () =>
      withFixture(async ({ data, addNote, policy, conversation, submit, worker }) => {
        addNote('other-note', '完全不相关的内容。');
        const selected = await policy(['other-note']);
        const agent = worker({
          capabilities: () => ({ provider: 'mock' }),
          async complete() {
            return answer('', { answer: '当前授权资料没有足够信息。', citations: [] });
          }
        });
        const first = await submit('我的笔记有量子纠缠吗', 'empty-001', selected.policyId);
        await agent.run(first.turnId);
        const messages = await data.aiConversationStore.listMessages(conversation.conversationId);
        assert.equal(messages[1].sourceFree, true);
        assert(messages[1].provenanceManifestId);
        const followup = await submit('继续说说缺少什么', 'empty-002', selected.policyId);
        await agent.run(followup.turnId);
        assert.equal((await data.aiConversationStore.getTurn(followup.turnId)).status, 'succeeded');
      })
  },
  {
    name: 'R04 扫描预算受限时模型收到通用覆盖说明，工具结果保持既有字段',
    run: () =>
      withFixture(async ({ data, access, addNote, policy, submit, worker }) => {
        addNote('scan-first', '普通记录甲');
        addNote('scan-last', '普通记录乙');
        const selected = await policy(['scan-first', 'scan-last']);
        const select = access.findAuthorizedSearchCandidates;
        access.findAuthorizedSearchCandidates = input => select({ ...input, maxScanNotes: 1 });
        const requests = [];
        const agent = worker({
          capabilities: () => ({ provider: 'mock' }),
          async complete(request) {
            requests.push(request);
            return answer('', { answer: '当前检索范围没有足够信息。', citations: [] });
          }
        });
        const turn = await submit('根据我的笔记解释 coveragetoken', 'coverage-limit-001', selected.policyId);
        await agent.run(turn.turnId);
        const calls = await data.aiConversationStore.listToolCalls(turn.turnId);
        assert.equal(calls[0].resultJson.truncated, true);
        assert.equal(calls[0].resultJson.inspected, 0);
        assert.equal(calls[0].resultJson.mode, 'keyword');
        assert(!Object.hasOwn(calls[0].resultJson, 'coverage'));
        assert(
          requests[0].messages.some(
            message =>
              message.role === 'user' &&
              message.content.includes('检索受到本次处理上限限制，不得声称已检查完整授权范围。')
          )
        );
        assert.equal((await data.aiConversationStore.getTurn(turn.turnId)).status, 'succeeded');
      })
  },
  {
    name: 'R04 伪造来源引用拒绝入库，但已知模型费用照实结算',
    run: () =>
      withFixture(async ({ data, addNote, policy, conversation, submit, worker }) => {
        addNote('source-note', '真实资料只能引用原文。');
        const selected = await policy(['source-note']);
        const agent = worker({
          capabilities: () => ({ provider: 'mock' }),
          async complete() {
            return answer('', { answer: '伪造答案', citations: [{ sourceId: 'S1', quote: '资料中不存在的原文' }] });
          }
        });
        const turn = await submit('根据我的笔记解释真实资料', 'forged-001', selected.policyId);
        await assert.rejects(agent.run(turn.turnId), { code: 'AI_CITATION_INVALID' });
        assert.equal((await data.aiConversationStore.getTurn(turn.turnId)).status, 'failed');
        assert.equal((await data.aiConversationStore.listMessages(conversation.conversationId)).length, 1);
        assert.equal((await data.aiConversationStore.listModelAttempts(turn.turnId))[0].status, 'settled');
      })
  },
  {
    name: 'R04 取消在途请求拒收迟到回答且已知费用仍结算',
    run: () =>
      withFixture(async ({ data, submit, worker }) => {
        let release, entered;
        const called = new Promise(resolve => {
          entered = resolve;
        });
        const agent = worker({
          capabilities: () => ({ provider: 'mock' }),
          async complete() {
            entered();
            return new Promise(resolve => {
              release = () => resolve(answer('迟到回答'));
            });
          }
        });
        const turn = await submit('取消这次', 'cancel-001');
        const running = agent.run(turn.turnId);
        await called;
        await data.aiConversationStore.cancelTurn(turn.turnId);
        agent.cancel(turn.turnId);
        release();
        await assert.rejects(running, { code: 'AI_CANCELLED' });
        assert.equal((await data.aiConversationStore.getTurn(turn.turnId)).status, 'cancelled');
        assert.equal((await data.aiConversationStore.listModelAttempts(turn.turnId))[0].status, 'settled');
        assert.equal(
          (
            await data.aiConversationStore.listMessages(
              (await data.aiConversationStore.getTurn(turn.turnId)).conversationId
            )
          ).length,
          1
        );
      })
  },
  {
    name: 'R04 重启后未结算尝试保守占额，并允许显式重试',
    run: () =>
      withFixture(async ({ data, submit, worker }) => {
        const turn = await submit('发生中断', 'recover-001');
        const claimed = await data.aiConversationStore.claimTurn(turn.turnId, 1000);
        const attemptId = 'recover-attempt-1';
        await data.aiConversationStore.createModelAttempt(turn.turnId, claimed.leaseGeneration, {
          attemptId,
          modelId: 'deepseek-flash',
          payloadHash: 'a'.repeat(64),
          reservedMicrounits: 1000
        });
        const budget = data.aiBudgetAuthority.reserve({
          accountRef: 'deepseek-primary',
          jobId: turn.turnId,
          attemptId,
          priceVersion: priceProfile.version,
          reservedMicrounits: 1000,
          day: beijingDay(new Date())
        });
        assert.equal(budget.reservedMicrounits, 1000);
        await data.aiConversationStore.advanceModelAttempt(attemptId, 'reserved', {
          generation: claimed.leaseGeneration
        });
        const agent = worker({
          capabilities: () => ({ provider: 'mock' }),
          async complete() {
            return answer('重试成功');
          }
        });
        await new Promise(resolve => setTimeout(resolve, 1100));
        assert.equal(await agent.recover(), 1);
        assert.equal((await data.aiConversationStore.listModelAttempts(turn.turnId))[0].status, 'unknown');
        assert.equal(data.aiBudgetAuthority.status('deepseek-primary', beijingDay(new Date())).heldMicrounits, 1000);
        await assert.rejects(agent.run(turn.turnId), { code: 'AI_DELIVERY_UNCERTAIN' });
        await agent.retry(turn.turnId);
        assert.equal((await data.aiConversationStore.getTurn(turn.turnId)).status, 'succeeded');
        assert.deepEqual(
          (await data.aiConversationStore.listModelAttempts(turn.turnId)).map(row => row.status),
          ['unknown', 'settled']
        );
      })
  },
  {
    name: 'Agent 工具成功后检查点写盘中断，续跑复用持久响应及工具结果不再计费搜索',
    run: () =>
      withFixture(async ({ data, addNote, policy, submit, worker }) => {
        addNote('checkpoint-note', '光合作用把光能转为化学能');
        const selected = await policy(['checkpoint-note']);
        const turn = await submit('解释光合作用', 'checkpoint-worker-1', selected.policyId);
        const store = data.aiConversationStore,
          save = store.saveCheckpoint.bind(store);
        let crashed = false,
          deliveries = 0;
        store.saveCheckpoint = async (...args) => {
          if (!crashed && args[2].nextRound === 1) {
            crashed = true;
            throw Object.assign(new Error('synthetic checkpoint disk interruption'), { code: 'AI_TASK_FAILED' });
          }
          return save(...args);
        };
        const gateway = {
          capabilities: () => ({ provider: 'mock' }),
          async complete() {
            deliveries++;
            return deliveries === 1
              ? {
                  ...answer(''),
                  finishReason: 'tool_calls',
                  toolCalls: [
                    { id: 'checkpoint-search', name: 'notes_search', arguments: { query: '光合作用', limit: 1 } }
                  ]
                }
              : answer('', { answer: '光合作用把光能转为化学能。', citations: [] });
          }
        };
        await assert.rejects(worker(gateway).run(turn.turnId), { code: 'AI_TASK_FAILED' });
        assert.equal(deliveries, 1);
        assert.equal((await store.listToolCalls(turn.turnId)).length, 1);
        await worker(gateway).run(turn.turnId);
        assert.equal(deliveries, 2);
        assert.equal((await store.listToolCalls(turn.turnId)).length, 1);
        assert.equal((await store.listModelAttempts(turn.turnId)).length, 2);
        assert.equal((await store.getTurn(turn.turnId)).status, 'succeeded');
      })
  },
  {
    name: 'Agent 检查点来源变私密后续跑拒绝，不重发保存的响应或原文',
    run: () =>
      withFixture(async ({ data, addNote, policy, submit, worker, noteRepository }) => {
        addNote('checkpoint-private-note', '光合作用私有候选资料');
        const selected = await policy(['checkpoint-private-note']);
        const turn = await submit('解释光合作用', 'checkpoint-private-1', selected.policyId);
        const store = data.aiConversationStore,
          save = store.saveCheckpoint.bind(store);
        let crashed = false,
          deliveries = 0;
        store.saveCheckpoint = async (...args) => {
          const saved = await save(...args);
          if (!crashed && args[2].nextRound === 1) {
            crashed = true;
            throw Object.assign(new Error('synthetic process interruption'), { code: 'AI_TASK_FAILED' });
          }
          return saved;
        };
        const gateway = {
          capabilities: () => ({ provider: 'mock' }),
          async complete() {
            deliveries++;
            return {
              ...answer(''),
              finishReason: 'tool_calls',
              toolCalls: [
                { id: 'checkpoint-private-search', name: 'notes_search', arguments: { query: '光合作用', limit: 1 } }
              ]
            };
          }
        };
        await assert.rejects(worker(gateway).run(turn.turnId), { code: 'AI_TASK_FAILED' });
        const note = noteRepository.findById('checkpoint-private-note');
        noteRepository.save({ ...note, aiVisibility: 'private' });
        await assert.rejects(worker(gateway).run(turn.turnId), error =>
          ['AI_NOTE_PRIVATE', 'AI_SCOPE_FORBIDDEN', 'AI_SOURCE_STALE', 'AI_SOURCE_PRIVATE'].includes(error.code)
        );
        assert.equal(deliveries, 1);
      })
  },
  {
    name: 'R04 HTTP 显式 execute、重试与取消只触发指定会话任务',
    async run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-agent-http-'));
      const context = createPersistentAppContext({ storageRootDir: root, ownerId: 'demo' });
      const space = context.http.knowledge.createDefaultKnowledgeSpace({});
      const runIds = [],
        cancelIds = [];
      context.ai.conversation = createAiConversationService({
        store: context.ai.conversationStore,
        legacyRepository: context.ai.repository,
        accessStore: context.dataStore.aiAccessStore,
        spaceRepository: context.modules.knowledge.repositories.knowledgeSpaceRepository,
        ownerId: 'demo',
        agent: {
          run: async id => {
            runIds.push(id);
          },
          cancel: id => cancelIds.push(id)
        }
      });
      const server = createServer({ appContext: context, logger: { warn() {} } });
      try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${server.address().port}/api/ai/conversations`;
        const post = async (route, body) => {
          const response = await fetch(`${base}${route}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-knowra-ai-conversation': '1' },
            body: JSON.stringify(body)
          });
          return { status: response.status, data: (await response.json()).data };
        };
        const created = await post('', { spaceId: space.id });
        const id = created.data.conversationId;
        const staged = await post(`/${id}/messages`, { content: '合成问题', idempotencyKey: 'http-r04-1' });
        assert.equal(staged.data.executionAvailable, false);
        assert.deepEqual(runIds, []);
        const executed = await post(`/${id}/messages`, {
          content: '合成问题',
          idempotencyKey: 'http-r04-1',
          execute: true
        });
        assert.equal(executed.status, 202);
        assert.equal(executed.data.turnId, staged.data.turnId);
        assert.deepEqual(runIds, [staged.data.turnId]);
        const retry = await post(`/${id}/turns/${staged.data.turnId}/retry`, {});
        assert.equal(retry.status, 202);
        assert.deepEqual(runIds, [staged.data.turnId, staged.data.turnId]);
        assert.equal((await post(`/${id}/turns/${staged.data.turnId}/cancel`, {})).data.status, 'cancelled');
        assert.deepEqual(cancelIds, [staged.data.turnId]);
        assert.equal((await post(`/${id}/turns/${staged.data.turnId}/retry`, {})).status, 409);
      } finally {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
];
