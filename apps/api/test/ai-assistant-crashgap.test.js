import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPersistentAppContext } from '../src/app.factory.ts';
import { createOptionalAiRuntime } from '../src/modules/ai/runtime.ts';

const priceProfile = {
  version: 'crashgap-synthetic-v1',
  modelId: 'deepseek-flash',
  expiresAt: '2030-01-01T00:00:00Z',
  inputMicrounitsPerMillion: 2000000,
  outputMicrounitsPerMillion: 8000000
};
const createTool = args => ({
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: [
          {
            id: 'durable-create',
            type: 'function',
            function: { name: 'notes_create', arguments: JSON.stringify(args) }
          }
        ]
      }
    }
  ],
  usage: { prompt_tokens: 10, completion_tokens: 10 }
});

async function withRestartedRuntime(revision, faultPhase = 'receipt') {
  const storageRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-agent-crashgap-'));
  let app,
    runtime,
    modelCalls = 0,
    nextArgs = { title: '崩溃成果', rawMarkdown: '原始新稿' };
  const open = () => {
    app = createPersistentAppContext({ storageRootDir, ownerId: 'test' });
    runtime = createOptionalAiRuntime({
      modelSettings: {
        credentialReference: async () => ({ modelId: 'deepseek-flash', credentialRef: 'synthetic' }),
        resolveCredential: async () => {
          throw new Error('Synthetic test must not read credentials');
        }
      },
      providerAdapter: {
        provider: 'mock',
        capabilities: () => ({ provider: 'mock' }),
        async *stream() {},
        async complete() {
          modelCalls++;
          return createTool(nextArgs);
        }
      },
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
  };
  const close = async () => {
    await runtime?.agent?.close();
    await app?.close();
  };
  try {
    open();
    const space = app.http.knowledge.createDefaultKnowledgeSpace();
    const conversation = await runtime.conversation.create({ spaceId: space.id });
    const submit = content =>
      runtime.conversationStore.submitTurn({
        ownerId: 'test',
        conversationId: conversation.conversationId,
        content,
        idempotencyKey: revision
          ? content === '短一点'
            ? 'crash-revision-second'
            : 'crash-revision-first'
          : 'crash-create-first'
      });
    let original;
    if (revision) {
      const first = await submit('生成笔记新稿');
      await runtime.agent.run(first.turnId);
      [original] = await runtime.actions.listInbox(space.id);
      nextArgs = { actionId: original.actionId, title: '崩溃成果', rawMarkdown: '短稿' };
    }
    const settle = runtime.conversationStore.settleToolCall;
    let faulted = false;
    runtime.conversationStore.settleToolCall = async (...args) => {
      if (faultPhase === 'receipt' && !faulted && args[3]?.resultJson?.actionId) {
        faulted = true;
        throw Object.assign(new Error('synthetic write failure after action commit before tool receipt'), {
          code: 'AI_SYNTHETIC_IO_FAULT'
        });
      }
      return settle(...args);
    };
    if (faultPhase === 'service') {
      const plan = runtime.actions.planForAssistantTurn;
      runtime.actions.planForAssistantTurn = async (...args) => {
        const committed = await plan(...args);
        if (!faulted) {
          faulted = true;
          throw Object.assign(new Error('synthetic action service response lost after persistent commit'), {
            code: 'AI_SYNTHETIC_IO_FAULT'
          });
        }
        return committed;
      };
    }
    const submitted = await submit(revision ? '短一点' : '生成笔记新稿');
    await assert.rejects(runtime.agent.run(submitted.turnId), { code: 'AI_SYNTHETIC_IO_FAULT' });
    const [committed] = await runtime.actions.listInbox(space.id);
    const callsBefore = modelCalls;
    assert.equal((await runtime.conversationStore.listToolCalls(submitted.turnId))[0].status, 'requested');
    assert.equal(committed.plan.items[0].after.rawMarkdown, revision ? '短稿' : '原始新稿');
    await close();
    open(); // 实际重新打开 JSON 磁盘文件，绝不复用原内存 store。
    await runtime.agent.run(submitted.turnId);
    const turn = await runtime.conversationStore.getTurn(submitted.turnId);
    const [replayed] = await runtime.actions.listInbox(space.id);
    assert.equal(modelCalls, callsBefore);
    assert.equal(turn.status, 'succeeded');
    assert.equal(replayed.actionId, committed.actionId);
    assert.equal(replayed.operationId, committed.operationId);
    assert.equal(replayed.plan.planHash, committed.plan.planHash);
    assert.deepEqual(replayed.plan.items[0].baseline, committed.plan.items[0].baseline);
    assert.equal((await runtime.conversationStore.listToolCalls(submitted.turnId))[0].status, 'succeeded');
    if (revision) {
      assert.equal(replayed.inboxEvents.length, 1);
      assert.equal(replayed.inboxEvents[0].originGeneration, turn.leaseGeneration);
      assert.equal(replayed.plan.items[0].after.id, original.plan.items[0].after.id);
    } else assert.equal(replayed.grant.originGeneration, turn.leaseGeneration);
    await runtime.actions.approve(replayed.actionId, { planHash: replayed.plan.planHash });
    await runtime.actions.apply(replayed.actionId);
    await runtime.actions.apply(replayed.actionId);
    assert.equal(app.dataStore.state.notes.length, 1);
    assert.equal(
      app.modules.knowledge.noteService.getNote(replayed.plan.items[0].after.id).rawMarkdown,
      revision ? '短稿' : '原始新稿'
    );
  } finally {
    await close();
    fs.rmSync(storageRootDir, { recursive: true, force: true });
  }
}
export const aiAssistantCrashgapTests = [
  {
    name: 'Agent 新稿已提交而工具回执写盘失败，JSON重开续跑复用唯一成果并可采纳',
    run: () => withRestartedRuntime(false)
  },
  {
    name: 'Agent 修订已提交而工具回执写盘失败，JSON重开复用原输入CAS与唯一修订并可采纳',
    run: () => withRestartedRuntime(true)
  },
  {
    name: 'Agent 新稿服务响应丢失保留requested，JSON重开仅复用已提交成果',
    run: () => withRestartedRuntime(false, 'service')
  },
  {
    name: 'Agent 修订服务响应丢失保留requested，JSON重开原CAS重放不重复修订',
    run: () => withRestartedRuntime(true, 'service')
  }
];
