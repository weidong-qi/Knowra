import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import { createPersistentAppContext } from '../src/app.factory.js';
import { createOptionalAiRuntime } from '../src/modules/ai/runtime.js';
import { buildKnowledgeProposalPlan, proposeKnowledge } from '../src/modules/ai/knowledge-propose-tool.ts';
import { requestsKnowledgeProposal } from '../src/modules/ai/assistant-tools.ts';
import { proposalProgress } from '../src/modules/ai/agent-worker.ts';
import { markParagraphs } from './fixtures/inline-annotation-seed.js';
import { createAgentKnowledgeCommitService } from '../src/modules/ai/agent-knowledge-commit.ts';
import {
  createCoreOperationReceipt,
  validateCoreOperationReceipt
} from '../src/infrastructure/core-operation-contract.ts';

const priceProfile = {
  version: 'propose-synthetic-v1',
  modelId: 'deepseek-flash',
  expiresAt: '2030-01-01T00:00:00Z',
  inputMicrounitsPerMillion: 2000000,
  outputMicrounitsPerMillion: 8000000
};
const tool = (name, args, id = name) => ({
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
      }
    }
  ],
  usage: { prompt_tokens: 10, completion_tokens: 10 }
});
const answer = (content, citations = null) => ({
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: citations === null ? content : JSON.stringify({ answer: content, citations })
      }
    }
  ],
  usage: { prompt_tokens: 10, completion_tokens: 10 }
});

const MARKDOWN = '数据增强通过变换样本增加训练变化。\n\n过拟合指模型在训练集表现好而泛化差。';
const Q1 = '数据增强通过变换样本增加训练变化。',
  Q2 = '过拟合指模型在训练集表现好而泛化差。';
const at = quote => MARKDOWN.indexOf(quote);
const proposal = (noteId, overrides = {}) => ({
  candidates: [
    {
      title: '数据增强',
      canonicalStatement: Q1,
      knowledgeType: 'concept',
      citations: [{ noteId, start: at(Q1), end: at(Q1) + Q1.length, quote: Q1 }],
      ...overrides
    }
  ]
});

async function fixture(run, { knowledgeProposals = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-knowledge-propose-'));
  let runtime;
  try {
    const app = createPersistentAppContext({ storageRootDir: root, ownerId: 'test' });
    const space = app.http.knowledge.createDefaultKnowledgeSpace();
    const requests = [];
    let respond = () => answer('完成');
    const providerAdapter = {
      provider: 'mock',
      capabilities: () => ({ provider: 'mock' }),
      async *stream() {},
      async complete(request) {
        requests.push(request);
        return respond(request);
      }
    };
    runtime = createOptionalAiRuntime({
      modelSettings: {
        credentialReference: async () => ({ modelId: 'deepseek-flash', credentialRef: 'synthetic' }),
        resolveCredential: async () => {
          throw new Error('Synthetic scenarios must not resolve real credentials');
        }
      },
      providerAdapter,
      repository: app.dataStore.aiRepository,
      accessStore: app.dataStore.aiAccessStore,
      conversationStore: app.dataStore.aiConversationStore,
      actionStore: app.dataStore.aiActionStore,
      coreOperationStore: app.coreOperationStore,
      knowledge: app.modules.knowledge,
      budgetAuthority: app.dataStore.aiBudgetAuthority,
      priceProfile,
      knowledgeProposals,
      contextSources: {
        ...app.modules.knowledge.repositories,
        spaceRepository: app.modules.knowledge.repositories.knowledgeSpaceRepository,
        ownerId: 'test'
      }
    });
    const conversation = await runtime.conversation.create({ spaceId: space.id });
    const submit = (content, key, requestedPolicyId = null) =>
      runtime.conversationStore.submitTurn({
        ownerId: 'test',
        conversationId: conversation.conversationId,
        content,
        idempotencyKey: `propose-${key}`,
        requestedPolicyId
      });
    const policy = () =>
      runtime.access.createPolicy({
        spaceId: space.id,
        scope: { kind: 'library' },
        excludedNoteIds: [],
        includeAttachments: false,
        read: true,
        egress: true,
        recipients: ['deepseek'],
        expiresAt: new Date(Date.now() + 86400000).toISOString()
      });
    const items = () => app.modules.knowledge.repositories.knowledgeItemRepository.list();
    await run({
      app,
      runtime,
      space,
      requests,
      submit,
      policy,
      items,
      respond: next => {
        respond = next;
      }
    });
  } finally {
    await runtime?.agent?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const toolCalls = async (runtime, turn, name) =>
  (await runtime.conversationStore.listToolCalls(turn.turnId)).filter(item => item.toolName === name);

const hashOf = content => calculateContentHash(content);
function fakeAccess(content, { noteId = 'n1', versionId = 'v1', spaceId = 's' } = {}) {
  return {
    async verifyRead({ noteId: requested }) {
      return { note: { id: requested, spaceId }, version: { id: versionId, content }, contentHash: hashOf(content) };
    }
  };
}
const refFor = (content, start, end, extra = {}) => ({
  noteId: 'n1',
  noteVersionId: 'v1',
  contentHash: hashOf(content),
  start,
  end,
  quoteHash: hashOf(content.slice(start, end)),
  ...extra
});
const args = (start, end, quote, noteId = 'n1') => ({
  candidates: [
    { title: '标题', canonicalStatement: '陈述', knowledgeType: 'concept', citations: [{ noteId, start, end, quote }] }
  ]
});
const plan = (content, input, refs, access = fakeAccess(content)) =>
  buildKnowledgeProposalPlan({ access, grantId: 'g', args: input, sourceRefs: refs, turnId: 't', callId: 'c' });

const TWO = '数据增强通过变换样本增加训练变化。\n\n过拟合指模型在训练集表现好而泛化差。';
function proposalInputs(app, note) {
  const content = note.rawMarkdown,
    version = app.modules.knowledge.repositories.noteVersionRepository.findByNoteIdAndContentHash(
      note.id,
      calculateContentHash(content)
    );
  const access = {
    async verifyRead() {
      return { note, version, contentHash: version.contentHash };
    }
  };
  const ref = {
    noteId: note.id,
    noteVersionId: version.id,
    contentHash: version.contentHash,
    start: 0,
    end: content.length,
    quoteHash: calculateContentHash(content)
  };
  const cite = quote => [
    { noteId: note.id, start: content.indexOf(quote), end: content.indexOf(quote) + quote.length, quote }
  ];
  return {
    access,
    sourceRefs: [ref],
    args: {
      candidates: [
        { title: '数据增强', canonicalStatement: Q1, knowledgeType: 'concept', citations: cite(Q1) },
        { title: '过拟合', canonicalStatement: Q2, knowledgeType: 'concept', citations: cite(Q2) }
      ]
    }
  };
}
async function commitPlan(app, note, requestSuffix = 'main') {
  return buildKnowledgeProposalPlan({
    ...proposalInputs(app, note),
    grantId: 'g',
    turnId: `turn-${requestSuffix}`,
    callId: 'call-1'
  });
}
function originState(spaceId, origin, identity) {
  const future = new Date(Date.now() + 3600_000).toISOString(),
    boundary = { ownerId: 'test', ...identity, spaceId };
  return {
    turn: {
      ...boundary,
      turnId: origin.turnId,
      conversationId: origin.conversationId,
      status: 'running',
      leaseGeneration: 1,
      leaseExpiresAt: future
    },
    grant: {
      ...boundary,
      grantId: 'grant-1',
      conversationId: origin.conversationId,
      actorId: 'test',
      policyId: 'policy-1',
      policyRevision: 1,
      expiresAt: future,
      allowedTools: ['notes_search', 'notes_read']
    },
    policy: {
      ...boundary,
      policyId: 'policy-1',
      actorId: 'test',
      revision: 1,
      read: true,
      revokedAt: null,
      expiresAt: future,
      excludedNoteIds: [],
      scope: { kind: 'library' }
    }
  };
}
async function commitFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-knowledge-commit-'));
  try {
    const app = createPersistentAppContext({ storageRootDir: root, ownerId: 'test' });
    const space = app.http.knowledge.createDefaultKnowledgeSpace();
    const note = app.modules.knowledge.noteService.createNote({ spaceId: space.id, title: '笔记', rawMarkdown: TWO });
    const origin = { conversationId: 'conversation-1', turnId: 'turn-main', toolCallId: 'call-1' };
    const identity = { datasetId: 'dataset-1', datasetEpoch: 'epoch-1' };
    const state = originState(space.id, origin, identity);
    const stores = {
      conversationStore: { peekTurn: () => state.turn },
      accessStore: { peek: kind => (kind === 'aiRunGrant' ? state.grant : state.policy) }
    };
    const make = (core = app.coreOperationStore) =>
      createAgentKnowledgeCommitService({ core, knowledge: app.modules.knowledge, ownerId: 'test', ...stores });
    await run({
      app,
      space,
      note,
      service: make(),
      make,
      state,
      build: () => commitPlan(app, note),
      origin,
      identity,
      grantId: 'grant-1',
      generation: 1
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export const aiKnowledgePropose = [
  {
    name: '知识提议：读后提交原子保存为候选，附 agent 来源摘要，不产生正式知识',
    run: () =>
      fixture(async ({ app, runtime, space, requests, submit, policy, items, respond }) => {
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '笔记',
          rawMarkdown: MARKDOWN
        });
        const p = await policy();
        let round = 0;
        respond(() =>
          ++round === 1
            ? tool('notes_read', { noteId: note.id })
            : round === 2
              ? tool('knowledge_propose', proposal(note.id))
              : answer('已提交一条候选。', [{ sourceId: 'S1', quote: Q1 }])
        );
        const turn = await submit('提炼这篇笔记的知识点', 'ok', p.policyId);
        await runtime.agent.run(turn.turnId);
        assert(requests[0].tools.some(item => item.name === 'knowledge_propose'));
        assert(
          JSON.stringify(requests[0].messages).includes('这是提炼知识点请求'),
          '提炼回合必须带“读后提交候选”的行为指引'
        );
        assert.equal(requests[0].maxTokens, 4096);
        assert(!JSON.stringify(requests[0].messages).includes('已完成：'), '尚无工具结果时不得声称已完成');
        assert(
          JSON.stringify(requests[1].messages).includes('已完成：notes_read 已读取一篇笔记的原文片段'),
          '读取成功后必须明确告知模型，避免重复读取'
        );
        assert(!JSON.stringify(requests[1].messages).includes('没有可用重点'), '只读过正文不得被说成没有重点');
        const [call] = await toolCalls(runtime, turn, 'knowledge_propose');
        assert.equal(call.status, 'succeeded');
        assert.equal(call.resultJson.status, 'saved');
        assert.equal(call.resultJson.saved, true);
        assert.equal(call.resultJson.candidates.length, 1);
        assert.equal(call.resultJson.candidates[0].title, '数据增强');
        assert.deepEqual(
          call.resultJson.citedRanges,
          [{ noteId: note.id, start: 0, end: Q1.length }],
          '结果必须带已保存引文的绝对位置，供进度判断覆盖了哪些重点'
        );
        const [saved] = items();
        assert.equal(saved.id, call.resultJson.candidates[0].candidateId);
        assert.equal(saved.reviewStatus, 'candidate');
        assert.equal(saved.sourceMode, 'ai');
        assert.equal(items().filter(item => item.reviewStatus === 'confirmed').length, 0);
        const provenance = app.modules.knowledge.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(
          saved.id
        );
        assert.equal(provenance.executionMode, 'agent');
        assert.equal(provenance.provider, 'simulated');
        assert.equal(provenance.origin.turnId, turn.turnId);
        assert.equal(provenance.sources[0].quoteText, Q1);
        const evidence = app.modules.knowledge.repositories.knowledgeEvidenceRepository.list({
          knowledgeItemId: saved.id
        });
        assert.equal(evidence.length, 1);
        assert.equal(evidence[0].quoteText, Q1);
      })
  },
  {
    name: '知识提议：默认不开放该工具',
    run: () =>
      fixture(
        async ({ app, runtime, space, requests, submit, policy, respond }) => {
          const note = app.modules.knowledge.noteService.createNote({
            spaceId: space.id,
            title: '笔记',
            rawMarkdown: MARKDOWN
          });
          const p = await policy();
          respond(() => answer('普通回答', []));
          const turn = await submit(`读读 ${note.title}`, 'off', p.policyId);
          await runtime.agent.run(turn.turnId);
          assert(requests.every(request => !request.tools.some(item => item.name === 'knowledge_propose')));
        },
        { knowledgeProposals: false }
      )
  },
  {
    name: '知识提议：伪造引文被拒绝并反馈给模型，模型可更正后通过',
    run: () =>
      fixture(async ({ app, runtime, space, submit, policy, items, respond }) => {
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '笔记',
          rawMarkdown: MARKDOWN
        });
        const p = await policy();
        let round = 0;
        const forged = proposal(note.id);
        forged.candidates[0].citations[0].quote = '伪造的原文';
        respond(() =>
          ++round === 1
            ? tool('knowledge_propose', forged, 'bad')
            : round === 2
              ? tool('knowledge_propose', proposal(note.id), 'good')
              : answer('已更正并提交。', [{ sourceId: 'S1', quote: Q1 }])
        );
        const turn = await submit('提炼这篇笔记的知识点', 'forged', p.policyId);
        await runtime.agent.run(turn.turnId);
        const calls = await toolCalls(runtime, turn, 'knowledge_propose');
        assert.equal(calls.length, 2);
        assert.equal(calls[0].status, 'failed');
        assert.equal(calls[0].errorCode, 'AI_PROPOSAL_CITATION_INVALID');
        assert.equal(calls[1].resultJson.status, 'saved');
        assert.equal(items().length, 1);
      })
  },
  {
    name: '知识提议：未读先提交被拒绝，不创建任何知识',
    run: () =>
      fixture(async ({ app, runtime, space, submit, policy, items, respond }) => {
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '笔记',
          rawMarkdown: MARKDOWN
        });
        const p = await policy();
        let round = 0;
        respond(() => (++round === 1 ? tool('knowledge_propose', proposal(note.id)) : answer('需要先读取原文。', [])));
        const turn = await submit('请提炼知识点', 'unread', p.policyId);
        await runtime.agent.run(turn.turnId);
        const [call] = await toolCalls(runtime, turn, 'knowledge_propose');
        assert.equal(call.errorCode, 'AI_PROPOSAL_NOT_READ');
        assert.equal(items().length, 0);
      })
  },
  {
    name: '知识提议：引文必须落在已读片段内，读过的片段之外的原文不可引',
    async run() {
      const content = `${'甲'.repeat(20)}${Q2}${'乙'.repeat(20)}`;
      const start = 20,
        ref = refFor(content, 0, 20);
      await assert.rejects(plan(content, args(start, start + Q2.length, Q2), [ref]), {
        code: 'AI_PROPOSAL_CITATION_INVALID'
      });
      const ok = await plan(content, args(start, start + Q2.length, Q2), [ref, refFor(content, 20, 20 + Q2.length)]);
      assert.equal(ok.candidates.length, 1);
      assert.equal(ok.candidates[0].provenance[0].start, start);
      assert.equal(ok.candidates[0].reviewStatus, 'candidate');
      assert.equal(ok.candidates[0].candidateInput.sourceMode, 'ai');
    }
  },
  {
    name: '知识提议：笔记版本已变化时拒绝，且不同空间的来源不可混用',
    async run() {
      const content = Q2;
      const stale = refFor(content, 0, content.length, { contentHash: 'old' });
      await assert.rejects(plan(content, args(0, 2, content.slice(0, 2)), [stale]), {
        code: 'AI_PROPOSAL_SOURCE_STALE'
      });
      const spaces = {
        async verifyRead({ noteId }) {
          return {
            note: { id: noteId, spaceId: noteId === 'n1' ? 's1' : 's2' },
            version: { id: 'v1', content },
            contentHash: hashOf(content)
          };
        }
      };
      await assert.rejects(
        plan(
          content,
          args(0, 2, content.slice(0, 2)),
          [refFor(content, 0, content.length), refFor(content, 0, content.length, { noteId: 'n2' })],
          spaces
        ),
        { code: 'AI_PROPOSAL_INVALID' }
      );
    }
  },
  {
    name: '知识提议：模型不能指定审核状态或业务字段，参数严格校验',
    async run() {
      const content = Q2,
        ref = refFor(content, 0, content.length);
      const good = args(0, 2, content.slice(0, 2));
      const withStatus = structuredClone(good);
      withStatus.candidates[0].reviewStatus = 'confirmed';
      const extraRoot = { ...good, scopeId: 'x' };
      const noCites = structuredClone(good);
      noCites.candidates[0].citations = [];
      const badType = structuredClone(good);
      badType.candidates[0].knowledgeType = 'opinion';
      for (const input of [null, {}, { candidates: [] }, withStatus, extraRoot, noCites, badType]) {
        await assert.rejects(plan(content, input, [ref]), { code: 'AI_TOOL_ARGUMENTS_INVALID' });
      }
      await assert.rejects(plan(content, { candidates: [{ ...good.candidates[0], title: '   ' }] }, [ref]), {
        code: 'AI_PROPOSAL_INVALID'
      });
    }
  },
  {
    name: '知识提议：同一回合同一调用得到稳定候选 ID，重复引用同一片段被拒绝',
    async run() {
      const content = Q2,
        ref = refFor(content, 0, content.length);
      const input = args(0, 4, content.slice(0, 4));
      const first = await plan(content, input, [ref]),
        second = await plan(content, input, [ref]);
      assert.equal(first.candidates[0].candidateInput.id, second.candidates[0].candidateInput.id);
      assert.equal(first.outputHash, second.outputHash);
      const duplicate = structuredClone(input);
      duplicate.candidates[0].citations.push({ ...duplicate.candidates[0].citations[0] });
      await assert.rejects(plan(content, duplicate, [ref]), { code: 'AI_PROPOSAL_CITATION_INVALID' });
    }
  },
  {
    name: '知识保存：全部候选与来源摘要同事务提交，重试复用回执不重复创建',
    run: () =>
      commitFixture(async ({ app, space, note, build, service, origin, identity, grantId, generation }) => {
        const plan = await build();
        const receipt = await service.commit({
          plan,
          origin,
          identity,
          grantId,
          generation,
          provider: 'deepseek',
          modelId: 'deepseek-flash'
        });
        assert.equal(receipt.kind, 'knowledge_propose');
        assert.equal(receipt.result.candidates.length, 2);
        const repos = app.modules.knowledge.repositories;
        assert.equal(repos.knowledgeItemRepository.list().length, 2);
        assert.equal(repos.knowledgeArtifactProvenanceRepository.list({}).length, 2);
        const again = await service.commit({
          plan,
          origin,
          identity,
          grantId,
          generation,
          provider: 'deepseek',
          modelId: 'deepseek-flash'
        });
        assert.equal(again.receiptHash, receipt.receiptHash);
        assert.equal(repos.knowledgeItemRepository.list().length, 2);
        for (const item of repos.knowledgeItemRepository.list()) {
          assert.equal(repos.knowledgeArtifactProvenanceRepository.findByArtifactId(item.id).provider, 'deepseek');
        }
      })
  },
  {
    name: '知识保存：中途失败整体回滚，不留下部分候选或来源摘要',
    run: () =>
      commitFixture(async ({ app, build, service, origin, identity, grantId, generation }) => {
        const plan = await build(),
          repos = app.modules.knowledge.repositories;
        // 第二个候选 ID 已被不同内容占用，创建时冲突；第一个候选必须一并回滚。
        const second = plan.candidates[1].candidateInput;
        app.modules.knowledge.knowledgeItemService.createCandidate({
          id: second.id,
          title: '别人的候选',
          canonicalStatement: '占用 ID',
          knowledgeType: 'concept',
          sourceMode: 'manual',
          userExplanation: '',
          evidence: []
        });
        const before = repos.knowledgeItemRepository.list().length;
        await assert.rejects(
          service.commit({
            plan,
            origin,
            identity,
            grantId,
            generation,
            provider: 'deepseek',
            modelId: 'deepseek-flash'
          })
        );
        assert.equal(repos.knowledgeItemRepository.list().length, before);
        assert.equal(repos.knowledgeItemRepository.findById(plan.candidates[0].candidateInput.id), null);
        assert.equal(repos.knowledgeArtifactProvenanceRepository.list({}).length, 0);
        assert.equal(
          await app.coreOperationStore.get({
            ownerId: 'test',
            datasetId: identity.datasetId,
            operationId: `knowledge-propose-${(await import('../src/modules/ai/record-contract.ts')).hashRecord([origin.turnId, origin.toolCallId])}`
          }),
          null
        );
      })
  },
  {
    name: '知识保存：计划提交前来源转私密则整体拒绝，且同操作绑定另一份计划时冲突',
    run: () =>
      commitFixture(async ({ app, note, build, service, origin, identity, grantId, generation }) => {
        const plan = await build(),
          repos = app.modules.knowledge.repositories;
        app.modules.knowledge.noteService.updateNote(note.id, { aiVisibility: 'private' });
        await assert.rejects(
          service.commit({
            plan,
            origin,
            identity,
            grantId,
            generation,
            provider: 'deepseek',
            modelId: 'deepseek-flash'
          }),
          { code: 'AI_SCOPE_FORBIDDEN' }
        );
        assert.equal(repos.knowledgeItemRepository.list().length, 0);
        app.modules.knowledge.noteService.updateNote(note.id, { aiVisibility: 'normal' });
        await service.commit({
          plan,
          origin,
          identity,
          grantId,
          generation,
          provider: 'deepseek',
          modelId: 'deepseek-flash'
        });
        const other = await commitPlan(app, note, 'other-request');
        await assert.rejects(
          service.commit({
            plan: { ...other, requestId: plan.requestId },
            origin,
            identity,
            grantId,
            generation,
            provider: 'deepseek',
            modelId: 'deepseek-flash'
          }),
          { code: 'CORE_OPERATION_CONFLICT' }
        );
      })
  },
  {
    name: '核心回执：知识提议回执与笔记回执结果格式互不通用',
    run() {
      const base = {
        ownerId: 'o',
        datasetId: 'd',
        datasetEpoch: 'e',
        actorId: 'o',
        spaceId: 's',
        requestId: 'r',
        operationId: 'op',
        planHash: 'a'.repeat(64)
      };
      const knowledge = { candidates: [{ candidateId: 'k1', provenanceId: 'p1' }], saveState: 'localCommitted' };
      const note = {
        changes: [
          { noteId: 'n', beforeVersionId: null, afterVersionId: 'v', contentHash: 'b'.repeat(64), metadataBefore: null }
        ],
        saveState: 'localCommitted'
      };
      const receipt = createCoreOperationReceipt({ ...base, kind: 'knowledge_propose' }, knowledge);
      assert.deepEqual(validateCoreOperationReceipt(receipt), receipt);
      assert.throws(() => createCoreOperationReceipt({ ...base, kind: 'knowledge_propose' }, note), {
        code: 'CORE_OPERATION_INVALID'
      });
      assert.throws(() => createCoreOperationReceipt({ ...base, kind: 'notes_create' }, knowledge), {
        code: 'CORE_OPERATION_INVALID'
      });
      assert.ok(createCoreOperationReceipt({ ...base, kind: 'notes_create' }, note));
      for (const bad of [
        { ...knowledge, candidates: [] },
        { ...knowledge, candidates: [knowledge.candidates[0], knowledge.candidates[0]] },
        { ...knowledge, candidates: [{ candidateId: 'k1' }] },
        { ...knowledge, saveState: 'pending' }
      ]) {
        assert.throws(() => createCoreOperationReceipt({ ...base, kind: 'knowledge_propose' }, bad), {
          code: 'CORE_OPERATION_INVALID'
        });
      }
    }
  },
  {
    name: '知识提议：只有明确要求提炼知识点的提问才视为提议意图，解释类与普通问题不是',
    run() {
      for (const text of [
        '帮我提炼这篇笔记的知识点',
        '提取知识点',
        '把重点生成知识点',
        '请整理考点',
        '知识点提炼一下',
        '能不能帮我提炼知识点',
        '要不要提炼知识点',
        '整理概念的区别并生成知识点',
        '提炼知识点，不要超过五个',
        '不要遗漏，提炼知识点',
        '先别急着总结，帮我提炼知识点',
        '可不可以生成知识点'
      ])
        assert.equal(requestsKnowledgeProposal(text), true, text);
      for (const text of [
        '这篇笔记讲了什么',
        '怎么提炼知识点',
        '解释一下什么是知识点',
        '总结本周学习',
        '你好',
        '提炼一下这段话的意思',
        '不要生成知识点',
        '别提炼知识点',
        '不用提取知识点',
        '无需生成知识点',
        '先不要整理知识点',
        '暂不创建知识点',
        '我不想生成知识点',
        '请勿提炼知识点',
        '知识点先不用生成',
        '知识点不要提炼了',
        '不是要生成知识点，只是想问问',
        '禁止创建知识点',
        '不必归纳知识点',
        '我不希望你生成知识点',
        '不要根据这篇笔记自动生成知识点',
        '请解释知识项如何提炼',
        '我不想要你提取知识项',
        '别根据这些重点自动整理出知识点',
        '知识项是怎么提炼出来的',
        '介绍一下知识点的生成原理'
      ]) {
        assert.equal(requestsKnowledgeProposal(text), false, text);
      }
    }
  },
  {
    name: '知识提议：已完成说明只描述当前 sources 窗口内的来源，区分未读/待提交/已提交，不含笔记标题',
    run() {
      const call = (toolName, resultJson, sourceRefs = [], status = 'succeeded') => ({
        toolName,
        status,
        resultJson,
        sourceRefs,
        callId: `${toolName}-${Math.random()}`
      });
      const ref = (noteId, start, end) => ({ noteId, start, end });
      const item = (id, importance, start, end) => ({ annotationId: id, importance, start, end });
      const refsOf = items => items.map(entry => ref('n', entry.start, entry.end));
      assert.equal(proposalProgress([], []), '');
      assert.equal(
        proposalProgress(
          [call('notes_search', { hits: [] }), call('notes_read', { noteId: 'n' }, [ref('n', 0, 9)], 'failed')],
          [ref('n', 0, 9)]
        ),
        ''
      );
      // 读完且都在窗口内：点明重点对应的 source，提示现在提交
      const full = [item('a1', 'core', 0, 5), item('a2', 'important', 6, 9), item('a3', 'important', 10, 14)];
      const complete = proposalProgress(
        [
          call(
            'annotations_list',
            { noteId: 'n', title: '绝密标题', total: 3, offset: 0, annotations: full },
            refsOf(full)
          )
        ],
        refsOf(full)
      );
      assert(
        complete.includes(
          '3 处重点中的 3 处，其中 0 处已提交；3 处待提交且原文在当前 sources 中（core×1、important×2），即 S1（core）、S2（important）、S3（important）'
        ),
        complete
      );
      assert(
        complete.includes('现在就对上面待提交的重点调用 knowledge_propose') &&
          !complete.includes('绝密标题') &&
          !complete.includes('翻页读取'),
        complete
      );
      // 分页未读完：先提交窗口内的，再翻页（读一批提交一批）；不得声称已全部读取
      const page = Array.from({ length: 8 }, (_, index) => item(`p${index}`, 'important', index * 10, index * 10 + 5));
      const paged = proposalProgress(
        [call('annotations_list', { noteId: 'n', total: 10, offset: 0, annotations: page }, refsOf(page))],
        refsOf(page)
      );
      assert(
        paged.includes('10 处重点中的 8 处') &&
          paged.includes('还有 2 处未读') &&
          paged.includes('offset=8') &&
          paged.includes('现在就对上面待提交的重点调用 knowledge_propose'),
        paged
      );
      assert(paged.includes('读一批提交一批') && !paged.includes('信息已足够'), paged);
      // 评审场景：13 处重点按 8+5 读完，窗口只放得下 12 条——已提交的不再算待处理，不要求补读，直接提交剩余
      const second = Array.from({ length: 5 }, (_, index) =>
        item(`q${index}`, 'important', 100 + index * 10, 105 + index * 10)
      );
      const saveOf = items =>
        call('knowledge_propose', {
          saved: true,
          candidates: new Array(items.length).fill({}),
          citedRanges: refsOf(items)
        });
      const overflow = [
        call('annotations_list', { noteId: 'n', total: 13, offset: 0, annotations: page }, refsOf(page)),
        saveOf(page),
        call('annotations_list', { noteId: 'n', total: 13, offset: 8, annotations: second }, refsOf(second))
      ];
      const window = [...refsOf(page).slice(-7), ...refsOf(second)]; // 12 条窗口：最早的 1 处已被挤出
      const afterSave = proposalProgress(overflow, window);
      assert(afterSave.includes('13 处重点中的 13 处，其中 8 处已提交；5 处待提交'), afterSave);
      assert(
        !afterSave.includes('已读但原文已移出') &&
          !afterSave.includes('重新读取') &&
          afterSave.includes('现在就对上面待提交的重点调用 knowledge_propose'),
        afterSave
      );
      // 全部提交完：只提示告知用户，不再要求读取或提交
      const finished = proposalProgress([...overflow, saveOf(second)], window);
      assert(
        finished.includes('13 处已提交') &&
          finished.includes('重点已全部处理，请用一两句话告知用户') &&
          !finished.includes('待提交'),
        finished
      );
      // 部分保存后仍有未读：只提示继续翻页，不重复读取已读页
      const midway = proposalProgress([overflow[0], overflow[1]], refsOf(page));
      assert(
        midway.includes('先别重复读取已读的页') && midway.includes('offset=8') && !midway.includes('待提交'),
        midway
      );
      // 评审：保存成功不等于所有已读重点都已提交——只算引文实际覆盖到的重点
      const all13 = [...page, ...second];
      const readAll = [
        call('annotations_list', { noteId: 'n', total: 13, offset: 0, annotations: page }, refsOf(page)),
        call('annotations_list', { noteId: 'n', total: 13, offset: 8, annotations: second }, refsOf(second))
      ];
      // 读完 13 处，只保存了窗口内的 12 条（页 0 的第一处没被引用）：那一处仍待处理且需重新读取
      const savedWindow = proposalProgress(
        [...readAll, saveOf(all13.slice(1))],
        [...refsOf(page).slice(-7), ...refsOf(second)]
      );
      assert(
        savedWindow.includes('13 处重点中的 13 处，其中 12 处已提交') &&
          savedWindow.includes('1 处已读但原文已移出 sources 且尚未提交'),
        savedWindow
      );
      assert(
        savedWindow.includes('重新读取被移出 sources 的重点') &&
          !savedWindow.includes('重点已全部处理') &&
          !savedWindow.includes('告知用户'),
        savedWindow
      );
      // 读了 8 处只保存 1 条：其余 7 处仍在窗口内待提交，不得宣称全部完成
      const oneOfEight = proposalProgress(
        [
          call('annotations_list', { noteId: 'n', total: 8, offset: 0, annotations: page }, refsOf(page)),
          saveOf(page.slice(0, 1))
        ],
        refsOf(page)
      );
      assert(
        oneOfEight.includes('其中 1 处已提交；7 处待提交') &&
          oneOfEight.includes('现在就对上面待提交的重点调用 knowledge_propose'),
        oneOfEight
      );
      assert(!oneOfEight.includes('重点已全部处理') && !oneOfEight.includes('告知用户'), oneOfEight);
      // 用整篇原文当引文不会“顺带覆盖”所有重点；结果缺少 citedRanges（旧记录）也按未覆盖处理
      const wholeCited = proposalProgress(
        [
          call('annotations_list', { noteId: 'n', total: 8, offset: 0, annotations: page }, refsOf(page)),
          call('knowledge_propose', { saved: true, candidates: [{}], citedRanges: [ref('n', 0, 1000)] })
        ],
        refsOf(page)
      );
      assert(wholeCited.includes('其中 0 处已提交；8 处待提交'), wholeCited);
      const legacy = proposalProgress(
        [
          call('annotations_list', { noteId: 'n', total: 8, offset: 0, annotations: page }, refsOf(page)),
          call('knowledge_propose', { saved: true, candidates: [{}] })
        ],
        refsOf(page)
      );
      assert(legacy.includes('其中 0 处已提交；8 处待提交'), legacy);
      // 已读但原文被挤出且尚未提交：要求重新读取（读一批提交一批），而非无限补读
      const lost = proposalProgress(
        [
          call(
            'annotations_list',
            { noteId: 'n', total: 2, offset: 0, annotations: [item('k1', 'core', 0, 4), item('k2', 'core', 5, 9)] },
            [ref('n', 0, 4), ref('n', 5, 9)]
          )
        ],
        [ref('n', 0, 4)]
      );
      assert(
        lost.includes('1 处待提交') &&
          lost.includes('1 处已读但原文已移出 sources 且尚未提交') &&
          lost.includes('读一批提交一批'),
        lost
      );
      // 重读页大小随实际预算容量：容量已知时给出 limit=容量，未知时只说较小值
      const twoLost = proposalProgress(
        [
          call(
            'annotations_list',
            { noteId: 'n', total: 4, offset: 0, annotations: page.slice(0, 4) },
            refsOf(page.slice(0, 4))
          )
        ],
        refsOf(page.slice(2, 4)),
        2
      );
      assert(
        twoLost.includes('sources 一次约容纳 2 条') && twoLost.includes('offset=0 起用 limit=2 重新读取'),
        twoLost
      );
      assert(
        proposalProgress(
          [
            call(
              'annotations_list',
              { noteId: 'n', total: 4, offset: 0, annotations: page.slice(0, 4) },
              refsOf(page.slice(0, 4))
            )
          ],
          refsOf(page.slice(2, 4))
        ).includes('起用 limit=较小值 重新读取')
      );
      // 来源窗口已淘汰该笔记：完全不提及，不泄露其标题或数量
      assert.equal(
        proposalProgress(
          [
            call(
              'annotations_list',
              { noteId: 'a', title: '私密甲笔记', total: 9, offset: 0, annotations: [item('x', 'core', 0, 4)] },
              [ref('a', 0, 4)]
            ),
            call('notes_read', { noteId: 'a', title: '私密甲笔记' }, [ref('a', 0, 50)])
          ],
          [ref('b', 0, 4)]
        ),
        ''
      );
      // 整篇原文排第一、重点片段随后：编号按 sourceRefs 顺序，重点不会与整篇混淆
      const withWhole = proposalProgress(
        [
          call('annotations_list', {
            noteId: 'n',
            total: 2,
            offset: 0,
            annotations: [item('w1', 'core', 16, 44), item('w2', 'important', 78, 112)]
          })
        ],
        [ref('n', 0, 201), ref('n', 16, 44), ref('n', 78, 112)]
      );
      assert(withWhole.includes('即 S2（core）、S3（important）'), withWhole);
      // 没有重点：仅当该笔记仍在 sources 窗口内才如实说明；窗口外不提及
      const none = call('annotations_list', { noteId: 'n', total: 0, offset: 0, annotations: [] });
      assert(proposalProgress([none], [ref('n', 0, 9)]).includes('没有可用重点'));
      assert.equal(proposalProgress([none], [ref('x', 0, 9)]), '');
      // 同一笔记重复读取只算一次；只读正文、未列重点时不说“没有重点”
      const once = proposalProgress(
        [call('notes_read', { noteId: 'n' }, [ref('n', 0, 9)]), call('notes_read', { noteId: 'n' }, [ref('n', 0, 9)])],
        [ref('n', 0, 9)]
      );
      assert.equal(once.split('notes_read 已读取').length - 1, 1);
      assert(!once.includes('没有可用重点'));
      const saved = proposalProgress([call('knowledge_propose', { saved: true, candidates: [{}, {}] })], []);
      assert(
        saved.includes('已保存 2 条待审核候选') &&
          saved.includes('告知用户') &&
          !saved.includes('现在调用 knowledge_propose'),
        saved
      );
    }
  },
  {
    name: '知识提议：重点数超过来源窗口容量时按批提交——遵循指引的模型 13 处重点全部提交，不触发 AI_AGENT_LIMIT',
    run: () =>
      fixture(async ({ app, runtime, space, requests, submit, policy, items, respond }) => {
        const sentences = Array.from({ length: 13 }, (_, index) => `第${index}条要点是独立的知识内容${index}。`);
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '十三要点',
          rawMarkdown: sentences.join('\n\n')
        });
        markParagraphs(
          app.modules.knowledge,
          note,
          Array.from({ length: 13 }, (_, index) => [index, 'important'])
        );
        const p = await policy(),
          proposed = new Set();
        // 模拟“遵循指引”的模型：只看最近一条“已完成”说明和当前 sources 决定下一步。
        respond(request => {
          const user = JSON.parse(request.messages.at(-1).content),
            progress = user.question.match(/已完成：[^\n]*/)?.[0] ?? '';
          const fresh = user.sources.filter(source => sentences.includes(source.text) && !proposed.has(source.text));
          if (!progress) return tool('annotations_list', { noteId: note.id, limit: 8 }, 'first');
          if (/现在就对上面待提交的重点调用 knowledge_propose/.test(progress) && fresh.length) {
            fresh.forEach(source => proposed.add(source.text));
            return tool(
              'knowledge_propose',
              {
                candidates: fresh.map(source => ({
                  title: source.text.slice(0, 8),
                  canonicalStatement: source.text,
                  knowledgeType: 'concept',
                  citations: [{ noteId: note.id, quote: source.text }]
                }))
              },
              `propose-${proposed.size}`
            );
          }
          const next = progress.match(/offset=(\d+)/);
          if (next && /继续翻页|翻页读取/.test(progress))
            return tool('annotations_list', { noteId: note.id, limit: 8, offset: Number(next[1]) }, `page-${next[1]}`);
          if (/重新读取/.test(progress)) throw new Error(`不应要求重新读取：${progress}`);
          return answer('已提交候选。', []);
        });
        const turn = await submit('提炼这篇笔记里标记的重点知识点', 'thirteen', p.policyId);
        const outcome = await runtime.agent.run(turn.turnId).then(
          () => 'ok',
          error => error.code ?? error.message
        );
        const calls = await toolCalls(runtime, turn, 'knowledge_propose');
        assert.equal(outcome, 'ok', `${outcome}；请求数 ${requests.length}`);
        assert.equal(items().length, 13, `候选数 ${items().length}`);
        assert.deepEqual(
          calls.map(call => call.status),
          ['succeeded', 'succeeded']
        );
        assert(requests.length <= 8, `模型请求 ${requests.length} 次`);
      })
  },
  ...[
    [300, 6, '约 300 字'],
    [800, 6, '约 800 字（预算只容纳 2 条来源）']
  ].map(([chars, count, label]) => ({
    name: `知识提议：重点原文${label}、来源超过请求预算时从最旧来源起移出窗口，按实际容量的页大小分批提交，不因 AI_CONTEXT_BUDGET 或补读循环失败`,
    run: () =>
      fixture(async ({ app, runtime, space, requests, submit, policy, items, respond }) => {
        const filler = index =>
          Array.from({ length: Math.ceil(chars / 14) }, (_, part) => `第${index}条要点的细节${part}说明`)
            .join('，')
            .slice(0, chars - 1) + '。';
        const sentences = Array.from({ length: count }, (_, index) => filler(index));
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '长重点',
          rawMarkdown: sentences.join('\n\n')
        });
        markParagraphs(
          app.modules.knowledge,
          note,
          Array.from({ length: count }, (_, index) => [index, 'important'])
        );
        const p = await policy(),
          proposed = new Set(),
          sourceCounts = [],
          hintedLimits = [];
        respond(request => {
          const user = JSON.parse(request.messages.at(-1).content),
            progress = user.question.match(/已完成：[^\n]*/)?.[0] ?? '';
          sourceCounts.push(user.sources.length);
          const fresh = user.sources.filter(source => sentences.includes(source.text) && !proposed.has(source.text));
          if (!progress) return tool('annotations_list', { noteId: note.id, limit: 8 }, 'first');
          if (/现在就对上面待提交的重点调用 knowledge_propose/.test(progress) && fresh.length) {
            fresh.forEach(source => proposed.add(source.text));
            return tool(
              'knowledge_propose',
              {
                candidates: fresh.map(source => ({
                  title: source.text.slice(0, 8),
                  canonicalStatement: source.text,
                  knowledgeType: 'concept',
                  citations: [{ noteId: note.id, quote: source.text }]
                }))
              },
              `propose-${proposed.size}`
            );
          }
          const reread = progress.match(/offset=(\d+) 起用 limit=(\d+) 重新读取/);
          if (reread) {
            hintedLimits.push(Number(reread[2]));
            return tool(
              'annotations_list',
              { noteId: note.id, limit: Number(reread[2]), offset: Number(reread[1]) },
              `again-${reread[1]}-${requests.length}`
            );
          }
          const page = progress.match(/offset=(\d+) 继续翻页/);
          if (page)
            return tool('annotations_list', { noteId: note.id, limit: 8, offset: Number(page[1]) }, `page-${page[1]}`);
          return answer('已提交候选。', []);
        });
        const turn = await submit('提炼这篇笔记里标记的重点知识点', `long-${chars}`, p.policyId);
        const outcome = await runtime.agent.run(turn.turnId).then(
          () => 'ok',
          error => error.code ?? error.message
        );
        const detail = `；每次请求的来源数 ${sourceCounts}；提示的 limit ${hintedLimits}`;
        assert.equal(outcome, 'ok', outcome + detail);
        assert.equal(items().length, count, `候选数 ${items().length}${detail}`);
        assert(Math.max(...sourceCounts) < count, `来源数应被预算限制${detail}`);
        assert(
          hintedLimits.every(limit => limit <= Math.max(...sourceCounts)),
          `重读页大小不得超过实际容量${detail}`
        );
        assert(
          (await toolCalls(runtime, turn, 'knowledge_propose')).length +
            (await toolCalls(runtime, turn, 'annotations_list')).length <=
            8,
          '工具调用次数应在上限内'
        );
      })
  })),
  {
    name: '知识提议：仍有待提交的重点却直接作答（声称已提交）时先提醒再收尾，提醒后调用工具则正常保存；连续不听从最多提醒 2 次',
    run: async () => {
      for (const obeys of [true, false]) {
        await fixture(async ({ app, runtime, space, requests, submit, policy, items, respond }) => {
          const sentences = ['第一条要点是独立的知识内容一。', '第二条要点是独立的知识内容二。'];
          const note = app.modules.knowledge.noteService.createNote({
            spaceId: space.id,
            title: '两要点',
            rawMarkdown: sentences.join('\n\n')
          });
          markParagraphs(
            app.modules.knowledge,
            note,
            Array.from({ length: 2 }, (_, index) => [index, 'important'])
          );
          const p = await policy();
          let round = 0;
          respond(request => {
            round++;
            const question = JSON.parse(request.messages.at(-1).content).question;
            if (round === 1) return tool('annotations_list', { noteId: note.id }, 'list');
            if (/没有调用 knowledge_propose/.test(question) && obeys)
              return tool(
                'knowledge_propose',
                {
                  candidates: sentences.map(text => ({
                    title: text.slice(0, 6),
                    canonicalStatement: text,
                    knowledgeType: 'concept',
                    citations: [{ noteId: note.id, quote: text }]
                  }))
                },
                'obey'
              );
            return answer('我已经提交了全部候选。', []);
          });
          const turn = await submit('提炼这篇笔记里标记的重点知识点', `nudge-${obeys}`, p.policyId);
          const outcome = await runtime.agent.run(turn.turnId).then(
            () => 'ok',
            error => error.code ?? error.message
          );
          const nudged = requests.filter(request =>
            /没有调用 knowledge_propose/.test(JSON.parse(request.messages.at(-1).content).question)
          ).length;
          assert.equal(outcome, 'ok', outcome);
          if (obeys) {
            assert.equal(items().length, 2);
            assert.equal(nudged, 1, '听从后只需提醒一次');
          } else {
            assert.equal(items().length, 0);
            assert.equal(nudged, 2, '不听从时最多提醒 2 次，之后照常收尾，不陷入循环');
          }
        });
      }
    }
  },
  {
    name: '知识提议：笔记在进度说明之前被改为私密且已被来源窗口淘汰时，后续请求不再携带其任何信息',
    run: () =>
      fixture(async ({ app, runtime, space, requests, submit, policy, respond }) => {
        const blocks = prefix => Array.from({ length: 8 }, (_, index) => `${prefix}${index}段重点内容。`);
        const make = (title, prefix, count) => {
          const note = app.modules.knowledge.noteService.createNote({
            spaceId: space.id,
            title,
            rawMarkdown: blocks(prefix).join('\n\n')
          });
          markParagraphs(
            app.modules.knowledge,
            note,
            Array.from({ length: count }, (_, index) => [index, 'important'])
          );
          return note;
        };
        const a = make('私密甲笔记', '甲', 1),
          b = make('乙笔记', '乙', 8),
          c = make('丙笔记', '丙', 8);
        const p = await policy();
        let round = 0;
        respond(() => {
          round++;
          if (round === 1) return tool('annotations_list', { noteId: a.id }, 'a');
          if (round === 2) return tool('annotations_list', { noteId: b.id }, 'b');
          if (round === 3) {
            app.modules.knowledge.noteService.updateNote(a.id, { aiVisibility: 'private' });
            return tool('annotations_list', { noteId: c.id }, 'c');
          }
          return answer('已看完。', []);
        });
        const turn = await submit('提炼这些笔记的知识点', 'evict', p.policyId);
        await runtime.agent.run(turn.turnId).catch(() => {});
        assert(requests.length >= 4, `应至少发出 4 次请求，实际 ${requests.length}`);
        const sent = JSON.stringify(requests[3].messages);
        assert(
          !sent.includes('私密甲笔记') && !sent.includes(a.id) && !sent.includes('甲0段重点'),
          '已私密且被窗口淘汰的笔记不得再出现在请求里'
        );
        assert(sent.includes('已完成：annotations_list'), '仍在窗口内的笔记应有进度说明');
      })
  },
  {
    name: '知识提议：引文可省略偏移，服务端按 quote 在已读原文中唯一定位；多处、找不到或只给一半偏移均被拒绝并带提示',
    run: async () => {
      const content = '甲乙丙。\n\n丁戊己。\n\n甲乙丙。',
        one = '丁戊己。',
        twice = '甲乙丙。';
      const whole = refFor(content, 0, content.length),
        part = refFor(content, 6, 6 + one.length);
      const quoteOnly = quote => ({
        candidates: [
          { title: '标题', canonicalStatement: '陈述', knowledgeType: 'concept', citations: [{ noteId: 'n1', quote }] }
        ]
      });
      // 唯一：整篇与重叠子片段指向同一绝对位置，只算一处；定位结果与显式偏移完全一致
      const located = await plan(content, quoteOnly(one), [whole, part]);
      const explicit = await plan(content, args(6, 6 + one.length, one), [whole, part]);
      assert.deepEqual(located.candidates[0].provenance, explicit.candidates[0].provenance);
      assert.equal(located.candidates[0].provenance[0].quoteText, one);
      // 出现多次：拒绝并提示补偏移；补上偏移后通过
      await assert.rejects(
        plan(content, quoteOnly(twice), [whole]),
        error =>
          error.code === 'AI_PROPOSAL_CITATION_INVALID' &&
          /多次|唯一/.test(error.message) &&
          /start\/end/.test(error.hint)
      );
      assert.ok(
        await plan(content, args(content.lastIndexOf(twice), content.lastIndexOf(twice) + twice.length, twice), [whole])
      );
      // 找不到或不在已读窗口内：拒绝并提示逐字摘自原文
      await assert.rejects(
        plan(content, quoteOnly('不存在的句子'), [whole]),
        error => error.code === 'AI_PROPOSAL_CITATION_INVALID' && /逐字/.test(error.hint)
      );
      await assert.rejects(plan(content, quoteOnly(one), [refFor(content, 0, 4)]), {
        code: 'AI_PROPOSAL_CITATION_INVALID'
      });
      await assert.rejects(plan(content, quoteOnly(''), [whole]), error =>
        ['AI_PROPOSAL_CITATION_INVALID', 'AI_PROPOSAL_INVALID'].includes(error.code)
      );
      // 只给 start 或 end 之一、或多余字段：参数无效
      for (const citation of [
        { noteId: 'n1', start: 6, quote: one },
        { noteId: 'n1', end: 9, quote: one },
        { noteId: 'n1', quote: one, extra: 1 }
      ]) {
        await assert.rejects(
          plan(
            content,
            {
              candidates: [
                { title: '标题', canonicalStatement: '陈述', knowledgeType: 'concept', citations: [citation] }
              ]
            },
            [whole]
          ),
          { code: 'AI_TOOL_ARGUMENTS_INVALID' }
        );
      }
      // 其他笔记的同文引文不能借已读窗口定位
      await assert.rejects(
        plan(
          content,
          {
            candidates: [
              {
                title: '标题',
                canonicalStatement: '陈述',
                knowledgeType: 'concept',
                citations: [{ noteId: 'n2', quote: one }]
              }
            ]
          },
          [whole]
        ),
        { code: 'AI_PROPOSAL_CITATION_INVALID' }
      );
    }
  },
  {
    name: '知识提议：Agent 提交只含 noteId 与 quote 的引文即可保存，偏移由服务端定位',
    run: () =>
      fixture(async ({ app, runtime, space, submit, policy, items, respond }) => {
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '笔记',
          rawMarkdown: MARKDOWN
        });
        const p = await policy();
        let round = 0;
        const quoteOnly = {
          candidates: [
            {
              title: '数据增强',
              canonicalStatement: Q1,
              knowledgeType: 'concept',
              citations: [{ noteId: note.id, quote: Q1 }]
            }
          ]
        };
        respond(() =>
          ++round === 1
            ? tool('notes_read', { noteId: note.id })
            : round === 2
              ? tool('knowledge_propose', quoteOnly)
              : answer('已提交一条候选。', [{ sourceId: 'S1', quote: Q1 }])
        );
        const turn = await submit('提炼这篇笔记的知识点', 'quote-only', p.policyId);
        await runtime.agent.run(turn.turnId);
        const [call] = await toolCalls(runtime, turn, 'knowledge_propose');
        assert.equal(call.status, 'succeeded');
        assert.equal(items().length, 1);
        const evidence = app.modules.knowledge.repositories.knowledgeEvidenceRepository.list({
          knowledgeItemId: items()[0].id
        });
        assert.equal(evidence[0].quoteText, Q1);
        assert.equal(evidence[0].start ?? evidence[0].fromPosition ?? 0, 0);
      })
  },
  {
    name: '助手回答：JSON 漏写 citations 等价于空引用，回合照常完成；给出的引用仍逐条严格校验',
    run: async () => {
      for (const [content, ok] of [
        [JSON.stringify({ answer: '没有引用的回答。' }), true],
        [
          JSON.stringify({
            answer: '引用了不存在的原文。',
            citations: [{ sourceId: 'S1', quote: '原文里没有这句话' }]
          }),
          false
        ],
        [JSON.stringify({ answer: '引用字段类型错误。', citations: 'S1' }), false]
      ]) {
        await fixture(async ({ app, runtime, space, submit, policy, respond }) => {
          app.modules.knowledge.noteService.createNote({ spaceId: space.id, title: '笔记', rawMarkdown: MARKDOWN });
          const p = await policy();
          respond(() => answer(content));
          const turn = await submit('这篇笔记讲了什么', `cit-${ok}-${content.length}`, p.policyId);
          const outcome = await runtime.agent.run(turn.turnId).then(
            () => 'ok',
            error => error.code
          );
          const status = (await runtime.conversationStore.getTurn(turn.turnId)).status;
          if (ok) {
            assert.equal(outcome, 'ok', content);
            assert.equal(status, 'succeeded');
          } else {
            assert.notEqual(status, 'succeeded', content);
            assert.notEqual(outcome, 'ok', content);
          }
        });
      }
    }
  },
  {
    name: '知识提议开关：关闭时模型拿不到 knowledge_propose，开启后同一会话的新回合立即可用（无需重启）',
    run: () => {
      let on = false,
        reads = 0;
      return fixture(
        async ({ app, runtime, space, requests, submit, policy, items, respond }) => {
          const note = app.modules.knowledge.noteService.createNote({
            spaceId: space.id,
            title: '笔记',
            rawMarkdown: MARKDOWN
          });
          const p = await policy();
          let round = 0;
          respond(() => answer('已回答。', []));
          const off = await submit('提炼这篇笔记的知识点', 'switch-off', p.policyId);
          await runtime.agent.run(off.turnId);
          assert(
            requests.length &&
              requests.every(request => !request.tools.some(item => item.name === 'knowledge_propose')),
            '关闭时不得开放工具'
          );
          assert.equal(items().length, 0);
          assert.equal(reads, 1, '每个回合开始时读取一次开关');
          on = true;
          requests.length = 0;
          respond(() =>
            ++round === 1
              ? tool('notes_read', { noteId: note.id })
              : round === 2
                ? tool('knowledge_propose', proposal(note.id))
                : answer('已提交。', [{ sourceId: 'S1', quote: Q1 }])
          );
          const enabled = await submit('提炼这篇笔记的知识点', 'switch-on', p.policyId);
          await runtime.agent.run(enabled.turnId);
          assert(
            requests.every(request => request.tools.some(item => item.name === 'knowledge_propose')),
            '开启后新回合开放工具'
          );
          assert.equal(items().length, 1);
          assert.equal(reads, 2);
        },
        {
          knowledgeProposals: async () => {
            reads++;
            return on;
          }
        }
      );
    }
  },
  {
    name: '知识提议开关：回合开始时读取并固定，回合中途切换不影响本回合（开→关与关→开）；读取失败按关闭处理',
    run: async () => {
      for (const startOn of [true, false]) {
        let on = startOn,
          flipped = false;
        await fixture(
          async ({ app, runtime, space, requests, submit, policy, items, respond }) => {
            const note = app.modules.knowledge.noteService.createNote({
              spaceId: space.id,
              title: '笔记',
              rawMarkdown: MARKDOWN
            });
            const p = await policy();
            let round = 0;
            respond(() => {
              round++;
              if (round === 1) {
                on = !startOn;
                flipped = true;
                return tool('notes_read', { noteId: note.id });
              } // 第一轮模型调用期间切换开关
              if (round === 2 && startOn) return tool('knowledge_propose', proposal(note.id));
              return answer(startOn ? '已提交。' : '已回答。', startOn ? [{ sourceId: 'S1', quote: Q1 }] : []);
            });
            const turn = await submit('提炼这篇笔记的知识点', `mid-${startOn}`, p.policyId);
            await runtime.agent.run(turn.turnId);
            assert(flipped);
            assert(
              requests.every(request => request.tools.some(item => item.name === 'knowledge_propose') === startOn),
              `本回合沿用开始时的开关（${startOn}）`
            );
            assert.equal(items().length, startOn ? 1 : 0, '开→关：本回合仍可保存；关→开：本回合不开放');
            requests.length = 0;
            round = 10;
            const next = await submit('提炼这篇笔记的知识点', `mid-next-${startOn}`, p.policyId);
            await runtime.agent.run(next.turnId);
            assert(
              requests.every(request => request.tools.some(item => item.name === 'knowledge_propose') === !startOn),
              '下一个回合读取新的开关值'
            );
          },
          { knowledgeProposals: async () => on }
        );
      }
      await fixture(
        async ({ app, runtime, space, requests, submit, policy, respond }) => {
          app.modules.knowledge.noteService.createNote({ spaceId: space.id, title: '笔记', rawMarkdown: MARKDOWN });
          const p = await policy();
          respond(() => answer('已回答。', []));
          const turn = await submit('提炼这篇笔记的知识点', 'gate-throws', p.policyId);
          await runtime.agent.run(turn.turnId);
          assert(
            requests.length &&
              requests.every(request => !request.tools.some(item => item.name === 'knowledge_propose')),
            '读取失败按关闭处理'
          );
        },
        {
          knowledgeProposals: async () => {
            throw new Error('读取开关失败');
          }
        }
      );
    }
  },
  {
    name: '知识提议：普通提问不开放该工具，即使已启用',
    run: () =>
      fixture(async ({ app, runtime, space, requests, submit, policy, respond }) => {
        app.modules.knowledge.noteService.createNote({ spaceId: space.id, title: '笔记', rawMarkdown: MARKDOWN });
        const p = await policy();
        respond(() => answer('这篇笔记讲数据增强。', []));
        const turn = await submit('这篇笔记讲了什么', 'plain', p.policyId);
        await runtime.agent.run(turn.turnId);
        assert(requests.every(request => !request.tools.some(item => item.name === 'knowledge_propose')));
        assert(
          requests.every(request => !JSON.stringify(request.messages).includes('这是提炼知识点请求')),
          '普通提问不得带提炼指引'
        );
        assert(
          requests.every(request => request.maxTokens === 4096),
          '所有对话回合统一使用 4096 输出上限'
        );
      })
  },
  {
    name: '知识提议：否定与解释类请求不开放该工具，也不会保存候选',
    run: async () => {
      for (const text of ['我不希望你生成知识点', '不要根据这篇笔记自动生成知识点', '请解释知识项如何提炼']) {
        await fixture(async ({ app, runtime, space, requests, submit, policy, items, respond }) => {
          app.modules.knowledge.noteService.createNote({ spaceId: space.id, title: '笔记', rawMarkdown: MARKDOWN });
          const p = await policy();
          respond(() => answer('好的，不会生成。', []));
          const turn = await submit(text, 'plain', p.policyId);
          await runtime.agent.run(turn.turnId);
          assert(
            requests.every(request => !request.tools.some(item => item.name === 'knowledge_propose')),
            text
          );
          assert.equal(items().length, 0, text);
        });
      }
    }
  },
  {
    name: '知识提议：提议回合放宽轮数，保存成功算进展，连续分批提交不被判无进展',
    run: () =>
      fixture(async ({ app, runtime, space, requests, submit, policy, items, respond }) => {
        const sentences = [
          '甲概念是第一个要点。',
          '乙概念是第二个要点。',
          '丙概念是第三个要点。',
          '丁概念是第四个要点。',
          '戊概念是第五个要点。'
        ];
        const content = sentences.join('\n\n');
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '多要点',
          rawMarkdown: content
        });
        const p = await policy();
        let round = 0;
        const propose = index =>
          tool(
            'knowledge_propose',
            {
              candidates: [
                {
                  title: `要点${index}`,
                  canonicalStatement: sentences[index],
                  knowledgeType: 'concept',
                  citations: [
                    {
                      noteId: note.id,
                      start: content.indexOf(sentences[index]),
                      end: content.indexOf(sentences[index]) + sentences[index].length,
                      quote: sentences[index]
                    }
                  ]
                }
              ]
            },
            `p${index}`
          );
        respond(() =>
          round < 5 ? propose(round++) : answer('已提交五个要点。', [{ sourceId: 'S1', quote: sentences[0] }])
        );
        const turn = await submit('帮我提炼多要点笔记的知识点', 'batches', p.policyId);
        await runtime.agent.run(turn.turnId);
        assert.equal(items().length, 5);
        assert.equal(requests.length, 6);
        assert(requests[4].tools.some(item => item.name === 'knowledge_propose'));
        assert.equal(
          (await toolCalls(runtime, turn, 'knowledge_propose')).filter(call => call.status === 'succeeded').length,
          5
        );
      })
  },
  {
    name: '知识提议：与已有知识或本次其他候选陈述重复时整体拒绝并只提示序号',
    run: () =>
      fixture(async ({ app, runtime, space, requests, submit, policy, items, respond }) => {
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '笔记',
          rawMarkdown: MARKDOWN
        });
        const p = await policy();
        let round = 0;
        const twice = proposal(note.id);
        twice.candidates.push({ ...structuredClone(twice.candidates[0]), title: '数据增强（重复）' });
        respond(() =>
          ++round === 1
            ? tool('knowledge_propose', proposal(note.id), 'first')
            : round === 2
              ? tool('knowledge_propose', proposal(note.id), 'second')
              : round === 3
                ? tool('knowledge_propose', twice, 'third')
                : answer('已完成。', [{ sourceId: 'S1', quote: Q1 }])
        );
        const turn = await submit('提炼这篇笔记的知识点', 'dup', p.policyId);
        await runtime.agent.run(turn.turnId);
        const calls = await toolCalls(runtime, turn, 'knowledge_propose');
        assert.deepEqual(
          calls.map(call => call.status),
          ['succeeded', 'failed', 'failed']
        );
        assert.deepEqual(
          calls.slice(1).map(call => call.errorCode),
          ['AI_PROPOSAL_DUPLICATE', 'AI_PROPOSAL_DUPLICATE']
        );
        assert.equal(items().length, 1);
        const feedback = JSON.stringify(requests[2].messages);
        assert(feedback.includes('第 1 个候选'));
        assert(!feedback.includes('数据增强（重复）'));
      })
  },
  {
    name: '预算：北京日额度为 20 元，单任务预留上限仍为 2 元',
    async run() {
      const { DAILY_LIMIT_MICROUNITS, JOB_LIMIT_MICROUNITS } = await import('../src/modules/ai/budget-ledger.ts');
      assert.equal(DAILY_LIMIT_MICROUNITS, 20_000_000);
      assert.equal(JOB_LIMIT_MICROUNITS, 2_000_000);
    }
  },
  {
    name: '知识保存：取消、租约失效或授权撤销/收窄后迟到的提议不得入库',
    run: () =>
      commitFixture(async ({ app, note, build, make, state, origin, identity, grantId, generation }) => {
        const plan = await build(),
          items = () => app.modules.knowledge.repositories.knowledgeItemRepository.list().length;
        const save = () =>
          make().commit({
            plan,
            origin,
            identity,
            grantId,
            generation,
            provider: 'deepseek',
            modelId: 'deepseek-flash'
          });
        const past = new Date(Date.now() - 1000).toISOString();
        const scenarios = {
          回合已取消: [
            () => {
              state.turn.status = 'cancelled';
            },
            'AI_CANCELLED'
          ],
          回合租约代数变化: [
            () => {
              state.turn.leaseGeneration = 2;
            },
            'AI_CANCELLED'
          ],
          回合租约过期: [
            () => {
              state.turn.leaseExpiresAt = past;
            },
            'AI_CANCELLED'
          ],
          运行授权过期: [
            () => {
              state.grant.expiresAt = past;
            },
            'AI_ACCESS_REVOKED'
          ],
          运行授权缺少读取工具: [
            () => {
              state.grant.allowedTools = ['notes_search'];
            },
            'AI_ACCESS_REVOKED'
          ],
          策略已撤销: [
            () => {
              state.policy.revokedAt = past;
            },
            'AI_ACCESS_REVOKED'
          ],
          策略修订变化: [
            () => {
              state.policy.revision = 2;
            },
            'AI_ACCESS_REVOKED'
          ],
          来源笔记被策略排除: [
            () => {
              state.policy.excludedNoteIds = [note.id];
            },
            'AI_ACCESS_REVOKED'
          ],
          策略收窄为不含来源的固定集合: [
            () => {
              state.policy.scope = { kind: 'fixed', noteIds: ['other-note'] };
            },
            'AI_ACCESS_REVOKED'
          ],
          策略收窄为不含来源的目录: [
            () => {
              state.policy.scope = { kind: 'folder', folderId: 'missing-folder' };
            },
            'AI_ACCESS_REVOKED'
          ]
        };
        const baseline = structuredClone(state);
        for (const [name, [mutate, code]] of Object.entries(scenarios)) {
          Object.assign(state, structuredClone(baseline));
          mutate();
          await assert.rejects(save(), { code }, name);
          assert.equal(items(), 0, name);
        }
        Object.assign(state, structuredClone(baseline));
        assert.equal((await save()).result.candidates.length, 2);
      })
  },
  {
    name: '知识保存：提交后响应丢失按回执对账为成功，重试不重复也不因原文后续变化而误报失败',
    run: () =>
      commitFixture(async ({ app, note, make, origin, identity, grantId, generation }) => {
        const repos = app.modules.knowledge.repositories,
          inputs = proposalInputs(app, note);
        const lossy = {
          get: input => app.coreOperationStore.get(input),
          async commit(...args) {
            await app.coreOperationStore.commit(...args);
            throw new Error('connection lost after commit');
          }
        };
        const service = make(lossy),
          real = make();
        const wrap = commitService => ({
          find: () => commitService.findCommitted({ origin, identity }),
          save: plan =>
            commitService.commit({
              plan,
              origin,
              identity,
              grantId,
              generation,
              provider: 'deepseek',
              modelId: 'deepseek-flash'
            })
        });
        // 核心提交成功但响应丢失：工具按回执报告成功，而不是失败。
        const first = await proposeKnowledge({
          ...inputs,
          grantId: 'g',
          turnId: origin.turnId,
          callId: origin.toolCallId,
          commit: wrap(service)
        });
        assert.equal(first.resultJson.status, 'saved');
        assert.equal(first.resultJson.candidates.length, 2);
        assert.equal(repos.knowledgeItemRepository.list().length, 2);
        // 没有提交时，真实失败仍按失败报告（不会被对账吞掉）。
        const never = {
          find: async () => null,
          save: async () => {
            throw new Error('boom');
          }
        };
        await assert.rejects(
          proposeKnowledge({ ...inputs, grantId: 'g', turnId: 'other-turn', callId: 'other-call', commit: never }),
          /boom/
        );
        // 原文后续被修改：同一调用重试仍按回执报告成功，不重新读取来源，也不重复保存。
        app.modules.knowledge.noteService.updateNote(note.id, {
          rawMarkdown: `${note.rawMarkdown}\n\n新增一段。`,
          expectedUpdatedAt: note.updatedAt
        });
        const retried = await proposeKnowledge({
          args: { candidates: [] },
          sourceRefs: [],
          grantId: 'g',
          turnId: origin.turnId,
          callId: origin.toolCallId,
          access: {
            async verifyRead() {
              throw new Error('已提交的调用不应重新读取来源');
            }
          },
          commit: { ...wrap(real), save: () => assert.fail('不得重复保存') }
        });
        assert.equal(retried.resultJson.status, 'saved');
        assert.equal(retried.resultJson.candidates.length, 2);
        assert.equal(retried.resultJson.candidates[0].citationCount, 1);
        assert.equal(repos.knowledgeItemRepository.list().length, 2);
      })
  }
];
