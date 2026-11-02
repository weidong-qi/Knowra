import assert from 'node:assert/strict';
import { aiAssistantCrashgapTests } from './ai-assistant-crashgap.test.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markParagraphs } from './fixtures/inline-annotation-seed.js';
import { createPersistentAppContext } from '../src/app.factory.js';
import { createOptionalAiRuntime } from '../src/modules/ai/runtime.js';
import { createAssistantWebSearch } from '../src/modules/ai/assistant-tools.js';

const priceProfile = {
  version: 'assistant-synthetic-v1',
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
async function fixture(run, webSearchAdapter = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-assistant-autonomy-'));
  let runtime;
  try {
    const app = createPersistentAppContext({ storageRootDir: root, ownerId: 'test' });
    const space = app.http.knowledge.createDefaultKnowledgeSpace();
    const requests = [];
    let respond = () => answer('普通回答');
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
      webSearchAdapter,
      contextSources: {
        ...app.modules.knowledge.repositories,
        spaceRepository: app.modules.knowledge.repositories.knowledgeSpaceRepository,
        ownerId: 'test'
      }
    });
    const conversation = await runtime.conversation.create({ spaceId: space.id });
    const submit = (content, idempotencyKey, requestedPolicyId = null, writeIntent = null) =>
      runtime.conversationStore.submitTurn({
        ownerId: 'test',
        conversationId: conversation.conversationId,
        content,
        idempotencyKey: `assistant-${idempotencyKey}`,
        requestedPolicyId,
        ...(writeIntent ? { writeIntent } : {})
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
      conversation,
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
export const aiAssistantAutonomyTests = [
  ...aiAssistantCrashgapTests,
  {
    name: '兼容明确写意图也绑定个人来源，源转私密后拒绝采纳派生新稿',
    run: () =>
      fixture(async ({ app, runtime, space, policy, submit, respond }) => {
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '个人资料',
          rawMarkdown: '合成个人资料秘密'
        });
        const p = await policy();
        respond(() => tool('notes_create', { title: '派生稿', rawMarkdown: '合成个人资料秘密' }));
        const turn = await submit('根据我的笔记生成资料新稿', 'explicit-source-bound', p.policyId, {
          toolName: 'notes_create'
        });
        await runtime.agent.run(turn.turnId);
        const [draft] = await runtime.actions.listInbox(space.id);
        assert(draft.grant.sourceRefs.some(ref => ref.noteId === note.id));
        await runtime.actions.approve(draft.actionId, { planHash: draft.plan.planHash });
        app.modules.knowledge.noteService.updateNote(note.id, { aiVisibility: 'private' });
        await assert.rejects(runtime.actions.apply(draft.actionId), { code: 'AI_SCOPE_FORBIDDEN' });
        assert.equal(app.dataStore.state.notes.length, 1);
      })
  },
  {
    name: '自主助手：解释怎么保存文件保持普通聊天，禁止模型乱提成果',
    run: () =>
      fixture(async ({ runtime, requests, submit, space, respond }) => {
        respond(() => tool('notes_create', { title: '错误成果', rawMarkdown: '模型乱提' }));
        const turn = await submit('解释怎么保存文件', 'explain-save');
        await assert.rejects(runtime.agent.run(turn.turnId), { code: 'AI_TOOL_INVALID' });
        assert(!requests[0].tools.some(item => item.name === 'notes_create'));
        assert.equal((await runtime.actions.list(space.id)).length, 0);
      })
  },
  {
    name: '自主助手：自然语言整理本周学习与总结这周笔记均可生成新稿',
    run: () =>
      fixture(async ({ runtime, requests, submit, space, respond }) => {
        respond(() => tool('notes_create', { title: '本周学习总结', rawMarkdown: '合成学习总结。' }));
        for (const [index, content] of ['帮我整理一下本周学到的东西', '总结这周笔记'].entries()) {
          const turn = await submit(content, `natural-week-${index}`);
          await runtime.agent.run(turn.turnId);
          assert(requests.at(-1).tools.some(item => item.name === 'notes_create'));
        }
        assert.equal((await runtime.actions.list(space.id)).length, 2);
      })
  },
  {
    name: '自主助手：普通聊天不开放成果工具，目标模糊只问关键问题',
    run: () =>
      fixture(async ({ runtime, requests, submit, space, respond }) => {
        respond(() => answer('你希望整理哪一方面的内容？'));
        const turn = await submit('帮我看看', 'clarify');
        await runtime.agent.run(turn.turnId);
        assert.equal((await runtime.actions.list(space.id)).length, 0);
        assert(!requests[0].tools.some(item => item.name.startsWith('notes_')));
        assert.equal(
          (await runtime.conversationStore.listMessages(turn.conversationId)).at(-1).content,
          '你希望整理哪一方面的内容？'
        );
      })
  },
  {
    name: '自主助手：个人资料问答按当前普通笔记来源引用',
    run: () =>
      fixture(async ({ app, runtime, space, policy, submit, respond, requests }) => {
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '光合作用',
          rawMarkdown: '光合作用需要阳光和水。'
        });
        const grantPolicy = await policy();
        respond(() => answer('个人笔记：光合作用需要阳光和水。', [{ sourceId: 'S1', quote: '光合作用需要阳光和水' }]));
        const turn = await submit('根据我的笔记解释光合作用', 'personal-qa', grantPolicy.policyId);
        await runtime.agent.run(turn.turnId);
        assert.equal(
          (await runtime.conversationStore.listMessages(turn.conversationId)).at(-1).citations[0].noteId,
          note.id
        );
        assert.equal((await runtime.actions.list(space.id)).length, 0);
        assert(!requests[0].tools.some(item => item.name === 'notes_create'));
      })
  },
  {
    name: '自主助手：先列目录再列笔记，标题经 catalog 回到模型，授权外目录不出现',
    run: () =>
      fixture(async ({ app, runtime, space, policy, submit, respond, requests }) => {
        const { folderService, noteService } = app.modules.knowledge;
        const dl = folderService.createFolder({ spaceId: space.id, name: '深度学习' });
        const other = folderService.createFolder({ spaceId: space.id, name: '烹饪' });
        for (const title of ['引言', '反向传播'])
          noteService.createNote({ spaceId: space.id, folderId: dl.id, title, rawMarkdown: `${title}正文` });
        noteService.createNote({ spaceId: space.id, folderId: other.id, title: '红烧肉', rawMarkdown: '食谱' });
        const narrow = await runtime.access.createPolicy({
          spaceId: space.id,
          scope: { kind: 'folder', folderId: dl.id },
          excludedNoteIds: [],
          includeAttachments: false,
          read: true,
          egress: true,
          recipients: ['deepseek'],
          expiresAt: new Date(Date.now() + 86400000).toISOString()
        });
        const catalogOf = request => JSON.parse(request.messages.at(-1).content).catalog ?? [];
        let round = 0;
        respond(request => {
          round++;
          if (round === 1) return tool('folders_list', {}, 'c1');
          if (round === 2) {
            const [entry] = catalogOf(request);
            assert.deepEqual(
              entry.folders.map(folder => folder.name),
              ['深度学习']
            );
            return tool('notes_list', { folderId: entry.folders[0].folderId }, 'c2');
          }
          assert.deepEqual(
            catalogOf(request).map(entry => entry.kind),
            ['folders', 'notes']
          );
          assert.deepEqual(
            catalogOf(request)[1]
              .notes.map(note => note.title)
              .sort(),
            ['反向传播', '引言']
          );
          return answer('该目录下有《引言》和《反向传播》两篇笔记。', []);
        });
        const turn = await submit('深度学习那一块下面有什么', 'catalog-flow', narrow.policyId);
        await runtime.agent.run(turn.turnId);
        assert(
          requests[0].tools.some(item => item.name === 'folders_list') &&
            requests[0].tools.some(item => item.name === 'notes_list')
        );
        assert.equal(requests.length, 3);
        for (const request of requests) {
          const text = JSON.stringify(request.messages);
          assert.equal(text.includes('烹饪'), false);
          assert.equal(text.includes('红烧肉'), false);
        }
        const messages = await runtime.conversationStore.listMessages(turn.conversationId);
        assert.equal(messages.at(-1).content, '该目录下有《引言》和《反向传播》两篇笔记。');
        // 授权回合的回答含标题，不能作为“无来源”普通历史进入此后的无授权聊天。
        const plain = await submit('谢谢，再见', 'catalog-after-plain');
        respond(() => answer('不客气'));
        await runtime.agent.run(plain.turnId);
        assert.equal(JSON.stringify(requests.at(-1).messages).includes('反向传播'), false);
      })
  },
  {
    name: '自主助手：提到文件夹名时回合开始自动预取该目录的笔记标题，第一轮请求即带 catalog',
    run: () =>
      fixture(async ({ app, runtime, space, policy, submit, respond, requests }) => {
        const { folderService, noteService } = app.modules.knowledge;
        const dl = folderService.createFolder({ spaceId: space.id, name: '深度学习' });
        noteService.createNote({ spaceId: space.id, folderId: dl.id, title: '引言', rawMarkdown: '正文' });
        const p = await policy();
        respond(request => {
          const catalog = JSON.parse(request.messages.at(-1).content).catalog;
          assert.deepEqual(
            catalog.map(entry => entry.kind),
            ['notes']
          );
          assert.deepEqual(
            catalog[0].notes.map(note => note.title),
            ['引言']
          );
          return answer('有《引言》。', []);
        });
        const turn = await submit('深度学习文件夹里有什么', 'catalog-prefetch', p.policyId);
        await runtime.agent.run(turn.turnId);
        assert.equal(requests.length, 1);
        const calls = await runtime.conversationStore.listToolCalls(turn.turnId);
        assert.deepEqual(
          calls.map(call => [call.toolName, call.status]),
          [['notes_list', 'succeeded']]
        );
        // 没有命中目录名时预取顶层目录；不含目录词的问题不预取。
        respond(request => {
          assert.equal(JSON.parse(request.messages.at(-1).content).catalog[0].kind, 'folders');
          return answer('一个目录。', []);
        });
        const other = await submit('我有哪些目录', 'catalog-prefetch-top', p.policyId);
        await runtime.agent.run(other.turnId);
        respond(request => {
          assert.equal(JSON.parse(request.messages.at(-1).content).catalog, undefined);
          return answer('好的。', []);
        });
        const none = await submit('随便聊聊', 'catalog-prefetch-none', p.policyId);
        await runtime.agent.run(none.turnId);
      })
  },
  {
    name: '自主助手：问“哪篇重点最多”时预取按重点数排序的笔记列表，第一轮即可作答',
    run: () =>
      fixture(async ({ app, runtime, space, policy, submit, respond, requests }) => {
        const { noteService } = app.modules.knowledge;
        const few = noteService.createNote({ spaceId: space.id, title: '重点少', rawMarkdown: '段一\n\n段二' });
        const many = noteService.createNote({
          spaceId: space.id,
          title: '重点多',
          rawMarkdown: '段一\n\n段二\n\n段三'
        });
        noteService.createNote({ spaceId: space.id, title: '没重点', rawMarkdown: '无' });
        markParagraphs(app.modules.knowledge, few, [[0, 'important']]);
        markParagraphs(app.modules.knowledge, many, [
          [0, 'normal'],
          [1, 'core'],
          [2, 'important']
        ]);
        const p = await policy();
        respond(request => {
          const [entry] = JSON.parse(request.messages.at(-1).content).catalog;
          assert.deepEqual(
            entry.notes.map(note => [note.title, note.highlightCount, note.importantCount]),
            [
              ['重点多', 3, 2],
              ['重点少', 1, 1],
              ['没重点', 0, 0]
            ]
          );
          return answer('「重点多」重点最多（3 处）。', []);
        });
        const turn = await submit('你帮我看一下我的笔记中哪一篇笔记的重点最多呢?', 'rank-highlights', p.policyId);
        await runtime.agent.run(turn.turnId);
        assert.equal(requests.length, 1);
        assert.equal(
          (await runtime.conversationStore.listMessages(turn.conversationId)).at(-1).content,
          '「重点多」重点最多（3 处）。'
        );
      })
  },
  {
    name: '自主助手：引文无法核对时先让模型修正一次；仍不合格才整轮失败',
    run: () =>
      fixture(async ({ app, runtime, space, policy, submit, respond, requests }) => {
        app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '光合作用',
          rawMarkdown: '光合作用需要阳光和水。'
        });
        const p = await policy();
        let round = 0;
        respond(() =>
          ++round === 1
            ? answer('光合作用需要二氧化碳。', [{ sourceId: 'S1', quote: '笔记里并没有的原文' }])
            : answer('光合作用需要阳光和水。', [{ sourceId: 'S1', quote: '光合作用需要阳光和水' }])
        );
        const turn = await submit('根据我的笔记解释光合作用', 'citation-repair', p.policyId);
        await runtime.agent.run(turn.turnId);
        assert.equal(requests.length, 2);
        assert.match(requests[1].messages.at(-1).content, /无法在 sources 中逐字核对/);
        const last = (await runtime.conversationStore.listMessages(turn.conversationId)).at(-1);
        assert.equal(last.content, '光合作用需要阳光和水。');
        assert.equal(last.citations.length, 1);
        respond(() => answer('无依据。', [{ sourceId: 'S1', quote: '永远对不上' }]));
        const bad = await submit('根据我的笔记再解释一次光合作用', 'citation-repair-fail', p.policyId);
        await assert.rejects(runtime.agent.run(bad.turnId), { code: 'AI_CITATION_INVALID' });
      })
  },
  {
    name: '自主助手：目录有 20 篇长标题笔记时预取按预算缩小分页并提示还有更多，不因 AI_CONTEXT_BUDGET 失败',
    run: () =>
      fixture(async ({ app, runtime, space, policy, submit, respond, requests }) => {
        const { folderService, noteService } = app.modules.knowledge;
        const dl = folderService.createFolder({ spaceId: space.id, name: '深度学习' });
        for (let index = 0; index < 20; index++)
          noteService.createNote({
            spaceId: space.id,
            folderId: dl.id,
            title: `${String(index).padStart(2, '0')}${'标'.repeat(78)}`,
            rawMarkdown: `正文${index}`
          });
        const p = await policy();
        respond(request => {
          const [entry] = JSON.parse(request.messages.at(-1).content).catalog;
          assert(entry.notes.length >= 5 && entry.notes.length < 20, `缩小后的条数 ${entry.notes.length}`);
          assert.equal(entry.hasMore, true);
          assert.equal(entry.total, 20);
          return answer('列出了一部分，还有更多。', []);
        });
        const turn = await submit('深度学习文件夹里有哪些笔记', 'catalog-budget', p.policyId);
        await runtime.agent.run(turn.turnId);
        assert.equal((await runtime.conversationStore.getTurn(turn.turnId)).status, 'succeeded');
        assert(Buffer.byteLength(JSON.stringify(requests[0].messages), 'utf8') < 12_000);
      })
  },
  {
    name: '自主助手：目录标题生成的新稿以独立元数据记录依赖（含空正文笔记），切私密后续改与采纳均被拒绝',
    run: () =>
      fixture(async ({ app, runtime, space, policy, submit, respond, requests }) => {
        const { folderService, noteService } = app.modules.knowledge;
        const dl = folderService.createFolder({ spaceId: space.id, name: '深度学习' });
        const first = noteService.createNote({
          spaceId: space.id,
          folderId: dl.id,
          title: '引言',
          rawMarkdown: '引言正文'
        });
        const blank = noteService.createNote({
          spaceId: space.id,
          folderId: dl.id,
          title: '空白笔记',
          rawMarkdown: ' '
        });
        noteService.updateNote(blank.id, { rawMarkdown: '' });
        const p = await policy();
        respond(() => tool('notes_create', { title: '深度学习目录', rawMarkdown: '- 引言\n- 空白笔记' }));
        const turn = await submit('把深度学习文件夹里的笔记标题整理成一份新目录笔记', 'catalog-artifact', p.policyId);
        await runtime.agent.run(turn.turnId);
        const [draft] = await runtime.actions.listInbox(space.id);
        assert.deepEqual(draft.grant.sourceRefs, []);
        assert.deepEqual([...draft.grant.catalogDeps.noteIds].sort(), [first.id, blank.id].sort());
        // 续改（授权有效）时，依赖继承到新请求的清单，之后的回答也在依赖链上。
        respond(() => answer('已精简。', []));
        const follow = await submit('精简一下', 'catalog-artifact-follow', p.policyId);
        await runtime.agent.run(follow.turnId);
        const manifests = await app.dataStore.aiAccessStore.list('aiRequestManifest');
        assert(
          manifests.some(
            manifest =>
              manifest.historyCatalog?.noteIds.includes(blank.id) && manifest.historyCatalog.noteIds.includes(first.id)
          )
        );
        // 空正文笔记切私密：没有可取的正文片段也照样拦截采纳；已转述过标题的后续回答依赖失效，整条排除、不再发给模型。
        noteService.updateNote(blank.id, { aiVisibility: 'private' });
        await assert.rejects(
          async () => {
            await runtime.actions.approve(draft.actionId, { planHash: draft.plan.planHash });
            await runtime.actions.apply(draft.actionId);
          },
          { code: 'AI_SCOPE_FORBIDDEN' }
        );
        assert.equal(app.dataStore.state.notes.length, 2);
        respond(() => answer('不客气。', []));
        const plain = await submit('好的，谢谢', 'catalog-artifact-plain', p.policyId);
        await runtime.agent.run(plain.turnId);
        assert.equal(JSON.stringify(requests.at(-1).messages).includes('已精简。'), false);
      })
  },
  {
    name: '自主助手：目录标题新稿的依赖笔记切私密后，紧接着的续改被拒绝且不向模型发送草稿',
    run: () =>
      fixture(async ({ app, runtime, space, policy, submit, respond, requests }) => {
        const { folderService, noteService } = app.modules.knowledge;
        const dl = folderService.createFolder({ spaceId: space.id, name: '深度学习' });
        const first = noteService.createNote({
          spaceId: space.id,
          folderId: dl.id,
          title: '引言',
          rawMarkdown: '引言正文'
        });
        noteService.createNote({ spaceId: space.id, folderId: dl.id, title: '反向传播', rawMarkdown: '反向传播正文' });
        const p = await policy();
        respond(() => tool('notes_create', { title: '深度学习目录', rawMarkdown: '- 引言\n- 反向传播' }));
        const turn = await submit('把深度学习文件夹里的笔记标题整理成一份新目录笔记', 'catalog-artifact-2', p.policyId);
        await runtime.agent.run(turn.turnId);
        noteService.updateNote(first.id, { aiVisibility: 'private' });
        const before = requests.length;
        respond(() => answer('已精简。', []));
        const follow = await submit('精简一下', 'catalog-artifact-2-follow', p.policyId);
        await assert.rejects(runtime.agent.run(follow.turnId), { code: 'AI_SCOPE_FORBIDDEN' });
        assert.equal(requests.length, before);
      })
  },
  {
    name: '自主助手：只含目录名的新稿也记录依赖，没有读取授权时不能续改',
    run: () =>
      fixture(async ({ app, runtime, space, policy, submit, respond, requests }) => {
        const { folderService, noteService } = app.modules.knowledge;
        const dl = folderService.createFolder({ spaceId: space.id, name: '深度学习' });
        noteService.createNote({ spaceId: space.id, folderId: dl.id, title: '引言', rawMarkdown: '正文' });
        const p = await policy();
        respond(() => tool('notes_create', { title: '目录清单', rawMarkdown: '- 深度学习' }));
        const turn = await submit('我有哪些文件夹，整理成一份新清单笔记', 'catalog-folders-only', p.policyId);
        await runtime.agent.run(turn.turnId);
        const [draft] = await runtime.actions.listInbox(space.id);
        assert.deepEqual(draft.grant.catalogDeps.folderIds, [dl.id]);
        const before = requests.length;
        respond(() => answer('已精简。', []));
        const noPolicy = await submit('精简一下', 'catalog-folders-only-follow');
        await assert.rejects(runtime.agent.run(noPolicy.turnId), { code: 'AI_SCOPE_FORBIDDEN' });
        assert.equal(requests.length, before);
      })
  },
  {
    name: '自主助手：模型结果落盘后回合完成前故障，恢复时依赖笔记已切私密则丢弃旧结果，重试后标题不再外发',
    run: () =>
      fixture(async ({ app, runtime, space, policy, submit, respond, requests }) => {
        const { folderService, noteService } = app.modules.knowledge;
        const dl = folderService.createFolder({ spaceId: space.id, name: '深度学习' });
        const secret = noteService.createNote({
          spaceId: space.id,
          folderId: dl.id,
          title: '待私密的标题',
          rawMarkdown: '正文'
        });
        noteService.createNote({ spaceId: space.id, folderId: dl.id, title: '公开标题', rawMarkdown: '正文二' });
        const p = await policy();
        let calls = 0;
        respond(request => {
          calls++;
          const titles = JSON.parse(request.messages.at(-1).content)
            .catalog[0].notes.map(note => note.title)
            .sort();
          return answer(`目录下有：${titles.join('、')}`, []);
        });
        const complete = runtime.conversationStore.completeTurn;
        let faulted = false;
        runtime.conversationStore.completeTurn = async (...args) => {
          if (!faulted) {
            faulted = true;
            throw Object.assign(new Error('synthetic fault after durable model result'), {
              code: 'AI_SYNTHETIC_IO_FAULT'
            });
          }
          return complete(...args);
        };
        const turn = await submit('深度学习文件夹里有什么', 'catalog-resume', p.policyId);
        await assert.rejects(runtime.agent.run(turn.turnId), { code: 'AI_SYNTHETIC_IO_FAULT' });
        assert.equal(calls, 1);
        noteService.updateNote(secret.id, { aiVisibility: 'private' });
        await assert.rejects(runtime.agent.run(turn.turnId), { code: 'AI_SOURCE_STALE' });
        assert.equal(calls, 1); // 没有复用含旧标题的结果，也没有悄悄重发
        await runtime.agent.retry(turn.turnId);
        assert.equal(calls, 2);
        assert.equal(JSON.stringify(requests.at(-1).messages).includes('待私密的标题'), false);
        const last = (await runtime.conversationStore.listMessages(turn.conversationId)).at(-1);
        assert.equal(last.content.includes('待私密的标题'), false);
      })
  },
  {
    name: '自主助手：按时间检索周总结新稿，不要求预选写入模式',
    run: () =>
      fixture(async ({ app, runtime, space, policy, submit, respond }) => {
        const repo = app.modules.knowledge.repositories.noteRepository;
        const first = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '学习甲',
          rawMarkdown: '合成学习记录甲'
        });
        const excluded = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '学习乙',
          rawMarkdown: '时间范围之外的内容'
        });
        repo.save({ ...first, createdAt: '2026-09-28T00:00:00.000Z' });
        repo.save({ ...excluded, createdAt: '2026-10-05T00:00:00.000Z' });
        const p = await policy();
        let round = 0;
        respond(request =>
          ++round === 1
            ? tool('notes_search', { createdFrom: '2026-09-28T00:00:00Z', createdBefore: '2026-10-05T00:00:00Z' })
            : tool('notes_create', { title: '本周总结', rawMarkdown: '本周学习记录甲。' })
        );
        const turn = await submit('将 9 月 28 日到 10 月 4 日的笔记生成周总结新稿，按 UTC 时间', 'weekly', p.policyId);
        await runtime.agent.run(turn.turnId);
        const calls = await runtime.conversationStore.listToolCalls(turn.turnId);
        const dated = calls.find(call => call.resultJson?.mode === 'created_time');
        assert.deepEqual(
          dated.resultJson.hits.map(hit => hit.noteId),
          [first.id]
        );
        const [draft] = await runtime.actions.list(space.id);
        assert.equal(draft.plan.toolName, 'notes_create');
        assert.equal(draft.status, 'awaitingApproval');
        assert.equal(app.dataStore.state.notes.length, 2);
        assert(!turn.writeIntent);
        assert.equal((await runtime.conversationStore.getTurn(turn.turnId)).checkpoint.totalTools, 2);
      })
  },
  {
    name: '自主助手：先读后提出已有笔记差异稿，经确认后提交且可恢复版本',
    run: () =>
      fixture(async ({ app, runtime, space, policy, submit, respond }) => {
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '整理目标',
          rawMarkdown: '原句需要整理。'
        });
        const p = await policy();
        let round = 0;
        respond(() =>
          ++round === 1
            ? tool('notes_read', { noteId: note.id })
            : tool('notes_propose_patch', {
                noteId: note.id,
                replacements: [{ start: 0, end: 2, quote: '原句', replacement: '新句' }]
              })
        );
        const turn = await submit('整理修改这篇笔记', 'patch', p.policyId);
        await runtime.agent.run(turn.turnId);
        const [draft] = await runtime.actions.list(space.id);
        assert.equal(draft.plan.items[0].before.rawMarkdown, '原句需要整理。');
        assert.equal(draft.plan.items[0].after.rawMarkdown, '新句需要整理。');
        assert.equal(app.modules.knowledge.noteService.getNote(note.id).rawMarkdown, '原句需要整理。');
        await runtime.actions.approve(draft.actionId, { planHash: draft.plan.planHash });
        const applied = await runtime.actions.apply(draft.actionId);
        assert(applied.receipt.result.changes[0].beforeVersionId);
        assert.equal(app.modules.knowledge.noteService.getNote(note.id).rawMarkdown, '新句需要整理。');
      })
  },
  {
    name: '自主助手：新稿可用短一点延续同会话修改，普通回答不另建成果',
    run: () =>
      fixture(async ({ runtime, submit, space, respond, requests }) => {
        respond(() => tool('notes_create', { title: '合成周报', rawMarkdown: '第一段学习结果，第二段行动计划。' }));
        const first = await submit('生成周报新稿', 'draft');
        await runtime.agent.run(first.turnId);
        const [draft] = await runtime.actions.list(space.id);
        respond(request => {
          assert(request.messages.at(-1).content.includes(draft.actionId));
          return tool('notes_create', {
            actionId: draft.actionId,
            title: '合成周报',
            rawMarkdown: '学习结果与行动计划。'
          });
        });
        const second = await submit('短一点', 'shorter');
        await runtime.agent.run(second.turnId);
        const list = await runtime.actions.list(space.id);
        assert.equal(list.length, 1);
        assert.equal(list[0].plan.items[0].after.rawMarkdown, '学习结果与行动计划。');
        respond(() => answer('你好'));
        const plain = await submit('你好', 'plain-after-draft');
        await runtime.agent.run(plain.turnId);
        assert(!requests.at(-1).tools.some(item => item.name === 'notes_create'));
        assert.equal((await runtime.actions.list(space.id)).length, 1);
      })
  },
  {
    name: '自主助手：草稿个人来源改私密后阻止续对话发送原资料',
    run: () =>
      fixture(async ({ app, runtime, space, policy, submit, respond, requests }) => {
        const note = app.modules.knowledge.noteService.createNote({
          spaceId: space.id,
          title: '授权资料',
          rawMarkdown: '只用于合成的个人秘密'
        });
        const p = await policy();
        respond(() => tool('notes_create', { title: '资料新稿', rawMarkdown: '只用于合成的个人秘密' }));
        const first = await submit('根据我的笔记生成资料新稿', 'source-draft', p.policyId);
        await runtime.agent.run(first.turnId);
        app.modules.knowledge.noteService.updateNote(note.id, { aiVisibility: 'private' });
        const second = await submit('短一点', 'private-followup', p.policyId);
        const count = requests.length;
        await assert.rejects(runtime.agent.run(second.turnId), { code: 'AI_SCOPE_FORBIDDEN' });
        assert.equal(requests.length, count);
      })
  },
  {
    name: '自主助手：合成联网注明外部来源，不加入个人笔记引用',
    run: () =>
      fixture(
        async ({ runtime, submit, respond, requests }) => {
          let round = 0;
          respond(() =>
            ++round === 1 ? tool('web_search', { query: '公开主题' }) : answer('外部资料：合成结果，仅用于流程验收。')
          );
          const turn = await submit('搜索公开主题的最新信息', 'synthetic-web');
          await runtime.agent.run(turn.turnId);
          const message = (await runtime.conversationStore.listMessages(turn.conversationId)).at(-1);
          assert(message.content.includes('合成验收，非真实联网'));
          assert(message.content.includes('https://example.test/source'));
          assert.deepEqual(message.sourceRefs, []);
          assert(requests[1].messages.at(-1).content.includes('sourceType'));
        },
        {
          capabilities: () => ({ mode: 'synthetic', egress: false }),
          search: async input => {
            assert.deepEqual(Object.keys(input), ['query', 'limit', 'signal']);
            return { hits: [{ title: '合成公开来源', url: 'https://example.test/source', text: '合成外部事实。' }] };
          }
        }
      )
  },
  {
    name: '自主助手：搜索拒绝从笔记生成的词，真实适配器默认不可用',
    async run() {
      let sent = 0;
      const search = createAssistantWebSearch({
        capabilities: () => ({ mode: 'synthetic', egress: false }),
        search: async () => {
          sent++;
        }
      });
      await assert.rejects(search.search({ query: '个人秘密笔记原文' }, '请核实公开主题'), {
        code: 'AI_WEB_QUERY_REQUIRES_CLARIFICATION'
      });
      assert.equal(sent, 0);
      const external = createAssistantWebSearch({
        capabilities: () => ({ mode: 'live', egress: true }),
        search: async () => {
          sent++;
        }
      });
      assert.equal(external.enabled, false);
      await assert.rejects(external.search({ query: '公开主题' }, '公开主题'), { code: 'AI_WEB_SEARCH_UNAVAILABLE' });
      assert.equal(sent, 0);
    }
  }
];
