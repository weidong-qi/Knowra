import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import { createInMemoryNoteRepository } from '../src/modules/knowledge/infrastructure/note-repository.js';
import { createInMemoryNoteVersionRepository } from '../src/modules/knowledge/infrastructure/note-version-repository.js';
import { createInMemoryFolderRepository } from '../src/modules/knowledge/infrastructure/folder-repository.ts';
import { createInMemoryKnowledgeSpaceRepository } from '../src/modules/knowledge/infrastructure/knowledge-space-repository.ts';
import { NoteVersion, calculateContentHash } from '../src/modules/knowledge/domain/note-version.ts';
import { createAiAccessService } from '../src/modules/ai/access-service.js';
import { createAiAgentWorker } from '../src/modules/ai/agent-worker.js';
import { createAuthorizedRetrieval } from '../src/modules/ai/retrieval.js';

const samples = JSON.parse(
  fs.readFileSync(new URL('../../../docs/AI功能/p1/fixtures/retrieval-v1.json', import.meta.url), 'utf8')
);

async function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-r06-retrieval-'));
  try {
    const data = createFileDataStore(path.join(root, 'data.json'));
    const notes = createInMemoryNoteRepository();
    const versions = createInMemoryNoteVersionRepository();
    const folders = createInMemoryFolderRepository();
    const spaces = createInMemoryKnowledgeSpaceRepository();
    spaces.save({ id: 'space-r06', userId: 'demo', name: '合成样本' });
    const access = createAiAccessService({
      store: data.aiAccessStore,
      noteRepository: notes,
      noteVersionRepository: versions,
      folderRepository: folders,
      spaceRepository: spaces,
      ownerId: 'demo'
    });
    const put = (id, title, content, folderId = null) => {
      notes.save({
        id,
        title,
        rawMarkdown: content,
        folderId,
        spaceId: 'space-r06',
        deleted: false,
        favorite: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });
      versions.save(
        new NoteVersion({ id: `version-${id}-${calculateContentHash(content).slice(0, 8)}`, noteId: id, content })
      );
    };
    for (const note of samples.notes) put(note.id, note.title, note.content);
    const grant = async (scope = { kind: 'library' }, egress = false) => {
      const policy = await access.createPolicy({
        spaceId: 'space-r06',
        scope,
        excludedNoteIds: [],
        includeAttachments: false,
        read: true,
        egress,
        recipients: egress ? ['deepseek'] : [],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString()
      });
      return { policy, run: await access.createRunGrant({ policyId: policy.policyId, conversationId: 'r06-sample' }) };
    };
    await run({ data, access, notes, versions, folders, put, grant });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export const aiRetrievalR06Tests = [
  {
    name: 'R06 固定合成集：关键词正例 top3、无命中与语义改写分开计数',
    run: () =>
      withFixture(async ({ access, grant }) => {
        const { run } = await grant();
        const search = createAuthorizedRetrieval({ access });
        let recalled = 0,
          relevant = 0;
        for (const sample of samples.lexical) {
          const result = await search.search({ grantId: run.grantId, query: sample.query, limit: 3 });
          assert.equal(result.mode, 'keyword');
          for (const id of sample.expected) {
            relevant++;
            if (result.hits.some(hit => hit.noteId === id)) recalled++;
            else assert.fail(`${sample.id} 未在 top3 召回 ${id}`);
          }
          for (const hit of result.hits) assert.equal(hit.ref.quoteHash, calculateContentHash(hit.text));
        }
        let noHits = 0;
        for (const sample of samples.noHit) {
          const result = await search.search({ grantId: run.grantId, query: sample.query, limit: 3 });
          if (!result.hits.length) noHits++;
        }
        assert.equal(noHits, samples.noHit.length);
        let semanticRecall = 0;
        for (const sample of samples.semanticObservation) {
          const result = await search.search({ grantId: run.grantId, query: sample.query, limit: 3 });
          if (sample.expected.every(id => result.hits.some(hit => hit.noteId === id))) semanticRecall++;
        }
        console.log(
          `R06 样本 v${samples.version}：关键词 top3 ${recalled}/${relevant}，无命中 ${noHits}/${samples.noHit.length}，语义改写观察 ${semanticRecall}/${samples.semanticObservation.length}`
        );
      })
  },
  {
    name: 'R06 索引候选只提供定位，授权服务生成当前正文与引用',
    run: () =>
      withFixture(async ({ access, grant }) => {
        const { run } = await grant({ kind: 'fixed', noteIds: ['photo'] });
        const current = await access.verifyRead({ grantId: run.grantId, noteId: 'photo', tool: 'notes_search' });
        const source = {
          async searchCandidates({ authorized }) {
            assert.deepEqual(
              authorized.map(row => row.noteId),
              ['photo']
            );
            return {
              candidates: [
                {
                  noteId: 'photo',
                  noteVersionId: current.version.id,
                  contentHash: current.contentHash,
                  start: 0,
                  end: current.version.content.length,
                  score: 0.9,
                  text: '伪造正文',
                  title: '伪造标题'
                }
              ],
              truncated: false
            };
          }
        };
        const result = await createAuthorizedRetrieval({ access, candidateSource: source }).search({
          grantId: run.grantId,
          query: '植物制造食物的过程',
          limit: 3
        });
        assert.equal(result.mode, 'index');
        assert.equal(result.hits[0].text, current.version.content);
        assert.equal(result.hits[0].title, current.note.title);
        assert.equal(result.hits[0].ref.quoteHash, calculateContentHash(result.hits[0].text));
        assert(!JSON.stringify(result).includes('伪造'));
      })
  },
  {
    name: 'R06 索引片段不能切断 emoji 代理对',
    run: () =>
      withFixture(async ({ access, grant }) => {
        const { run } = await grant({ kind: 'fixed', noteIds: ['unicode'] });
        const current = await access.verifyRead({ grantId: run.grantId, noteId: 'unicode', tool: 'notes_search' });
        const result = await createAuthorizedRetrieval({
          access,
          candidateSource: {
            async searchCandidates() {
              return {
                candidates: [
                  {
                    noteId: 'unicode',
                    noteVersionId: current.version.id,
                    contentHash: current.contentHash,
                    start: 1,
                    end: 5,
                    score: 1
                  }
                ],
                truncated: false
              };
            }
          }
        }).search({ grantId: run.grantId, query: 'ABC' });
        assert.equal(result.mode, 'keyword_fallback');
        assert.equal(result.fallbackReason, 'stale');
        assert.equal(result.hits[0].ref.quoteHash, calculateContentHash(result.hits[0].text));
      })
  },
  {
    name: 'R06 Agent 工具轨迹记录关键词回退并把覆盖说明交给模型',
    run: () =>
      withFixture(async ({ data, access, grant }) => {
        const { policy } = await grant({ kind: 'fixed', noteIds: ['photo'] }, true);
        const conversation = await data.aiConversationStore.createConversation({
          ownerId: 'demo',
          actorId: 'demo',
          spaceId: 'space-r06'
        });
        const turn = await data.aiConversationStore.submitTurn({
          ownerId: 'demo',
          conversationId: conversation.conversationId,
          content: '根据我的笔记解释光合作用',
          idempotencyKey: 'r06-agent-fallback',
          requestedPolicyId: policy.policyId
        });
        const requests = [];
        const worker = createAiAgentWorker({
          store: data.aiConversationStore,
          access,
          modelSettings: {
            credentialReference: async () => ({ modelId: 'deepseek-flash', credentialRef: 'synthetic' })
          },
          budget: data.aiBudgetAuthority,
          priceProfile: {
            version: 'r06-price',
            modelId: 'deepseek-flash',
            expiresAt: '2030-01-01T00:00:00.000Z',
            inputMicrounitsPerMillion: 2_000_000,
            outputMicrounitsPerMillion: 8_000_000
          },
          retrievalCandidates: {
            async searchCandidates() {
              throw new Error('synthetic outage');
            }
          },
          gateway: {
            capabilities: () => ({ provider: 'mock' }),
            async complete(request) {
              requests.push(request);
              return {
                content: '',
                json: { answer: '笔记说明了光合作用。', citations: [{ sourceId: 'S1', quote: '光合作用' }] },
                toolCalls: [],
                finishReason: 'stop',
                truncated: false,
                refused: false,
                usage: { inputTokens: 10, outputTokens: 10, unknown: false }
              };
            }
          }
        });
        await worker.run(turn.turnId);
        const calls = await data.aiConversationStore.listToolCalls(turn.turnId);
        assert.equal(calls[0].resultJson.mode, 'keyword_fallback');
        assert.equal(calls[0].resultJson.fallbackReason, 'unavailable');
        assert(
          requests[0].messages.some(message => message.role === 'user' && message.content.includes('已使用关键词检索'))
        );
        assert.equal((await data.aiConversationStore.getTurn(turn.turnId)).status, 'succeeded');
      })
  },
  {
    name: 'R06 索引异常和旧版本候选显式回退关键词，旧正文不能复活',
    run: () =>
      withFixture(async ({ access, notes, put, grant }) => {
        const { run } = await grant({ kind: 'fixed', noteIds: ['photo'] });
        const old = await access.verifyRead({ grantId: run.grantId, noteId: 'photo', tool: 'notes_search' });
        const failed = createAuthorizedRetrieval({
          access,
          candidateSource: {
            async searchCandidates() {
              throw new Error('synthetic index outage');
            }
          }
        });
        const outage = await failed.search({ grantId: run.grantId, query: '光合作用' });
        assert.equal(outage.mode, 'keyword_fallback');
        assert.equal(outage.fallbackReason, 'unavailable');
        assert.deepEqual(
          outage.hits.map(hit => hit.noteId),
          ['photo']
        );
        const timedOut = createAuthorizedRetrieval({
          access,
          candidateTimeoutMs: 10,
          candidateSource: {
            async searchCandidates() {
              return new Promise(() => {});
            }
          }
        });
        const delayed = await timedOut.search({ grantId: run.grantId, query: '光合作用' });
        assert.equal(delayed.mode, 'keyword_fallback');
        assert.equal(delayed.fallbackReason, 'unavailable');

        put('photo', notes.findById('photo').title, '光合作用新版本只保留当前正文。');
        const stale = createAuthorizedRetrieval({
          access,
          candidateSource: {
            async searchCandidates() {
              return {
                candidates: [
                  {
                    noteId: 'photo',
                    noteVersionId: old.version.id,
                    contentHash: old.contentHash,
                    start: 0,
                    end: 8,
                    score: 1
                  }
                ],
                truncated: false
              };
            }
          }
        });
        const result = await stale.search({ grantId: run.grantId, query: '光合作用' });
        assert.equal(result.mode, 'keyword_fallback');
        assert.equal(result.fallbackReason, 'stale');
        assert(result.hits.every(hit => hit.ref.noteVersionId !== old.version.id));
        assert(!JSON.stringify(result).includes('叶绿体'));
      })
  },
  {
    name: 'R06 越权候选、目录移出与撤销授权不泄漏索引正文',
    run: () =>
      withFixture(async ({ access, notes, folders, grant }) => {
        const { run } = await grant({ kind: 'fixed', noteIds: ['photo'] });
        const outside = createAuthorizedRetrieval({
          access,
          candidateSource: {
            async searchCandidates() {
              return {
                candidates: [
                  {
                    noteId: 'overfit',
                    noteVersionId: 'forged',
                    contentHash: 'forged',
                    start: 0,
                    end: 8,
                    score: 1,
                    text: '私有正文'
                  }
                ],
                truncated: false
              };
            }
          }
        });
        const filtered = await outside.search({ grantId: run.grantId, query: '过拟合' });
        assert.equal(filtered.mode, 'keyword_fallback');
        assert.deepEqual(filtered.hits, []);
        assert(!JSON.stringify(filtered).includes('私有正文'));

        folders.save({ id: 'inside', spaceId: 'space-r06', parentId: null, deletedAt: null });
        folders.save({ id: 'outside', spaceId: 'space-r06', parentId: null, deletedAt: null });
        notes.save({ ...notes.findById('photo'), folderId: 'inside' });
        const scoped = await grant({ kind: 'folder', folderId: 'inside' });
        const current = await access.verifyRead({ grantId: scoped.run.grantId, noteId: 'photo', tool: 'notes_search' });
        const index = createAuthorizedRetrieval({
          access,
          candidateSource: {
            async searchCandidates() {
              return {
                candidates: [
                  {
                    noteId: 'photo',
                    noteVersionId: current.version.id,
                    contentHash: current.contentHash,
                    start: 0,
                    end: 8,
                    score: 1
                  }
                ],
                truncated: false
              };
            }
          }
        });
        notes.save({ ...notes.findById('photo'), folderId: 'outside' });
        const moved = await index.search({ grantId: scoped.run.grantId, query: '光合作用' });
        assert.deepEqual(moved.hits, []);
        await access.narrowPolicy(scoped.policy.policyId, { revision: 1, revoke: true });
        await assert.rejects(index.search({ grantId: scoped.run.grantId, query: '光合作用' }), {
          code: 'AI_ACCESS_REVOKED'
        });
      })
  },
  {
    name: 'R06 无可分词查询仍先校验授权状态',
    run: () =>
      withFixture(async ({ access, grant }) => {
        const { policy, run } = await grant({ kind: 'fixed', noteIds: ['photo'] });
        await access.narrowPolicy(policy.policyId, { revision: 1, revoke: true });
        await assert.rejects(createAuthorizedRetrieval({ access }).search({ grantId: run.grantId, query: '😀' }), {
          code: 'AI_ACCESS_REVOKED'
        });
      })
  }
];
