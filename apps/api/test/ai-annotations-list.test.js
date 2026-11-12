import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import { markText } from './fixtures/inline-annotation-seed.js';
import { createPersistentAppContext } from '../src/app.factory.js';
import { createOptionalAiRuntime } from '../src/modules/ai/runtime.js';
import { listAnnotatedRanges } from '../src/modules/ai/annotation-read-tool.ts';

const priceProfile = {
  version: 'annotations-synthetic-v1',
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

const MARKDOWN = '普通段落\n\n重点段落\n\n核心段落\n\n无等级段落';
// 每段一条重点，写在正文标记里；无等级的重点按普通处理。
const MARKED = [
  markText('普通段落', 'normal', 'normal'),
  markText('重点段落', 'important', 'important'),
  markText('核心段落', 'core', 'core'),
  markText('无等级段落', 'unrated')
].join('\n\n');
async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-annotations-list-'));
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
        idempotencyKey: `annotations-${key}`,
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
    await run({
      app,
      runtime,
      space,
      requests,
      submit,
      policy,
      respond: next => {
        respond = next;
      }
    });
  } finally {
    await runtime?.agent?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const fakeAccess = (content, extra = {}) => ({
  async verifyRead({ noteId }) {
    return {
      note: { id: noteId, spaceId: 's', title: '标题' },
      version: { id: 'v1', content },
      contentHash: calculateContentHash(content),
      ...extra
    };
  }
});
const record = (content, overrides) => ({
  id: 'a',
  lifecycleStatus: 'active',
  anchorStatus: 'resolved',
  noteContentHash: calculateContentHash(content),
  fromPosition: 0,
  toPosition: 2,
  importance: 'normal',
  kind: 'important',
  scopeType: 'selection',
  headingPath: [],
  ...overrides
});

export const aiAnnotationsListTests = [
  {
    name: '重点列表：Agent 可调用，按重要度排序并带可校验的来源引用',
    run: () =>
      fixture(async ({ app, runtime, space, requests, submit, policy, respond }) => {
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '重点笔记',
          rawMarkdown: MARKED
        });
        const p = await policy();
        let round = 0;
        respond(() =>
          ++round === 1
            ? tool('annotations_list', { noteId: note.id, minImportance: 'important' })
            : answer('核心段落是最重要的重点。', [{ sourceId: 'S1', quote: '核心段落' }])
        );
        const turn = await submit('看看这篇笔记的重点', 'list', p.policyId);
        await runtime.agent.run(turn.turnId);
        assert(requests[0].tools.some(item => item.name === 'annotations_list'));
        const [call] = (await runtime.conversationStore.listToolCalls(turn.turnId)).filter(
          item => item.toolName === 'annotations_list'
        );
        assert.equal(call.status, 'succeeded');
        assert.deepEqual(
          call.resultJson.annotations.map(item => [item.importance, item.text]),
          [
            ['core', '核心段落'],
            ['important', '重点段落']
          ]
        );
        assert.equal(call.resultJson.total, 2);
        assert.equal(call.resultJson.hasMore, false);
        assert.equal(call.sourceRefs.length, 2);
        for (const ref of call.sourceRefs) {
          const item = call.resultJson.annotations.find(entry => entry.start === ref.start);
          assert.equal(ref.quoteHash, calculateContentHash(item.text));
          assert.equal(ref.contentHash, calculateContentHash(MARKED));
        }
      })
  },
  {
    name: '重点列表：私密笔记被拒绝且不返回内容',
    run: () =>
      fixture(async ({ app, runtime, space, submit, policy, respond }) => {
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '私密',
          rawMarkdown: markText('核心段落', 'core', 'core')
        });
        app.modules.knowledge.noteService.updateNote(note.id, { aiVisibility: 'private' });
        const p = await policy();
        let round = 0;
        respond(() =>
          ++round === 1 ? tool('annotations_list', { noteId: note.id }) : answer('无法读取这篇笔记。', [])
        );
        const turn = await submit('列出重点', 'private', p.policyId);
        await runtime.agent.run(turn.turnId);
        const [call] = (await runtime.conversationStore.listToolCalls(turn.turnId)).filter(
          item => item.toolName === 'annotations_list'
        );
        assert.equal(call.resultJson?.annotations, undefined);
        assert.deepEqual(call.sourceRefs ?? [], []);
      })
  },
  {
    name: '重点列表：明确写意图的回合不开放该工具',
    run: () =>
      fixture(async ({ app, runtime, space, requests, submit, policy, respond }) => {
        app.modules.knowledge.noteService.createNote({ spaceId: space.id, title: '笔记', rawMarkdown: MARKDOWN });
        const p = await policy();
        respond(() => answer('不写'));
        const turn = await runtime.conversationStore.submitTurn({
          ownerId: 'test',
          conversationId: (await runtime.conversation.create({ spaceId: space.id })).conversationId,
          content: '追加一行',
          idempotencyKey: 'annotations-write',
          requestedPolicyId: p.policyId,
          writeIntent: { toolName: 'notes_create' }
        });
        await runtime.agent.run(turn.turnId).catch(() => undefined);
        assert(
          requests.length === 0 ||
            requests.every(request => !request.tools.some(item => item.name === 'annotations_list'))
        );
      })
  },
  {
    name: '重点列表：失效/待核对/越界的重点只计数，其余分页稳定',
    async run() {
      const content = '甲乙丙丁戊己庚辛壬癸';
      const rows = [
        record(content, { id: 'ok-1', fromPosition: 0, toPosition: 2 }),
        record(content, { id: 'ok-2', fromPosition: 2, toPosition: 4, importance: 'core' }),
        record(content, { id: 'ok-3', fromPosition: 4, toPosition: 6 }),
        record(content, { id: 'stale', noteContentHash: 'other' }),
        record(content, { id: 'review', anchorStatus: 'needsReview' }),
        record(content, { id: 'archived', lifecycleStatus: 'archived' }),
        record(content, { id: 'out', fromPosition: 8, toPosition: 99 })
      ];
      const repository = { list: () => rows };
      const first = await listAnnotatedRanges({
        access: fakeAccess(content),
        repository,
        grantId: 'g',
        args: { noteId: 'n', limit: 2 }
      });
      assert.deepEqual(
        first.resultJson.annotations.map(item => item.annotationId),
        ['ok-2', 'ok-1']
      );
      assert.equal(first.resultJson.total, 3);
      assert.equal(first.resultJson.hasMore, true);
      assert.equal(first.resultJson.unavailableCount, 3);
      const next = await listAnnotatedRanges({
        access: fakeAccess(content),
        repository,
        grantId: 'g',
        args: { noteId: 'n', limit: 2, offset: 2 }
      });
      assert.deepEqual(
        next.resultJson.annotations.map(item => item.annotationId),
        ['ok-3']
      );
      assert.equal(next.resultJson.hasMore, false);
    }
  },
  {
    name: '重点列表：长重点按 1000 单位截断并标记，且不切断 emoji',
    async run() {
      const content = `${'字'.repeat(999)}😀${'尾'.repeat(10)}`;
      const result = await listAnnotatedRanges({
        access: fakeAccess(content),
        grantId: 'g',
        args: { noteId: 'n' },
        repository: { list: () => [record(content, { fromPosition: 0, toPosition: content.length })] }
      });
      const [item] = result.resultJson.annotations;
      assert.equal(item.truncated, true);
      assert.equal(item.end, 999);
      assert.equal(item.text, '字'.repeat(999));
      assert.equal(result.sourceRefs[0].end, 999);
    }
  },
  {
    name: '重点列表：参数严格校验',
    async run() {
      const call = args =>
        listAnnotatedRanges({ access: fakeAccess('abc'), repository: { list: () => [] }, grantId: 'g', args });
      for (const args of [
        null,
        {},
        { noteId: '' },
        { noteId: 'n', extra: 1 },
        { noteId: 'n', minImportance: 'high' },
        { noteId: 'n', limit: 0 },
        { noteId: 'n', limit: 9 },
        { noteId: 'n', offset: -1 },
        { noteId: 'n', limit: 1.5 }
      ]) {
        await assert.rejects(call(args), { code: 'AI_TOOL_ARGUMENTS_INVALID' });
      }
    }
  }
];
