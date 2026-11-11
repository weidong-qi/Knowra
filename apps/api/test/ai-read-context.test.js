import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';
import { createPersistentAppContext } from '../src/app.factory.js';
import { createInMemoryNoteRepository } from '../src/modules/knowledge/infrastructure/note-repository.ts';
import { createInMemoryNoteVersionRepository } from '../src/modules/knowledge/infrastructure/note-version-repository.ts';
import { createInMemoryFolderRepository } from '../src/modules/knowledge/infrastructure/folder-repository.ts';
import { createInMemoryKnowledgeSpaceRepository } from '../src/modules/knowledge/infrastructure/knowledge-space-repository.ts';
import { NoteVersion } from '../src/modules/knowledge/domain/note-version.ts';
import { createAiReadContextService } from '../src/modules/ai/read-context-service.ts';
import { normalizeAiRequest } from '../src/modules/ai/gateway.ts';
import { createAiGateway } from '../src/modules/ai/gateway.ts';
import { outboundPayloadHash, serializedDeepSeekPayload } from '../src/modules/ai/outbound-payload.ts';
import { hashRecord, manifestHash } from '../src/modules/ai/record-contract.ts';
import { createAiWorker, quoteWorstCase } from '../src/modules/ai/worker.js';
import { aiRecords } from './ai-record-fixtures.js';

const instant = new Date('2026-09-26T00:00:00.000Z');
const priceProfile = {
  version: 'synthetic',
  expiresAt: '2030-01-01T00:00:00.000Z',
  inputMicrounitsPerMillion: 2_000_000,
  outputMicrounitsPerMillion: 8_000_000
};
const baseRequest = {
  spaceId: 'space-1',
  question: 'alpha',
  modelId: 'deepseek-flash',
  credentialRef: 'credential-reference',
  maxTokens: 80
};

function withContext(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-context-'));
  const store = createFileDataStore(path.join(directory, 'data.json'));
  const noteRepository = createInMemoryNoteRepository();
  const noteVersionRepository = createInMemoryNoteVersionRepository();
  const folderRepository = createInMemoryFolderRepository();
  const spaceRepository = createInMemoryKnowledgeSpaceRepository();
  spaceRepository.save({ id: 'space-1', userId: 'demo', name: '我的空间' });
  spaceRepository.save({ id: 'space-other', userId: 'other', name: '他人空间' });
  const service = createAiReadContextService({
    repository: store.aiRepository,
    noteRepository,
    noteVersionRepository,
    folderRepository,
    spaceRepository,
    ownerId: 'demo',
    now: () => instant
  });
  const addNote = (id, rawMarkdown, spaceId = 'space-1', folderId = null) => {
    noteRepository.save({
      id,
      title: id,
      rawMarkdown,
      spaceId,
      folderId,
      deleted: false,
      updatedAt: instant.toISOString(),
      createdAt: instant.toISOString(),
      favorite: false
    });
    const version = new NoteVersion({ id: `version-${id}`, noteId: id, content: rawMarkdown });
    noteVersionRepository.save(version);
    return version;
  };
  return Promise.resolve()
    .then(() => run({ store, service, noteRepository, noteVersionRepository, folderRepository, addNote }))
    .finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}

export const aiReadContextTests = [
  {
    name: '笔记内部链接与反链不扩大AI范围，不读取私密或范围外目标正文',
    run: () =>
      withContext(async ({ service, addNote, noteRepository }) => {
        addNote('private-target', '私密目标独有正文');
        noteRepository.save({ ...noteRepository.findById('private-target'), aiVisibility: 'private' });
        addNote('outside-target', '其他空间独有正文', 'space-other');
        const source =
          'alpha [显示文字](knowra://note/private-target#ref=ref-private) [范围外](knowra://note/outside-target#ref=ref-outside)';
        addNote('linked-source', source);
        addNote('backlink-source', '反链独有正文 [引用](knowra://note/linked-source#ref=ref-backlink)');
        const prepared = await service.prepareRead({
          ...baseRequest,
          scope: { kind: 'note', noteId: 'linked-source' }
        });
        assert.deepEqual([...new Set(prepared.manifest.sources.map(item => item.noteId))], ['linked-source']);
        assert(!JSON.stringify(prepared).includes('私密目标独有正文'));
        assert(!JSON.stringify(prepared).includes('其他空间独有正文'));
        assert(!JSON.stringify(prepared).includes('反链独有正文'));
        assert(prepared.request.messages.some(message => message.content.includes('显示文字')));
      })
  },
  {
    name: '旧Worker记录sent或凭据等待中切私密，最终供应商边界不调用合成适配器',
    async run() {
      for (const stage of ['sentRecord', 'credential'])
        await withContext(async ({ store, service, addNote, noteRepository }) => {
          addNote('note-1', 'alpha');
          const prepared = await service.prepareRead({ ...baseRequest, scope: { kind: 'note', noteId: 'note-1' } });
          const authorized = await service.authorizeRead({
            prepared,
            actorId: 'demo',
            approvedScopeHash: prepared.scopeSnapshot.scopeHash,
            approvedPayloadHash: prepared.manifest.payloadHash
          });
          const fixture = aiRecords(store.aiRepository.identity());
          const job = {
            ...fixture.job,
            jobId: `privacy-worker-${stage}`,
            grantId: authorized.grant.grantId,
            manifestId: authorized.manifest.manifestId,
            manifestHash: manifestHash(authorized.manifest),
            inputHash: hashRecord(authorized.request)
          };
          store.aiRepository.insert('aiJob', job);
          const privatize = () =>
            noteRepository.save({ ...noteRepository.findById('note-1'), aiVisibility: 'private' });
          const originalEvent = store.aiRepository.appendEvent;
          store.aiRepository.appendEvent = async event => {
            const result = originalEvent(event);
            if (stage === 'sentRecord' && event.eventKind === 'providerRequestStarted') privatize();
            return result;
          };
          let calls = 0;
          const gateway = createAiGateway({
            adapter: {
              provider: 'deepseek',
              capabilities: () => ({ provider: 'deepseek' }),
              complete: async () => {
                calls++;
                throw new Error('不得到达合成适配器');
              },
              async *stream() {}
            },
            authorizePaidCall: () => true,
            resolveCredential: async () => {
              if (stage === 'credential') privatize();
              return { apiKey: 'synthetic-unusable-key', modelId: baseRequest.modelId };
            }
          });
          const worker = createAiWorker({
            repository: store.aiRepository,
            budget: store.aiBudgetAuthority,
            gateway,
            priceProfile,
            now: () => instant,
            allowExternal: true,
            verifySources: (current, request) => service.verifyJobSources(current, request),
            validateResult: () => ({})
          });
          await assert.rejects(worker.run(job.jobId, authorized.request), { code: 'AI_SCOPE_FORBIDDEN' });
          assert.equal(calls, 0);
        });
    }
  },
  {
    name: '旧只读入口禁止私密历史版本，目录预览自动排除私密原文',
    run: () =>
      withContext(async ({ service, addNote, noteRepository, folderRepository }) => {
        folderRepository.save({ id: 'folder-1', spaceId: 'space-1', parentId: null, name: '目录', deletedAt: null });
        addNote('normal', 'alpha 普通', 'space-1', 'folder-1');
        addNote('private', 'alpha 私密', 'space-1', 'folder-1');
        noteRepository.save({ ...noteRepository.findById('private'), aiVisibility: 'private' });
        await assert.rejects(service.prepareRead({ ...baseRequest, scope: { kind: 'note', noteId: 'private' } }), {
          code: 'AI_SCOPE_FORBIDDEN'
        });
        const prepared = await service.prepareRead({ ...baseRequest, scope: { kind: 'folder', folderId: 'folder-1' } });
        assert.deepEqual(
          prepared.manifest.sources.map(ref => ref.noteId),
          ['normal']
        );
        noteRepository.save({ ...noteRepository.findById('normal'), aiVisibility: 'private' });
        await assert.rejects(
          service.authorizeRead({
            prepared,
            actorId: 'demo',
            approvedScopeHash: prepared.scopeSnapshot.scopeHash,
            approvedPayloadHash: prepared.manifest.payloadHash
          }),
          { code: 'AI_SCOPE_FORBIDDEN' }
        );
      })
  },
  {
    name: '旧只读版本等待中切私密后不生成原文预览',
    run: () =>
      withContext(async ({ service, addNote, noteRepository, noteVersionRepository }) => {
        addNote('note-1', 'alpha');
        const original = noteVersionRepository.findByNoteIdAndContentHash;
        noteVersionRepository.findByNoteIdAndContentHash = async (...args) => {
          const version = original(...args);
          noteRepository.save({ ...noteRepository.findById('note-1'), aiVisibility: 'private' });
          return version;
        };
        await assert.rejects(service.prepareRead({ ...baseRequest, scope: { kind: 'note', noteId: 'note-1' } }), {
          code: 'AI_SCOPE_FORBIDDEN'
        });
      })
  },
  {
    name: 'AI JSON 应用装配提供受信范围服务，并读取真实笔记版本',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-context-app-'));
      try {
        const app = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
        const space = app.http.knowledge.createDefaultKnowledgeSpace({});
        const note = app.http.knowledge.createNote({
          id: 'context-live',
          title: '测试笔记',
          rawMarkdown: 'alpha 正文',
          spaceId: space.id
        });
        const prepared = await app.ai.readContext.prepareRead({
          ...baseRequest,
          spaceId: space.id,
          scope: { kind: 'note', noteId: note.id }
        });
        assert.equal(prepared.preview.sources[0].text, 'alpha 正文');
        assert.equal(prepared.scopeSnapshot.ownerId, 'demo');
        const { maxTokens: ignored, ...withoutOutputLimit } = baseRequest;
        const defaultOutput = await app.ai.readContext.prepareRead({
          ...withoutOutputLimit,
          spaceId: space.id,
          scope: { kind: 'note', noteId: note.id }
        });
        assert.equal(defaultOutput.request.maxTokens, 4096);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'AI 选区只发送指定版本偏移，完整 payload 与预留和确认哈希一致',
    run: () =>
      withContext(async ({ store, service, addNote }) => {
        const version = addNote('note-1', '前文😀alpha后文');
        const prepared = await service.prepareRead({
          ...baseRequest,
          scope: { kind: 'selection', noteId: 'note-1', noteVersionId: version.id, start: 4, end: 9 }
        });
        assert.equal(prepared.preview.sources.length, 1);
        assert.equal(prepared.preview.sources[0].text, 'alpha');
        assert(!JSON.stringify(prepared.request).includes('前文'));
        assert(!JSON.stringify(prepared.request).includes('后文'));
        assert.equal(
          quoteWorstCase({ request: prepared.request, priceProfile, now: instant }).payloadHash,
          prepared.manifest.payloadHash
        );
        await assert.rejects(
          service.authorizeRead({
            prepared,
            actorId: 'actor-1',
            approvedScopeHash: prepared.scopeSnapshot.scopeHash,
            approvedPayloadHash: hashRecord('wrong')
          }),
          { code: 'AI_APPROVAL_STALE' }
        );
        const forged = structuredClone(prepared);
        const forgedBody = JSON.parse(forged.request.messages[1].content);
        forgedBody.sources[0].text = '清单之外的内容';
        forged.request.messages[1].content = JSON.stringify(forgedBody);
        const forgedOutbound = { ...normalizeAiRequest(forged.request), modelId: forged.request.modelId };
        forged.manifest.payloadHash = outboundPayloadHash(forgedOutbound);
        forged.manifest.estimatedInputTokens = Buffer.byteLength(serializedDeepSeekPayload(forgedOutbound), 'utf8');
        await assert.rejects(
          service.authorizeRead({
            prepared: forged,
            actorId: 'actor-1',
            approvedScopeHash: forged.scopeSnapshot.scopeHash,
            approvedPayloadHash: forged.manifest.payloadHash
          }),
          { code: 'AI_PAYLOAD_STALE' }
        );
        assert.equal(store.aiRepository.list('scopeSnapshot').length, 0);
        const authorized = await service.authorizeRead({
          prepared,
          actorId: 'actor-1',
          approvedScopeHash: prepared.scopeSnapshot.scopeHash,
          approvedPayloadHash: prepared.manifest.payloadHash
        });
        const fixture = aiRecords(store.aiRepository.identity());
        const job = {
          ...fixture.job,
          jobId: 'job-selected',
          grantId: authorized.grant.grantId,
          manifestId: authorized.manifest.manifestId,
          manifestHash: manifestHash(authorized.manifest),
          inputHash: hashRecord(authorized.request),
          createdAt: instant.toISOString(),
          updatedAt: instant.toISOString()
        };
        store.aiRepository.insert('aiJob', job);
        const worker = createAiWorker({
          repository: store.aiRepository,
          budget: store.aiBudgetAuthority,
          gateway: {
            capabilities: () => ({ provider: 'mock' }),
            complete: async () => ({
              content: '合成 JSON',
              json: {
                answer: 'alpha',
                citations: [{ sourceId: prepared.preview.sources[0].sourceId, start: 4, end: 9, quote: 'alpha' }]
              },
              requestId: 'synthetic',
              usage: { inputTokens: 10, outputTokens: 3, unknown: false }
            })
          },
          priceProfile,
          now: () => instant,
          verifySources: (current, request) => service.verifyJobSources(current, request),
          validateResult: (current, result) => service.validateAnswer({ jobId: current.jobId, result })
        });
        assert.equal((await worker.run(job.jobId, authorized.request)).json.answer, 'alpha');
        assert.equal(
          (
            await service.validateCitations({
              jobId: job.jobId,
              citations: [{ sourceId: prepared.preview.sources[0].sourceId, start: 4, end: 9, quote: 'alpha' }]
            })
          ).length,
          1
        );
        await assert.rejects(
          service.validateCitations({
            jobId: job.jobId,
            citations: [{ sourceId: prepared.preview.sources[0].sourceId, start: 4, end: 9, quote: '伪造' }]
          }),
          { code: 'AI_CITATION_INVALID' }
        );
        await assert.rejects(
          service.validateAnswer({ jobId: job.jobId, result: { json: { answer: '无引文结论', citations: [] } } }),
          { code: 'AI_CITATION_MISSING' }
        );
        await assert.rejects(
          service.validateAnswer({ jobId: job.jobId, result: { finishReason: 'length', truncated: true, json: null } }),
          { code: 'AI_OUTPUT_TRUNCATED' }
        );
        await assert.rejects(
          service.validateAnswer({
            jobId: job.jobId,
            result: {
              json: { answer: '伪造引用', citations: [{ sourceId: 'source-forged', start: 4, end: 9, quote: 'alpha' }] }
            }
          }),
          { code: 'AI_CITATION_INVALID' }
        );
        const badJob = {
          ...job,
          jobId: 'job-forged-citation',
          requestId: 'request-forged-citation',
          idempotencyKey: 'forged-citation'
        };
        store.aiRepository.insert('aiJob', badJob);
        const rejectingWorker = createAiWorker({
          repository: store.aiRepository,
          budget: store.aiBudgetAuthority,
          gateway: {
            capabilities: () => ({ provider: 'mock' }),
            complete: async () => ({
              content: '伪造 JSON',
              json: { answer: '伪造', citations: [{ sourceId: 'source-forged', start: 4, end: 9, quote: 'alpha' }] },
              requestId: 'synthetic-bad',
              usage: { inputTokens: 10, outputTokens: 3, unknown: false }
            })
          },
          priceProfile,
          now: () => instant,
          verifySources: (current, request) => service.verifyJobSources(current, request),
          validateResult: (current, result) => service.validateAnswer({ jobId: current.jobId, result })
        });
        await assert.rejects(rejectingWorker.run(badJob.jobId, authorized.request), { code: 'AI_CITATION_INVALID' });
        assert.equal(store.aiRepository.get('aiJob', badJob.jobId).status, 'failed');
      })
  },
  {
    name: 'AI 目录先核对 owner，再只检索固定目录和版本；新笔记不扩展旧范围',
    run: () =>
      withContext(async ({ service, folderRepository, addNote }) => {
        folderRepository.save({
          id: 'folder-1',
          spaceId: 'space-1',
          name: '选择的目录',
          parentId: null,
          deletedAt: null
        });
        folderRepository.save({
          id: 'folder-child',
          spaceId: 'space-1',
          name: '子目录',
          parentId: 'folder-1',
          deletedAt: null
        });
        addNote('inside', 'alpha 内容', 'space-1', 'folder-child');
        addNote('outside', 'alpha 私有内容', 'space-other');
        const prepared = await service.prepareRead({ ...baseRequest, scope: { kind: 'folder', folderId: 'folder-1' } });
        assert.deepEqual(
          prepared.preview.sources.map(source => source.noteId),
          ['inside']
        );
        assert.deepEqual(prepared.scopeSnapshot.allowedFolderIds, ['folder-1', 'folder-child']);
        addNote('later', 'alpha 新笔记', 'space-1', 'folder-child');
        assert.deepEqual(
          prepared.scopeSnapshot.allowedSources.map(source => source.noteId),
          ['inside']
        );
        await assert.rejects(
          service.prepareRead({ ...baseRequest, spaceId: 'space-other', scope: { kind: 'note', noteId: 'outside' } }),
          { code: 'AI_SCOPE_FORBIDDEN' }
        );
      })
  },
  {
    name: 'AI Markdown 标题范围只接受完整章节，不扩展到下一个同级标题',
    run: () =>
      withContext(async ({ service, addNote }) => {
        const content = '# 第一节\nalpha\n## 子节\nbeta\n# 第二节\nprivate';
        const version = addNote('note-headings', content);
        const end = content.indexOf('# 第二节');
        const prepared = await service.prepareRead({
          ...baseRequest,
          scope: { kind: 'heading', noteId: 'note-headings', noteVersionId: version.id, start: 0, end }
        });
        assert.equal(prepared.preview.sources[0].text, content.slice(0, end));
        assert(!JSON.stringify(prepared.request).includes('private'));
        await assert.rejects(
          service.prepareRead({
            ...baseRequest,
            scope: { kind: 'heading', noteId: 'note-headings', noteVersionId: version.id, start: 0, end: end - 1 }
          }),
          { code: 'AI_SCOPE_INVALID' }
        );
      })
  },
  {
    name: 'AI 来源排除、上下文预算、版本变化和 emoji 偏移均失败关闭',
    run: () =>
      withContext(async ({ service, noteRepository, addNote }) => {
        const version = addNote('note-1', `alpha${'内容'.repeat(1800)}😀`);
        const first = await service.prepareRead({
          ...baseRequest,
          scope: { kind: 'note', noteId: 'note-1' },
          maxInputTokens: 12_000
        });
        const excluded = first.scopeSnapshot.allowedSources[0].sourceId;
        const second = await service.prepareRead({
          ...baseRequest,
          scope: { kind: 'note', noteId: 'note-1' },
          excludedSourceIds: [excluded],
          maxInputTokens: 4000
        });
        assert(!second.manifest.sources.some(source => source.sourceId === excluded));
        assert(second.manifest.omissions.some(item => item.includes('已排除')));
        assert(second.manifest.omissions.some(item => item.includes('预算')));
        assert(second.manifest.estimatedInputTokens <= 4000);
        await assert.rejects(
          service.prepareRead({
            ...baseRequest,
            scope: {
              kind: 'selection',
              noteId: 'note-1',
              noteVersionId: version.id,
              start: version.content.length - 1,
              end: version.content.length
            }
          }),
          { code: 'AI_SCOPE_INVALID' }
        );
        noteRepository.save({
          ...noteRepository.findById('note-1'),
          rawMarkdown: '新版本',
          updatedAt: '2026-09-26T00:00:01.000Z'
        });
        await assert.rejects(
          service.authorizeRead({
            prepared: first,
            actorId: 'actor-1',
            approvedScopeHash: first.scopeSnapshot.scopeHash,
            approvedPayloadHash: first.manifest.payloadHash
          }),
          { code: 'AI_SOURCE_STALE' }
        );
      })
  }
];
