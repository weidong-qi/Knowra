import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAppContext } from '../src/app.factory.js';
import { createServer } from '../src/server.js';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import { writeJsonFileAtomically } from '../src/infrastructure/atomic-json-file.ts';
import {
  inspectAttachmentDeletion,
  loadPostgresAttachmentReferenceState
} from '../src/infrastructure/attachment-deletion-preflight.ts';
import { createKnowledgeArtifactProvenanceReader } from '../src/modules/knowledge/application/knowledge-artifact-provenance-read.ts';
import { hashKnowledgeArtifactProvenance } from '../src/modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';
import { buildNoteVersionPrunePreview } from '../src/modules/knowledge/application/note-version-prune-preview.ts';
import { createKnowledgeExtractionJobFixture } from './fixtures/knowledge-extraction-job.fixture.js';

const logger = { warn() {}, error() {} };
const sha = value => createHash('sha256').update(value).digest('hex');
function reseal(value) {
  const { provenanceHash, ...record } = value;
  return { ...record, provenanceHash: hashKnowledgeArtifactProvenance(record) };
}
async function withCommitted(run, storageOptions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-provenance-read-'));
  const file = path.join(root, 'data.json');
  const open = () =>
    createAppContext({ dataStore: createFileDataStore(file, storageOptions), ownerId: 'demo', storageRootDir: root });
  try {
    const app = open(),
      fixture = await createKnowledgeExtractionJobFixture(app);
    const receipt = app.knowledgeExtractionCommit.commit(fixture.input);
    const id = receipt.candidates[0].candidateInput.id;
    await run({ ...fixture, app, file, root, open, receipt, id });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
async function withHttp(app, run) {
  const server = createServer({ appContext: app, logger });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await server.closeAi();
  }
}

export const knowledgeProvenanceReadLifecycleTests = [
  {
    name: '05B 核心HTTP在AI关闭后回读生成事实，回收站/恢复及来源更新只改变投影',
    async run() {
      await withCommitted(async f => {
        f.app.ai = null;
        const expected = f.knowledge.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(f.id);
        await withHttp(f.app, async origin => {
          const read = async () => {
            const response = await fetch(`${origin}/api/knowledge/items/${encodeURIComponent(f.id)}/provenance`);
            const body = await response.json();
            assert.equal(response.status, 200, JSON.stringify(body));
            return body.data;
          };
          const first = await read();
          assert.equal(first.state, 'recorded');
          assert.deepEqual(first.record, expected);
          assert.equal(first.record.provider, 'mock');
          assert.equal(first.sources[0].sourceState, 'available');
          assert.equal(JSON.stringify(first).includes(f.excluded), false);
          for (const key of ['request', 'result', 'task', 'grant', 'attempt', 'lease', 'manifest', 'credentialRef'])
            assert.equal(Object.hasOwn(first.record, key), false);
          const transition = async (action, expectedUpdatedAt) => {
            const response = await fetch(`${origin}/api/knowledge/items/${encodeURIComponent(f.id)}/${action}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ expectedUpdatedAt })
            });
            const body = await response.json();
            assert.equal(response.status, 200, JSON.stringify(body));
            return body.data;
          };
          const trashed = await transition('trash', f.knowledge.knowledgeItemService.getItem(f.id).updatedAt);
          const inTrash = await read();
          assert.equal(inTrash.state, 'recorded');
          assert.deepEqual(inTrash.record, expected);
          assert.equal(inTrash.record.provenanceHash, first.record.provenanceHash);
          assert.equal(inTrash.sources[0].sourceState, 'unavailable');
          await assert.rejects(createKnowledgeArtifactProvenanceReader(f.knowledge.repositories)(f.id, 'other-owner'), {
            code: 'KNOWLEDGE_ITEM_NOT_FOUND',
            statusCode: 404
          });
          await transition('restore-deleted', trashed.updatedAt);
          const restored = await read();
          assert.deepEqual(restored.record, expected);
          assert.equal(restored.sources[0].sourceState, 'available');
          f.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: `${f.note.rawMarkdown}\n当前笔记的后续编辑` });
          assert.equal((await read()).sources[0].sourceState, 'stale');
          const evidence = f.knowledge.knowledgeItemService.listEvidence(f.id)[0];
          f.knowledge.knowledgeItemService.retireEvidence(f.id, evidence.id, { expectedUpdatedAt: evidence.updatedAt });
          assert.equal((await read()).sources[0].sourceState, 'unavailable');
          f.knowledge.noteService.deleteNote(f.note.id);
          assert.deepEqual((await read()).record, expected);
          const current = f.knowledge.knowledgeItemService.getItem(f.id);
          f.knowledge.knowledgeItemService.trash(f.id, { expectedUpdatedAt: current.updatedAt });
          const unavailable = await read();
          assert.deepEqual(unavailable.record, expected);
          assert.equal(unavailable.sources[0].sourceState, 'unavailable');
          const missing = await fetch(`${origin}/api/knowledge/items/missing-item/provenance`);
          assert.equal(missing.status, 404);
          assert.equal((await missing.json()).error.code, 'KNOWLEDGE_ITEM_NOT_FOUND');
          assert.deepEqual(
            f.knowledge.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(f.id),
            expected
          );
        });
      });
    }
  },
  {
    name: '05B 核心投影通过Evidence解析alias，跨owner/错笔记/错hash拒绝且原事实不改',
    async run() {
      await withCommitted(async f => {
        const repositories = f.knowledge.repositories;
        const record = repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(f.id);
        const source = record.sources[0],
          evidence = repositories.knowledgeEvidenceRepository.findById(source.evidenceId);
        const version = repositories.noteVersionRepository.findById(evidence.noteVersionId);
        let resolvedVersion = { ...version, id: 'synchronized-version' },
          conflictingOriginal = null;
        const reader = createKnowledgeArtifactProvenanceReader({
          ...repositories,
          knowledgeEvidenceRepository: { findById: () => ({ ...evidence, noteVersionId: 'synchronized-version' }) },
          noteVersionRepository: {
            findById: id => (id === 'synchronized-version' ? resolvedVersion : conflictingOriginal)
          }
        });
        const result = await reader(f.id, 'demo');
        assert.deepEqual(result.record, record);
        assert.deepEqual(result.sources[0], {
          evidenceId: evidence.id,
          originalVersionId: source.originNoteVersionId,
          resolvedVersionId: 'synchronized-version',
          aliasUsed: true,
          sourceState: 'available'
        });
        await assert.rejects(reader(f.id, 'other-owner'), { code: 'KNOWLEDGE_ITEM_NOT_FOUND' });
        for (const change of [{ noteId: 'other-note' }, { contentHash: 'f'.repeat(64) }, { content: '篡改历史正文' }]) {
          resolvedVersion = { ...version, id: 'synchronized-version', ...change };
          await assert.rejects(reader(f.id, 'demo'), { code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_SOURCE_MISMATCH' });
        }
        resolvedVersion = { ...version, id: 'synchronized-version' };
        conflictingOriginal = { ...version, contentHash: 'f'.repeat(64) };
        await assert.rejects(reader(f.id, 'demo'), { code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_SOURCE_MISMATCH' });
        assert.deepEqual(repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(f.id), record);
        const target = f.knowledge.knowledgeSpaceService.createKnowledgeSpace({ userId: 'demo', name: '迁移后空间' });
        const preview = f.knowledge.previewSpaceMigration(f.space.id, target.id, 'demo');
        f.knowledge.migrateSpaceAssets(
          f.space.id,
          { targetSpaceId: target.id, expectedPreviewHash: preview.previewHash },
          'demo'
        );
        assert.deepEqual((await f.app.http.knowledge.getKnowledgeProvenance({ id: f.id })).record, record);
      });
    }
  },
  {
    name: '05B 知识purge同事务删除独占摘要，磁盘失败回滚且receipt不能复活产物',
    async run() {
      let fail = false;
      await withCommitted(
        async f => {
          const record = f.knowledge.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(f.id);
          const trashed = f.knowledge.knowledgeItemService.trash(f.id);
          assert.deepEqual(f.knowledge.inspectKnowledgePurge(f.id).exclusiveRecords.knowledgeArtifactProvenanceIds, [
            record.id
          ]);
          const disk = fs.readFileSync(f.file, 'utf8'),
            before = f.app.dataStore.exportSnapshot();
          fail = true;
          assert.throws(
            () => f.knowledge.permanentlyDeleteKnowledgeItem(f.id, { expectedUpdatedAt: trashed.updatedAt }),
            { code: 'STORAGE_WRITE_FAILED' }
          );
          assert.deepEqual(f.app.dataStore.exportSnapshot().data, before.data);
          assert.equal(fs.readFileSync(f.file, 'utf8'), disk);
          fail = false;
          const purged = f.knowledge.permanentlyDeleteKnowledgeItem(f.id, { expectedUpdatedAt: trashed.updatedAt });
          assert.equal(purged.exclusiveRecordsDeleted.knowledgeArtifactProvenance, 1);
          const restarted = f.open();
          assert.equal(
            restarted.modules.knowledge.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(f.id),
            null
          );
          assert(
            restarted.dataStore.getSyncJournal().tombstones[JSON.stringify(['knowledgeArtifactProvenance', record.id])]
          );
          assert.deepEqual(restarted.knowledgeExtractionCommit.commit(f.input), f.receipt);
          await assert.rejects(restarted.http.knowledge.getKnowledgeProvenance({ id: f.id }), {
            code: 'KNOWLEDGE_ITEM_NOT_FOUND'
          });
          assert.equal(
            restarted.modules.knowledge.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(f.id),
            null
          );
        },
        {
          writeJson: (...args) => {
            if (fail) throw new Error('synthetic disk failure');
            return writeJsonFileAtomically(...args);
          }
        }
      );
    }
  },
  {
    name: '05B 版本preview引用摘要原版本及Evidence当前alias，附件只扫描必要精确摘录',
    async run() {
      await withCommitted(async f => {
        const record = f.knowledge.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(f.id);
        const source = record.sources[0],
          evidence = f.knowledge.knowledgeItemService.listEvidence(f.id)[0];
        const current = f.knowledge.previewNoteVersionPrune(f.note.id);
        assert(
          current.versions
            .find(version => version.id === source.originNoteVersionId)
            .references.some(ref => ref.type === 'knowledgeArtifactProvenance' && ref.id === record.id)
        );
        const aliasedVersion = {
          ...f.knowledge.repositories.noteVersionRepository.findById(evidence.noteVersionId),
          id: 'aliased-version'
        };
        const scopeBefore = JSON.stringify(f.scope);
        const alias = buildNoteVersionPrunePreview({
          note: f.note,
          versions: [aliasedVersion],
          evidence: [{ ...evidence, noteVersionId: 'aliased-version' }],
          provenance: [record],
          questionSources: [],
          annotations: [],
          exclusions: [],
          analysisScopes: [f.scope]
        });
        assert(alias.versions[0].references.some(ref => ref.type === 'knowledgeArtifactProvenance'));
        assert(alias.versions[0].references.some(ref => ref.type === 'analysisScopeSnapshot'));
        assert.equal(JSON.stringify(f.scope), scopeBefore);
        assert.equal(alias.mode, 'preview-only');
        assert.equal(alias.versions[0].canPruneNow, false);
        const link = '/api/storage/attachments/source-attachment/content';
        const quoteText = `  ![合成附件](${link})  `;
        const summary = reseal({
          ...record,
          sources: [{ ...source, start: 0, end: quoteText.length, quoteText, quoteHash: sha(quoteText) }]
        });
        const scan = inspectAttachmentDeletion('source-attachment', {
          knowledgeArtifactProvenance: [summary],
          knowledgeItems: [{ id: f.id, title: '合成知识' }]
        });
        assert.deepEqual(
          scan.references.map(ref => [ref.collection, ref.knowledgeItemId]),
          [['knowledgeArtifactProvenance', f.id]]
        );
        const unrelated = reseal({
          ...summary,
          origin: { ...record.origin, jobId: link },
          sources: [{ ...source, start: 0, end: 4, quoteText: '没有附件', quoteHash: sha('没有附件') }]
        });
        assert.equal(
          inspectAttachmentDeletion('source-attachment', { knowledgeArtifactProvenance: [unrelated] }).references
            .length,
          0
        );
        assert.throws(
          () =>
            inspectAttachmentDeletion('source-attachment', {
              knowledgeArtifactProvenance: [{ ...summary, state: 'future' }]
            }),
          { code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_INVALID' }
        );
        // 仅验证 PG payload 适配；此受控 adapter 不算真实 PostgreSQL 验收。
        const db = new Proxy(
          {},
          {
            get: (_, model) => ({
              findMany: async () => (model === 'knowledgeArtifactProvenance' ? [{ payload: summary }] : [])
            })
          }
        );
        assert.equal(
          inspectAttachmentDeletion('source-attachment', await loadPostgresAttachmentReferenceState(db)).references
            .length,
          1
        );
      });
    }
  },
  {
    name: '05B 真实SQLite核心回读与摘要purge原子回滚，重启仍保留同一来源事实',
    async run() {
      const { createSqliteDataStore } = await import('../../desktop-runtime/src/sqlite-data-store.mjs');
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-provenance-sqlite-'));
      let store;
      const open = () => {
        store = createSqliteDataStore(path.join(root, 'local.sqlite'));
        return createAppContext({ dataStore: store, ownerId: 'demo', storageRootDir: root });
      };
      try {
        const app = open(),
          f = await createKnowledgeExtractionJobFixture(app),
          receipt = app.knowledgeExtractionCommit.commit(f.input);
        const id = receipt.candidates[0].candidateInput.id,
          projection = await app.http.knowledge.getKnowledgeProvenance({ id });
        assert.equal(projection.state, 'recorded');
        const knowledge = app.modules.knowledge;
        knowledge.knowledgeItemService.trash(id);
        const inTrash = await app.http.knowledge.getKnowledgeProvenance({ id });
        assert.equal(inTrash.state, 'recorded');
        assert.deepEqual(inTrash.record, projection.record);
        assert.equal(inTrash.sources[0].sourceState, 'unavailable');
        await assert.rejects(createKnowledgeArtifactProvenanceReader(knowledge.repositories)(id, 'other-owner'), {
          code: 'KNOWLEDGE_ITEM_NOT_FOUND',
          statusCode: 404
        });
        knowledge.knowledgeItemService.restoreDeleted(id);
        const restored = await app.http.knowledge.getKnowledgeProvenance({ id });
        assert.deepEqual(restored.record, projection.record);
        assert.equal(restored.sources[0].sourceState, 'available');
        const trashed = knowledge.knowledgeItemService.trash(id);
        const repository = knowledge.repositories.knowledgeItemRepository,
          remove = repository.delete;
        repository.delete = () => {
          throw new Error('synthetic purge failure after provenance delete');
        };
        try {
          assert.throws(
            () => knowledge.permanentlyDeleteKnowledgeItem(id, { expectedUpdatedAt: trashed.updatedAt }),
            /synthetic purge failure/
          );
        } finally {
          repository.delete = remove;
        }
        assert.deepEqual(
          knowledge.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(id),
          projection.record
        );
        store.close();
        store = null;
        const restarted = open();
        assert.deepEqual(
          restarted.modules.knowledge.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(id),
          projection.record
        );
        const purged = restarted.modules.knowledge.permanentlyDeleteKnowledgeItem(id, {
          expectedUpdatedAt: trashed.updatedAt
        });
        assert.equal(purged.exclusiveRecordsDeleted.knowledgeArtifactProvenance, 1);
        assert(
          store
            .readOutbox()
            .some(batch =>
              ['knowledgeItems', 'knowledgeEvidence', 'knowledgeArtifactProvenance'].every(collection =>
                batch.changes.some(change => change.collection === collection && change.action === 'delete')
              )
            )
        );
        store.close();
        store = null;
        const afterPurge = open();
        assert.equal(
          afterPurge.modules.knowledge.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(id),
          null
        );
        await assert.rejects(afterPurge.http.knowledge.getKnowledgeProvenance({ id }), {
          code: 'KNOWLEDGE_ITEM_NOT_FOUND',
          statusCode: 404
        });
      } finally {
        store?.close();
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: '05B 旧schema迁移如实标记来源缺失，普通HTTP不能假声明AI来源',
    async run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-provenance-legacy-')),
        file = path.join(root, 'data.json');
      try {
        const app = createAppContext({ dataStore: createFileDataStore(file), ownerId: 'demo', storageRootDir: root });
        const { item } = app.modules.knowledge.knowledgeItemService.createCandidate({
          title: '旧知识',
          canonicalStatement: '人工维护的旧内容'
        });
        const legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
        legacy.schemaVersion = 6;
        legacy.knowledgeItems[0].sourceMode = 'ai';
        delete legacy.knowledgeArtifactProvenance;
        fs.writeFileSync(file, JSON.stringify(legacy));
        const migrated = createAppContext({
          dataStore: createFileDataStore(file),
          ownerId: 'demo',
          storageRootDir: root
        });
        await withHttp(migrated, async origin => {
          const read = await fetch(`${origin}/api/knowledge/items/${item.id}/provenance`);
          const projection = (await read.json()).data;
          assert.equal(read.status, 200);
          assert.equal(projection.state, 'legacy-unavailable');
          assert.equal(projection.record.provider, undefined);
          assert.deepEqual(projection.sources, []);
          for (const [route, method] of [
            ['/api/knowledge/items', 'POST'],
            [`/api/knowledge/items/${item.id}`, 'PATCH']
          ]) {
            const response = await fetch(`${origin}${route}`, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sourceMode: 'ai', title: '伪声明', canonicalStatement: '不能冒充生成记录' })
            });
            assert.equal(response.status, 422);
            assert.equal((await response.json()).error.code, 'KNOWLEDGE_ITEM_AI_SOURCE_RESERVED');
          }
          const edited = await fetch(`${origin}/api/knowledge/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: '正常人工修改', expectedUpdatedAt: item.updatedAt })
          });
          assert.equal(edited.status, 200);
          assert.equal((await edited.json()).data.sourceMode, 'ai');
          migrated.modules.knowledge.knowledgeItemService.trash(item.id);
          const trashed = await fetch(`${origin}/api/knowledge/items/${item.id}/provenance`);
          const inTrash = await trashed.json();
          assert.equal(trashed.status, 200, JSON.stringify(inTrash));
          assert.deepEqual(inTrash.data, projection);
          const manual = migrated.modules.knowledge.knowledgeItemService.createCandidate({
            title: '手工知识',
            canonicalStatement: '无生成来源'
          });
          assert.deepEqual(await migrated.http.knowledge.getKnowledgeProvenance({ id: manual.item.id }), {
            artifactId: manual.item.id,
            state: 'absent',
            record: null,
            sources: []
          });
        });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
];
