import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPersistentAppContext } from '../src/app.factory.js';
import { validateConversationRecord } from '../src/modules/ai/conversation-store.ts';
import { createOptionalAiRuntime } from '../src/modules/ai/runtime.js';
const priceProfile = {
  version: 'synthetic-v1',
  modelId: 'deepseek-flash',
  expiresAt: '2030-01-01T00:00:00.000Z',
  inputMicrounitsPerMillion: 2000000,
  outputMicrounitsPerMillion: 8000000
};
async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-p2-agent-'));
  let runtime;
  try {
    const app = createPersistentAppContext({ storageRootDir: root, ownerId: 'test' }),
      space = app.http.knowledge.createDefaultKnowledgeSpace();
    let resolveCall,
      tool = {
        name: 'notes_create',
        arguments: JSON.stringify({ title: '合成 Agent 记录', rawMarkdown: '只保存一次' })
      };
    const adapter = {
      async *stream() {
        yield Promise.reject(new Error('not tested'));
      },
      provider: 'mock',
      capabilities: () => ({ provider: 'mock' }),
      complete: request =>
        new Promise(resolve => {
          resolveCall = () =>
            resolve({
              choices: [
                {
                  finish_reason: 'tool_calls',
                  message: { content: null, tool_calls: [{ id: 'synthetic-tool', type: 'function', function: tool }] }
                }
              ],
              usage: { prompt_tokens: 10, completion_tokens: 10 }
            });
        }),
      release: () => resolveCall?.(),
      setTool: next => {
        tool = next;
      }
    };
    runtime = createOptionalAiRuntime({
      modelSettings: {
        credentialReference: async () => ({ modelId: 'deepseek-flash', credentialRef: 'synthetic' }),
        resolveCredential: async () => {
          throw new Error('never credentials');
        }
      },
      providerAdapter: adapter,
      repository: app.dataStore.aiRepository,
      accessStore: app.dataStore.aiAccessStore,
      conversationStore: app.dataStore.aiConversationStore,
      actionStore: app.dataStore.aiActionStore,
      coreOperationStore: app.coreOperationStore,
      knowledge: app.modules.knowledge,
      budgetAuthority: app.dataStore.aiBudgetAuthority,
      priceProfile,
      contextSources: {
        ...app.modules.knowledge.repositories,
        spaceRepository: app.modules.knowledge.repositories.knowledgeSpaceRepository,
        ownerId: 'test'
      }
    });
    await run({ app, space, runtime, adapter });
  } finally {
    await runtime?.agent?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
export const aiNoteActionAgentTests = [
  {
    name: 'P2 Agent 明确写入意图只生成待确认计划，普通聊天不授予写权限',
    run: () =>
      fixture(async ({ app, space, runtime, adapter }) => {
        const conversation = await runtime.conversation.create({ spaceId: space.id });
        const turn = await runtime.conversationStore.submitTurn({
          ownerId: 'test',
          conversationId: conversation.conversationId,
          content: '请记录为笔记',
          idempotencyKey: 'explicit-write',
          writeIntent: { toolName: 'notes_create' }
        });
        const running = runtime.agent.run(turn.turnId);
        running.catch(() => {});
        while (!(await runtime.conversationStore.listModelAttempts()).some(row => row.status === 'sent'))
          await new Promise(resolve => setTimeout(resolve, 2));
        adapter.release();
        await running;
        const [action] = await runtime.actions.list(space.id);
        assert.equal(action.status, 'awaitingApproval');
        assert.equal(app.dataStore.state.notes.length, 0);
        assert.equal((await runtime.conversationStore.getTurn(turn.turnId)).status, 'succeeded');
        assert.equal(action.grant.originTurnId, turn.turnId);
        await runtime.actions.approve(action.actionId, { planHash: action.plan.planHash });
        await runtime.actions.apply(action.actionId);
        assert.equal(app.dataStore.state.notes.length, 1);
        assert.equal(
          (await runtime.conversationStore.listMessages(conversation.conversationId)).at(-1).content,
          '已生成笔记计划，尚未写入。请在执行记录中查看差异并确认。'
        );
      })
  },
  {
    name: 'P2 取消后迟到模型工具不能生成或写入笔记计划',
    run: () =>
      fixture(async ({ app, space, runtime, adapter }) => {
        const conversation = await runtime.conversation.create({ spaceId: space.id });
        const turn = await runtime.conversationStore.submitTurn({
          ownerId: 'test',
          conversationId: conversation.conversationId,
          content: '请记录为笔记',
          idempotencyKey: 'cancel-write',
          writeIntent: { toolName: 'notes_create' }
        });
        const running = runtime.agent.run(turn.turnId);
        running.catch(() => {});
        while (!(await runtime.conversationStore.listModelAttempts()).some(row => row.status === 'sent'))
          await new Promise(resolve => setTimeout(resolve, 2));
        await runtime.conversation.cancel(conversation.conversationId, turn.turnId);
        adapter.release();
        await assert.rejects(running);
        assert.equal((await runtime.actions.list(space.id)).length, 0);
        assert.equal(app.dataStore.state.notes.length, 0);
      })
  },
  {
    name: 'P2 Agent 普通聊天无写权限，固定目标整理只生成受审计划',
    run: () =>
      fixture(async ({ app, space, runtime, adapter }) => {
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '合成目标',
          rawMarkdown: '正文'
        });
        const conversation = await runtime.conversation.create({ spaceId: space.id });
        const plain = await runtime.conversationStore.submitTurn({
          ownerId: 'test',
          conversationId: conversation.conversationId,
          content: '普通问题',
          idempotencyKey: 'plain-no-write'
        });
        let running = runtime.agent.run(plain.turnId);
        running.catch(() => {});
        while (
          !(await runtime.conversationStore.listModelAttempts()).some(
            row => row.turnId === plain.turnId && row.status === 'sent'
          )
        )
          await new Promise(resolve => setTimeout(resolve, 2));
        adapter.release();
        await assert.rejects(running);
        assert.equal((await runtime.actions.list(space.id)).length, 0);
        const policy = await runtime.access.createPolicy({
          spaceId: space.id,
          scope: { kind: 'fixed', noteIds: [note.id] },
          excludedNoteIds: [],
          includeAttachments: false,
          read: true,
          egress: true,
          recipients: ['deepseek'],
          expiresAt: new Date(Date.now() + 86400000).toISOString()
        });
        adapter.setTool({
          name: 'notes_propose_organize',
          arguments: JSON.stringify({ changes: [{ noteId: note.id, title: '整理后' }] })
        });
        const turn = await runtime.conversationStore.submitTurn({
          ownerId: 'test',
          conversationId: conversation.conversationId,
          content: '整理目标标题',
          idempotencyKey: 'organize-intent',
          requestedPolicyId: policy.policyId,
          writeIntent: { toolName: 'notes_propose_organize', noteId: note.id }
        });
        running = runtime.agent.run(turn.turnId);
        running.catch(() => {});
        while (
          !(await runtime.conversationStore.listModelAttempts()).some(
            row => row.turnId === turn.turnId && row.status === 'sent'
          )
        )
          await new Promise(resolve => setTimeout(resolve, 2));
        adapter.release();
        await running;
        const [action] = await runtime.actions.list(space.id);
        assert.equal(action.status, 'awaitingApproval');
        assert.equal(app.modules.knowledge.noteService.getNote(note.id).title, '合成目标');
        await runtime.actions.approve(action.actionId, { planHash: action.plan.planHash });
        await runtime.access.narrowPolicy(policy.policyId, { revision: policy.revision, revoke: true });
        await assert.rejects(runtime.actions.apply(action.actionId), { code: 'AI_ACTION_GRANT_REVOKED' });
        assert.equal(app.modules.knowledge.noteService.getNote(note.id).title, '合成目标');
      })
  },
  {
    name: 'P2 模型请求在途撤销授权与恢复 epoch 均拒绝迟到计划',
    run: () =>
      fixture(async ({ app, space, runtime, adapter }) => {
        const note = app.modules.knowledge.noteService.createNote({
            spaceId: space.id,
            title: '授权目标',
            rawMarkdown: '正文'
          }),
          conversation = await runtime.conversation.create({ spaceId: space.id });
        const policy = await runtime.access.createPolicy({
          spaceId: space.id,
          scope: { kind: 'fixed', noteIds: [note.id] },
          excludedNoteIds: [],
          includeAttachments: false,
          read: true,
          egress: true,
          recipients: ['deepseek'],
          expiresAt: new Date(Date.now() + 86400000).toISOString()
        });
        adapter.setTool({
          name: 'notes_append',
          arguments: JSON.stringify({ noteId: note.id, rawMarkdown: '迟到追加' })
        });
        const turn = await runtime.conversationStore.submitTurn({
          ownerId: 'test',
          conversationId: conversation.conversationId,
          content: '追加',
          idempotencyKey: 'revoke-inflight',
          requestedPolicyId: policy.policyId,
          writeIntent: { toolName: 'notes_append', noteId: note.id }
        });
        const running = runtime.agent.run(turn.turnId);
        running.catch(() => {});
        while (!(await runtime.conversationStore.listModelAttempts()).some(row => row.status === 'sent'))
          await new Promise(resolve => setTimeout(resolve, 2));
        await runtime.access.narrowPolicy(policy.policyId, { revision: 1, revoke: true });
        adapter.release();
        await assert.rejects(running);
        assert.equal((await runtime.actions.list(space.id)).length, 0);
        const identity = app.dataStore.aiRepository.identity();
        app.dataStore.aiRepository.rotateEpoch();
        await assert.rejects(
          runtime.actions.planForTurn({ ...turn, ...identity }, turn.writeIntent, {
            name: 'notes_append',
            arguments: { noteId: note.id, rawMarkdown: '旧 epoch' }
          }),
          { code: 'AI_DATASET_STALE' }
        );
      })
  },
  {
    name: 'P2 恢复的模型写入意图必须保留固定目标与工具语义',
    run: () =>
      fixture(async ({ space, runtime }) => {
        const conversation = await runtime.conversation.create({ spaceId: space.id }),
          turn = await runtime.conversationStore.submitTurn({
            ownerId: 'test',
            conversationId: conversation.conversationId,
            content: '合成指令',
            idempotencyKey: 'restore-target',
            writeIntent: { toolName: 'notes_create' }
          });
        for (const toolName of ['notes_append', 'notes_propose_patch', 'notes_propose_organize'])
          assert.throws(
            () => validateConversationRecord('aiConversationTurn', { ...turn, writeIntent: { toolName } }),
            { code: 'AI_RECORD_INVALID' }
          );
        assert.throws(
          () =>
            validateConversationRecord('aiConversationTurn', {
              ...turn,
              writeIntent: { toolName: 'notes_create', noteId: 'fake' }
            }),
          { code: 'AI_RECORD_INVALID' }
        );
      })
  }
];
