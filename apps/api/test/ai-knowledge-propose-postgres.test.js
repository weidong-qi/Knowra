import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresAppContext } from '../src/postgres-app.factory.js';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { createOptionalAiRuntime } from '../src/modules/ai/runtime.js';
import { createPostgresCoreOperationStore } from '../src/infrastructure/postgres-core-operation-store.ts';
import { createPostgresBudgetAuthority } from '../src/modules/ai/postgres-budget-authority.js';

const priceProfile = {
  version: 'propose-pg-v1',
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
const answer = (content, citations) => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answer: content, citations }) } }],
  usage: { prompt_tokens: 10, completion_tokens: 10 }
});
const Q1 = '数据增强通过变换样本增加训练变化。';
const MARKDOWN = `${Q1}\n\n过拟合指模型在训练集表现好而泛化差。`;
const proposal = noteId => ({
  candidates: [
    {
      title: '数据增强',
      canonicalStatement: Q1,
      knowledgeType: 'concept',
      citations: [{ noteId, start: 0, end: Q1.length, quote: Q1 }]
    }
  ]
});

async function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-propose-pg-'));
  let database, app, runtime;
  try {
    database = await createPostgresTestDatabase();
    const ownerId = `propose-${randomUUID()}`;
    app = await createPostgresAppContext({ databaseUrl: database.databaseUrl, ownerId, storageRootDir: root });
    const space = await app.http.knowledge.createDefaultKnowledgeSpace();
    const requests = [],
      commitErrors = [];
    const core = createPostgresCoreOperationStore({ client: app.prisma, ownerId });
    const coreOperationStore = {
      get: input => core.get(input),
      commit: (...args) =>
        core.commit(...args).catch(error => {
          commitErrors.push(error.code);
          throw error;
        })
    };
    let respond = () => answer('完成', []);
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
      repository: app.ai.repository,
      accessStore: app.ai.accessStore,
      conversationStore: app.ai.conversationStore,
      actionStore: app.ai.actionStore,
      coreOperationStore,
      knowledge: { ...app.modules.knowledge, repositories: app.repositories },
      asyncDomain: true,
      budgetAuthority: createPostgresBudgetAuthority(app.prisma),
      priceProfile,
      knowledgeProposals: true,
      contextSources: { ...app.repositories, spaceRepository: app.repositories.knowledgeSpaceRepository, ownerId }
    });
    const conversation = await runtime.conversation.create({ spaceId: space.id });
    const submit = (content, key, requestedPolicyId) =>
      runtime.conversationStore.submitTurn({
        ownerId,
        conversationId: conversation.conversationId,
        content,
        idempotencyKey: `pg-propose-${key}`,
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
    const items = () => app.repositories.knowledgeItemRepository.list({});
    await run({
      app,
      runtime,
      space,
      ownerId,
      requests,
      commitErrors,
      submit,
      policy,
      items,
      respond: next => {
        respond = next;
      },
      createNote: input => app.modules.knowledge.noteService.createNote({ spaceId: space.id, ...input })
    });
  } finally {
    await runtime?.agent?.close();
    await app?.close();
    await database?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const enabled = process.env.KNOWRA_SYNC_TEST_DATABASE_URL && process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES === '1';
export const aiKnowledgeProposePostgresTests = enabled
  ? [
      {
        name: '真实 PostgreSQL 知识提议：读后提交在核心账本事务内保存候选与 agent 来源摘要，重复提交不重复创建',
        run: () =>
          withFixture(async f => {
            const note = await f.createNote({ title: '笔记', rawMarkdown: MARKDOWN });
            const p = await f.policy();
            let round = 0;
            f.respond(() =>
              ++round === 1
                ? tool('notes_read', { noteId: note.id })
                : round === 2
                  ? tool('knowledge_propose', proposal(note.id))
                  : answer('已提交一条候选。', [{ sourceId: 'S1', quote: Q1 }])
            );
            const turn = await f.submit('提炼这篇笔记的知识点', 'ok', p.policyId);
            await f.runtime.agent.run(turn.turnId);
            const calls = (await f.runtime.conversationStore.listToolCalls(turn.turnId)).filter(
              call => call.toolName === 'knowledge_propose'
            );
            assert.equal(calls.length, 1);
            assert.equal(calls[0].status, 'succeeded');
            assert.equal(calls[0].resultJson.saved, true);
            const items = await f.items();
            assert.equal(items.length, 1);
            assert.equal(items[0].reviewStatus, 'candidate');
            assert.equal(items[0].sourceMode, 'ai');
            const provenance = await f.app.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(
              items[0].id
            );
            assert.equal(provenance.executionMode, 'agent');
            assert.equal(provenance.origin.turnId, turn.turnId);
            assert.equal(provenance.sources[0].quoteText, Q1);
            const evidence = await f.app.repositories.knowledgeEvidenceRepository.list({
              knowledgeItemId: items[0].id
            });
            assert.equal(evidence.length, 1);
            // 重新提交同一回合会话幂等键不会再产生第二条候选
            const again = await f.submit('提炼这篇笔记的知识点', 'ok', p.policyId);
            assert.equal(again.turnId, turn.turnId);
            assert.equal((await f.items()).length, 1);
          })
      },
      {
        name: '真实 PostgreSQL 知识提议：校验通过后、保存事务内授权已被撤销则整体拒绝，库内不留任何候选或来源摘要',
        run: () =>
          withFixture(async f => {
            const note = await f.createNote({ title: '笔记', rawMarkdown: MARKDOWN });
            const p = await f.policy();
            let round = 0,
              armed = false;
            const verifyRead = f.runtime.access.verifyRead;
            // 在提议通过读取校验之后、进入核心事务之前撤销授权，模拟校验与保存之间的窗口。
            f.runtime.access.verifyRead = async (...args) => {
              const value = await verifyRead.apply(f.runtime.access, args);
              if (armed) {
                armed = false;
                await f.runtime.access.narrowPolicy(p.policyId, { revision: p.revision, revoke: true });
              }
              return value;
            };
            f.respond(() => {
              if (++round === 1) return tool('notes_read', { noteId: note.id });
              if (round === 2) {
                armed = true;
                return tool('knowledge_propose', proposal(note.id));
              }
              return answer('授权已撤销。', []);
            });
            const turn = await f.submit('提炼这篇笔记的知识点', 'revoked', p.policyId);
            await f.runtime.agent.run(turn.turnId).catch(() => {});
            assert.equal(armed, false, '撤销钩子必须在提议校验之后触发');
            assert.equal((await f.items()).length, 0);
            assert.equal((await f.app.repositories.knowledgeEvidenceRepository.list({})).length, 0);
            const calls = (await f.runtime.conversationStore.listToolCalls(turn.turnId)).filter(
              call => call.toolName === 'knowledge_propose'
            );
            assert.deepEqual(f.commitErrors, ['AI_ACCESS_REVOKED']);
            assert.equal(calls.length, 1);
            assert.notEqual(calls[0].status, 'succeeded');
          })
      },
      {
        name: '真实 PostgreSQL 知识提议：与已有知识陈述重复时整体拒绝',
        run: () =>
          withFixture(async f => {
            const note = await f.createNote({ title: '笔记', rawMarkdown: MARKDOWN });
            const p = await f.policy();
            let round = 0;
            f.respond(() =>
              ++round === 1
                ? tool('notes_read', { noteId: note.id })
                : round === 2
                  ? tool('knowledge_propose', proposal(note.id), 'first')
                  : round === 3
                    ? tool('knowledge_propose', proposal(note.id), 'second')
                    : answer('完成。', [{ sourceId: 'S1', quote: Q1 }])
            );
            const turn = await f.submit('提炼这篇笔记的知识点', 'dup', p.policyId);
            await f.runtime.agent.run(turn.turnId);
            assert.equal((await f.items()).length, 1);
            const calls = (await f.runtime.conversationStore.listToolCalls(turn.turnId)).filter(
              call => call.toolName === 'knowledge_propose'
            );
            assert.deepEqual(calls.map(call => call.status).sort(), ['failed', 'succeeded']);
          })
      }
    ]
  : [];
