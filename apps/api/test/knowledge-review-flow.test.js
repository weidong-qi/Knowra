import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeModule } from '../src/modules/knowledge/index.js';
import { createAsyncKnowledgeItemService } from '../src/modules/knowledge/application/postgres-async/knowledge-domain-service.js';
import { createInMemoryKnowledgeItemRepository } from '../src/modules/knowledge/infrastructure/knowledge-item-repository.js';
import { createInMemoryKnowledgeEvidenceRepository } from '../src/modules/knowledge/infrastructure/knowledge-evidence-repository.js';
import { createPostgresKnowledgeItemRepository } from '../src/modules/knowledge/infrastructure/postgres/knowledge-item-repository.js';
import { createKnowledgeHttpHandlers } from '../src/modules/knowledge/http/knowledge-handlers.js';
import { createServer } from '../src/server.js';
import { createAppContext } from '../src/app.factory.js';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import { writeJsonFileAtomically } from '../src/infrastructure/atomic-json-file.js';
import { annotationOf, markText } from './fixtures/inline-annotation-seed.js';

const manual = { title: '人工候选', canonicalStatement: '确认前需要核对来源与知识内容', sourceMode: 'manual' };
const code = expected => error => error.code === expected;
const asAsync = repository =>
  new Proxy(repository, {
    get(target, key) {
      return typeof target[key] === 'function' ? async (...args) => target[key](...args) : target[key];
    }
  });

export const knowledgeReviewFlowTests = [
  {
    name: '相同客户端 ID 可恢复丢失的候选创建响应，不覆盖已变更或已确认的知识',
    async run() {
      const services = [
        createKnowledgeModule().knowledgeItemService,
        createAsyncKnowledgeItemService({
          repository: asAsync(createInMemoryKnowledgeItemRepository()),
          evidenceRepository: asAsync(createInMemoryKnowledgeEvidenceRepository())
        })
      ];
      for (const service of services) {
        const input = { ...manual, id: 'retry-candidate' };
        const created = await service.createCandidate(input);
        assert.deepEqual(await service.createCandidate(input), created);
        assert.equal((await service.listItems()).length, 1);
        await assert.rejects(
          async () => service.createCandidate({ ...input, canonicalStatement: '不同请求' }),
          code('KNOWLEDGE_ITEM_ID_CONFLICT')
        );
        await service.confirmItem(created.item.id);
        await assert.rejects(async () => service.createCandidate(input), code('KNOWLEDGE_ITEM_ID_CONFLICT'));
      }
    }
  },
  {
    name: '知识编辑、确认、归档和恢复拒绝过期基线，同毫秒也能识别新版本',
    async run() {
      const services = [
        createKnowledgeModule().knowledgeItemService,
        createAsyncKnowledgeItemService({
          repository: asAsync(createInMemoryKnowledgeItemRepository()),
          evidenceRepository: asAsync(createInMemoryKnowledgeEvidenceRepository())
        })
      ];
      for (const service of services) {
        const { item } = await service.createCandidate({ ...manual, updatedAt: '2099-01-01T00:00:00.000Z' });
        const saved = await service.updateItem(item.id, { title: '已修改', expectedUpdatedAt: item.updatedAt });
        assert(Date.parse(saved.updatedAt) > Date.parse(item.updatedAt));
        for (const operation of ['updateItem', 'confirmItem', 'archive', 'restore']) {
          await assert.rejects(
            async () => service[operation](item.id, { title: '不应覆盖', expectedUpdatedAt: item.updatedAt }),
            code('KNOWLEDGE_ITEM_UPDATE_CONFLICT')
          );
        }
        await assert.rejects(
          async () => service.confirmItem(item.id, { expectedUpdatedAt: 'invalid' }),
          code('KNOWLEDGE_ITEM_BASELINE_INVALID')
        );
        const confirmed = await service.confirmItem(item.id, { expectedUpdatedAt: saved.updatedAt });
        const revised = await service.updateItem(item.id, {
          canonicalStatement: '修订内容',
          expectedUpdatedAt: confirmed.updatedAt
        });
        assert.equal(revised.reviewStatus, 'needsRevision');
        const archived = await service.archive(item.id, { expectedUpdatedAt: revised.updatedAt });
        assert.equal(
          (await service.restore(item.id, { expectedUpdatedAt: archived.updatedAt })).reviewStatus,
          'candidate'
        );
      }
    }
  },
  {
    name: '异步知识编辑与确认竞争时只有一个操作成功',
    async run() {
      const service = createAsyncKnowledgeItemService({
        repository: asAsync(createInMemoryKnowledgeItemRepository()),
        evidenceRepository: asAsync(createInMemoryKnowledgeEvidenceRepository())
      });
      const { item } = await service.createCandidate(manual);
      const result = await Promise.allSettled([
        service.updateItem(item.id, { title: '并发修改', expectedUpdatedAt: item.updatedAt }),
        service.confirmItem(item.id, { expectedUpdatedAt: item.updatedAt })
      ]);
      assert.equal(result.filter(entry => entry.status === 'fulfilled').length, 1);
      assert.equal(result.find(entry => entry.status === 'rejected').reason.code, 'KNOWLEDGE_ITEM_UPDATE_CONFLICT');
    }
  },
  {
    name: '标注来源摘录由后端取值且无效或重复来源不留下孤立知识候选',
    async run() {
      const knowledge = createKnowledgeModule();
      const note = knowledge.noteService.createNote({
        id: 'review-source-note',
        spaceId: 'space-demo',
        title: '来源',
        rawMarkdown: `# 来源\n\n${markText('真实来源', 'src')}`
      });
      const annotation = annotationOf(knowledge, note.id, 'src');
      const item = knowledge.knowledgeItemService.createCandidate({
        ...manual,
        sourceMode: 'annotation',
        evidence: [
          { sourceType: 'annotation', annotationId: annotation.id, quoteText: '伪造摘录', headingPath: ['伪造章节'] }
        ]
      });
      assert.equal(item.evidence[0].quoteText, '真实来源');
      assert.deepEqual(item.evidence[0].headingPath, ['来源']);
      assert.equal(item.evidence[0].noteVersionId, annotation.noteVersionId);
      assert.throws(
        () =>
          knowledge.knowledgeItemService.createCandidate({
            ...manual,
            evidence: [
              {
                sourceType: 'annotation',
                annotationId: annotation.id,
                expectedAnnotationRevision: annotation.revision + 1
              }
            ]
          }),
        code('KNOWLEDGE_EVIDENCE_REVISION_CONFLICT')
      );
      const retryInput = {
        ...manual,
        id: 'annotation-retry',
        sourceMode: 'annotation',
        evidence: [
          {
            sourceType: 'annotation',
            annotationId: annotation.id,
            noteVersionId: annotation.noteVersionId,
            expectedAnnotationRevision: annotation.revision
          }
        ]
      };
      const original = knowledge.knowledgeItemService.createCandidate(retryInput);
      assert.deepEqual(knowledge.knowledgeItemService.createCandidate(retryInput), original);
      assert.throws(
        () =>
          knowledge.knowledgeItemService.createCandidate({
            ...manual,
            id: 'orphan',
            sourceMode: 'annotation',
            evidence: [{ sourceType: 'annotation', annotationId: 'missing' }]
          }),
        code('ANNOTATION_NOT_FOUND')
      );
      assert.throws(() => knowledge.knowledgeItemService.getItem('orphan'), code('KNOWLEDGE_ITEM_NOT_FOUND'));
      assert.throws(
        () =>
          knowledge.knowledgeItemService.createCandidate({
            ...manual,
            id: 'duplicate',
            evidence: [
              { id: 'dup', sourceType: 'manual' },
              { id: 'dup', sourceType: 'manual' }
            ]
          }),
        code('KNOWLEDGE_EVIDENCE_ID_CONFLICT')
      );
      assert.throws(() => knowledge.knowledgeItemService.getItem('duplicate'), code('KNOWLEDGE_ITEM_NOT_FOUND'));
      assert.throws(
        () =>
          knowledge.knowledgeItemService.createCandidate({
            ...manual,
            evidence: [{ sourceType: 'annotation', annotationId: annotation.id, noteVersionId: 'wrong-version' }]
          }),
        code('KNOWLEDGE_EVIDENCE_VERSION_MISMATCH')
      );
    }
  },
  {
    name: '笔记正文变更使直接版本知识来源待核对并保留历史摘录',
    run() {
      const knowledge = createKnowledgeModule();
      const note = knowledge.noteService.createNote({
        id: 'review-version-note',
        spaceId: 'space-demo',
        title: '来源',
        rawMarkdown: '第一版来源'
      });
      const version = knowledge.noteVersionService.listVersions({ noteId: note.id })[0];
      const { item } = knowledge.knowledgeItemService.createCandidate({
        ...manual,
        sourceMode: 'selection',
        evidence: [{ sourceType: 'noteVersion', noteVersionId: version.id, quoteText: version.content }]
      });
      knowledge.knowledgeItemService.confirmItem(item.id);
      knowledge.noteService.updateNote(note.id, { rawMarkdown: '第二版来源' });
      assert.equal(knowledge.knowledgeItemService.getItem(item.id).reviewStatus, 'needsRevision');
      assert.equal(knowledge.knowledgeItemService.listEvidence(item.id)[0].status, 'stale');
      assert.equal(knowledge.knowledgeItemService.listEvidence(item.id)[0].quoteText, '第一版来源');
      assert.throws(() => knowledge.knowledgeItemService.confirmItem(item.id), code('KNOWLEDGE_ITEM_SOURCE_REQUIRED'));
    }
  },
  {
    name: '来源在确认同毫秒失效仍推进知识基线并拒绝旧编辑和旧确认',
    async run() {
      const knowledge = createKnowledgeModule();
      const note = knowledge.noteService.createNote({
        id: 'same-ms-source',
        spaceId: 'space-demo',
        title: '来源',
        rawMarkdown: '第一版来源'
      });
      const version = knowledge.noteVersionService.listVersions({ noteId: note.id })[0];
      const { item } = knowledge.knowledgeItemService.createCandidate({
        ...manual,
        sourceMode: 'selection',
        evidence: [{ sourceType: 'noteVersion', noteVersionId: version.id }]
      });
      const confirmed = knowledge.knowledgeItemService.confirmItem(item.id);
      const originalNow = Date.now;
      try {
        Date.now = () => Date.parse(confirmed.updatedAt);
        knowledge.knowledgeItemService.markEvidenceByNoteVersionId(version.id, 'stale', 'noteVersion');
      } finally {
        Date.now = originalNow;
      }
      const stale = knowledge.knowledgeItemService.getItem(item.id);
      assert.equal(stale.reviewStatus, 'needsRevision');
      assert.equal(Date.parse(stale.updatedAt), Date.parse(confirmed.updatedAt) + 1);
      assert.throws(
        () =>
          knowledge.knowledgeItemService.updateItem(item.id, {
            title: '旧窗口的修改',
            expectedUpdatedAt: confirmed.updatedAt
          }),
        code('KNOWLEDGE_ITEM_UPDATE_CONFLICT')
      );
      assert.throws(
        () => knowledge.knowledgeItemService.confirmItem(item.id, { expectedUpdatedAt: confirmed.updatedAt }),
        code('KNOWLEDGE_ITEM_UPDATE_CONFLICT')
      );
    }
  },
  {
    name: '知识候选和来源保存只提交一次，磁盘失败完全回滚',
    run() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-review-flow-'));
      const file = path.join(dir, 'data.json');
      let fail = false;
      let writes = 0;
      try {
        const dataStore = createFileDataStore(file, {
          writeJson(target, value) {
            writes++;
            if (fail) {
              fail = false;
              throw new Error('disk failure');
            }
            writeJsonFileAtomically(target, value);
          }
        });
        const app = createAppContext({
          dataStore,
          storageRootDir: dir,
          uploadsDir: path.join(dir, 'uploads'),
          ownerId: 'test'
        });
        const api = app.http.knowledge;
        const space = api.createDefaultKnowledgeSpace();
        const note = api.createNote({
          id: 'atomic-review-note',
          spaceId: space.id,
          rawMarkdown: '来源',
          title: '来源'
        });
        const version = api.listNoteVersions({ id: note.id })[0];
        const input = {
          ...manual,
          sourceMode: 'selection',
          evidence: [{ sourceType: 'noteVersion', noteVersionId: version.id }]
        };
        const before = JSON.stringify(dataStore.state);
        fail = true;
        assert.throws(() => api.createKnowledgeItem(input), code('STORAGE_WRITE_FAILED'));
        assert.equal(JSON.stringify(dataStore.state), before);
        assert.equal(createFileDataStore(file).state.knowledgeItems.length, 0);
        const count = writes;
        api.createKnowledgeItem(input);
        assert.equal(writes - count, 1);
        const restored = createFileDataStore(file).state;
        assert.equal(restored.knowledgeItems.length, 1);
        assert.equal(restored.knowledgeEvidence[0].knowledgeItemId, restored.knowledgeItems[0].id);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: '知识 HTTP 确认接收基线并返回冲突，归档搜索与恢复可往返',
    async run() {
      const module = createKnowledgeModule();
      const server = createServer({
        appContext: { http: { knowledge: createKnowledgeHttpHandlers({ knowledgeModule: module }), storage: {} } },
        logger: { error() {} }
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = `http://127.0.0.1:${server.address().port}/api/knowledge/items`;
      const send = async (url, method, input) => {
        const response = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input)
        });
        return { status: response.status, ...(await response.json()) };
      };
      try {
        const {
          data: { item }
        } = await send(base, 'POST', manual);
        const { data: updated } = await send(`${base}/${item.id}`, 'PATCH', {
          title: '知识搜索例子',
          expectedUpdatedAt: item.updatedAt
        });
        const conflict = await send(`${base}/${item.id}/confirm`, 'POST', { expectedUpdatedAt: item.updatedAt });
        assert.equal(conflict.status, 409);
        assert.equal(conflict.error.code, 'KNOWLEDGE_ITEM_UPDATE_CONFLICT');
        const confirmed = await send(`${base}/${item.id}/confirm`, 'POST', { expectedUpdatedAt: updated.updatedAt });
        const archived = await send(`${base}/${item.id}/archive`, 'POST', {
          expectedUpdatedAt: confirmed.data.updatedAt
        });
        const list = await (await fetch(`${base}?reviewStatus=archived&query=${encodeURIComponent('搜索')}`)).json();
        assert.equal(list.data[0].id, item.id);
        assert.deepEqual((await (await fetch(`${base}?includeArchived=false`)).json()).data, []);
        assert.equal(
          (await send(`${base}/${item.id}/restore`, 'POST', { expectedUpdatedAt: archived.data.updatedAt })).data
            .reviewStatus,
          'candidate'
        );
      } finally {
        server.close();
        await once(server, 'close');
      }
    }
  },
  {
    name: '移除知识来源保留历史，并让失去有效来源的已确认知识转为待修订',
    async run() {
      const services = [
        createKnowledgeModule().knowledgeItemService,
        createAsyncKnowledgeItemService({
          repository: asAsync(createInMemoryKnowledgeItemRepository()),
          evidenceRepository: asAsync(createInMemoryKnowledgeEvidenceRepository())
        })
      ];
      for (const service of services) {
        const created = await service.createCandidate({
          ...manual,
          sourceMode: 'annotation',
          evidence: [{ sourceType: 'manual', quoteText: '历史摘录' }]
        });
        const confirmed = await service.confirmItem(created.item.id, { expectedUpdatedAt: created.item.updatedAt });
        const result = await service.retireEvidence(created.item.id, created.evidence[0].id, {
          expectedUpdatedAt: created.evidence[0].updatedAt
        });
        assert.equal(result.evidence.status, 'valid');
        assert.equal(result.evidence.applicabilityStatus, 'withdrawn');
        assert.equal(result.evidence.quoteText, '历史摘录');
        assert.equal(result.item.reviewStatus, 'needsRevision');
        assert.equal((await service.listEvidence(created.item.id)).length, 1);
        await assert.rejects(
          async () =>
            service.retireEvidence(created.item.id, created.evidence[0].id, {
              expectedUpdatedAt: '2000-01-01T00:00:00.000Z'
            }),
          code('KNOWLEDGE_EVIDENCE_UPDATE_CONFLICT')
        );
        assert(Date.parse(result.item.updatedAt) > Date.parse(confirmed.updatedAt));
      }
    }
  },
  {
    name: 'PostgreSQL 知识保存使用数据库时间基线比较，冲突不覆盖记录',
    async run() {
      let query;
      const repository = createPostgresKnowledgeItemRepository({
        db: {
          knowledgeItem: {
            async updateMany(input) {
              query = input;
              return { count: 0 };
            }
          }
        }
      });
      await assert.rejects(
        () =>
          repository.save(
            {
              id: 'concurrent',
              ...manual,
              updatedAt: '2026-09-21T00:00:01.000Z',
              createdAt: '2026-09-21T00:00:00.000Z'
            },
            { expectedUpdatedAt: '2026-09-21T00:00:00.000Z' }
          ),
        code('KNOWLEDGE_ITEM_UPDATE_CONFLICT')
      );
      assert.equal(query.where.id, 'concurrent');
      assert.equal(query.where.updatedAt.toISOString(), '2026-09-21T00:00:00.000Z');
    }
  }
];
