import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppContext } from '../src/app.factory.js';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';
import { hashRecord } from '../src/modules/ai/record-contract.ts';
import { validateKnowledgeExtractionCommit } from '../src/modules/ai/knowledge-extraction-commit-contract.ts';
import { createKnowledgeExtractionCommitService } from '../src/modules/ai/knowledge-extraction-commit.ts';
import { createKnowledgeExtractionJobFixture } from './fixtures/knowledge-extraction-job.fixture.js';
import { assertMinimalProvenanceTransport } from './fixtures/knowledge-artifact-provenance.fixture.js';

async function withFixture(run, options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-extraction-commit-'));
  const file = path.join(root, 'data.json');
  const open = () =>
    createAppContext({
      dataStore: createFileDataStore(file, options),
      ownerId: 'demo',
      storageRootDir: root,
      uploadsDir: path.join(root, 'uploads')
    });
  try {
    const app = open();
    await run({ app, file, open, ...(await createKnowledgeExtractionJobFixture(app)) });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const empty = fixture => {
  assert.equal(fixture.knowledge.knowledgeItemService.listItems().length, 0);
  assert.equal(fixture.knowledge.repositories.knowledgeEvidenceRepository.list().length, 0);
  assert.equal(fixture.knowledge.repositories.knowledgeArtifactProvenanceRepository.list().length, 0);
  assert.equal(fixture.app.dataStore.knowledgeExtractionCommitStore.get(fixture.records.job), null);
  assert.equal(fixture.ai.get('aiJob', fixture.input.jobId).status, 'running');
};

export const aiKnowledgeExtractionCommitTests = [
  {
    name: '提炼迟到结果在来源切私密后拒绝接纳，不生成候选',
    async run() {
      await withFixture(async f => {
        const repo = f.knowledge.repositories.noteRepository;
        repo.save({ ...repo.findById(f.note.id), aiVisibility: 'private' });
        assert.throws(() => f.app.knowledgeExtractionCommit.commit(f.input), {
          code: 'KNOWLEDGE_EXTRACTION_SOURCE_UNAVAILABLE'
        });
        empty(f);
      });
    }
  },
  {
    name: 'P3 JSON 提炼：Mock 结果、任务、候选、证据和 provenance 原子提交并可重启读取',
    async run() {
      await withFixture(async f => {
        const receipt = f.app.knowledgeExtractionCommit.commit(f.input);
        assert.deepEqual(validateKnowledgeExtractionCommit(receipt), receipt);
        const item = f.knowledge.knowledgeItemService.getItem(receipt.candidates[0].candidateInput.id);
        assert.equal(item.reviewStatus, 'candidate');
        assert.equal(item.sourceMode, 'ai');
        const evidence = f.knowledge.knowledgeItemService.listEvidence(item.id)[0];
        const source = receipt.candidates[0].provenance[0];
        const version = f.knowledge.noteVersionService.getVersion(source.noteVersionId);
        assert.equal(version.content.slice(source.start, source.end), source.quoteText);
        assert.equal(evidence.noteVersionId, source.noteVersionId);
        assert.equal(f.knowledge.knowledgeItemService.listItems({ reviewStatus: 'confirmed' }).length, 0);
        const restarted = f.open();
        assert.deepEqual(restarted.knowledgeExtractionCommit.commit(f.input), receipt);
        assert.equal(restarted.dataStore.aiRepository.get('aiJob', f.input.jobId).status, 'succeeded');
        assert.equal(restarted.dataStore.aiRepository.get('aiJob', f.input.jobId).resultJson, undefined);
        assert.equal(restarted.dataStore.aiRepository.get('aiJobAttempt', f.input.attemptId).status, 'validated');
        const journal = restarted.dataStore.getSyncJournal();
        assert(JSON.stringify(journal).includes(item.id));
        const provenance =
          restarted.modules.knowledge.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(item.id);
        assert.equal(provenance.provider, 'mock');
        assert.equal(f.records.job.provider, 'deepseek');
        assert.equal(provenance.origin.receiptHash, receipt.receiptHash);
        assert.equal(provenance.outputHash, receipt.outputHash);
        assertMinimalProvenanceTransport(journal, provenance);
        assertMinimalProvenanceTransport(restarted.dataStore.exportSnapshot(), provenance);
        assert.equal(JSON.stringify(receipt.request.sources).includes(f.excluded), false);
      });
    }
  },
  {
    name: 'P3 JSON 提炼：修改返回或读取的回执不污染内部记录，普通编辑和重试仍可完成',
    async run() {
      await withFixture(async f => {
        const returned = f.app.knowledgeExtractionCommit.commit(f.input);
        const expected = structuredClone(returned);
        returned.result.candidates[0].title = '调用方修改结果';
        returned.request.sources[0].markdown = '调用方修改请求';
        returned.candidates[0].candidateInput.title = '调用方修改计划';
        const read = f.app.dataStore.knowledgeExtractionCommitStore.get(f.records.job);
        assert.deepEqual(read, expected);
        read.result.candidates[0].title = '调用方修改读取回执';
        read.candidates[0].provenance[0].quoteText = '调用方修改来源';
        f.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: '修改回执后的正常合成编辑' });
        assert.deepEqual(f.app.knowledgeExtractionCommit.commit(f.input), expected);
        assert.deepEqual(JSON.parse(fs.readFileSync(f.file, 'utf8')).knowledgeExtractionCommits.receipts[0], expected);
        const restarted = f.open();
        assert.deepEqual(restarted.knowledgeExtractionCommit.commit(f.input), expected);
        assert.equal(
          restarted.modules.knowledge.noteService.getNote(f.note.id).rawMarkdown,
          '修改回执后的正常合成编辑'
        );
      });
    }
  },
  {
    name: 'P3 JSON 提炼：同任务异输出冲突；相同输出重试保留用户修订、删除状态和首份 provenance',
    async run() {
      await withFixture(async f => {
        const receipt = f.app.knowledgeExtractionCommit.commit(f.input);
        const originalProvenance = f.knowledge.repositories.knowledgeArtifactProvenanceRepository.list();
        const item = f.knowledge.knowledgeItemService.getItem(receipt.candidates[0].candidateInput.id);
        f.knowledge.knowledgeItemService.updateItem(item.id, {
          title: '用户自己的标题',
          expectedUpdatedAt: item.updatedAt
        });
        assert.deepEqual(f.app.knowledgeExtractionCommit.commit(f.input), receipt);
        assert.equal(f.knowledge.knowledgeItemService.getItem(item.id).title, '用户自己的标题');
        assert.deepEqual(f.knowledge.repositories.knowledgeArtifactProvenanceRepository.list(), originalProvenance);
        const other = structuredClone(f.output);
        other.candidates[0].title = '重新生成的标题';
        assert.throws(
          () =>
            f.app.knowledgeExtractionCommit.commit({
              ...f.input,
              result: { ...f.input.result, content: JSON.stringify(other) }
            }),
          { code: 'KNOWLEDGE_EXTRACTION_OUTPUT_CONFLICT' }
        );
        const current = f.knowledge.knowledgeItemService.getItem(item.id);
        f.knowledge.knowledgeItemService.trash(item.id, { expectedUpdatedAt: current.updatedAt });
        assert.deepEqual(f.app.knowledgeExtractionCommit.commit(f.input), receipt);
        assert(f.knowledge.repositories.knowledgeItemRepository.findById(item.id).deletedAt);
      });
    }
  },
  {
    name: 'P3 JSON 提炼：第二候选失败及最终磁盘写入失败都回滚任务、来源、候选和提交记录',
    async run() {
      await withFixture(async f => {
        const output = structuredClone(f.output);
        output.candidates.push({ ...structuredClone(output.candidates[0]), title: '第二候选' });
        const result = await f.respond(output);
        const original = f.knowledge.knowledgeItemService.createCandidate;
        let calls = 0;
        f.knowledge.knowledgeItemService.createCandidate = value => {
          if (++calls === 2) throw new Error('injected second candidate');
          return original(value);
        };
        const before = fs.readFileSync(f.file, 'utf8');
        assert.throws(
          () => f.app.knowledgeExtractionCommit.commit({ ...f.input, result }),
          /injected second candidate/
        );
        empty(f);
        assert.equal(fs.readFileSync(f.file, 'utf8'), before);
      });
      let failWrite = false;
      await withFixture(
        async f => {
          const before = fs.readFileSync(f.file, 'utf8');
          failWrite = true;
          assert.throws(() => f.app.knowledgeExtractionCommit.commit(f.input), { code: 'STORAGE_WRITE_FAILED' });
          empty(f);
          assert.equal(fs.readFileSync(f.file, 'utf8'), before);
          failWrite = false;
          assert.equal(f.app.knowledgeExtractionCommit.commit(f.input).candidates.length, 1);
        },
        {
          writeJson(file, value) {
            if (failWrite) throw new Error('injected final write');
            fs.writeFileSync(file, JSON.stringify(value));
          }
        }
      );
    }
  },
  {
    name: 'P3 JSON 提炼：取消、过期、旧 lease、撤权、授权数上限与资料集恢复阻断迟到结果',
    async run() {
      for (const change of ['cancelled', 'expired', 'generation', 'revoked', 'targets', 'permission', 'epoch']) {
        await withFixture(async f => {
          if (change === 'cancelled') {
            const job = f.ai.get('aiJob', f.input.jobId);
            f.ai.replace(
              'aiJob',
              { ...job, status: 'cancelling', updatedAt: '2026-09-26T00:00:02.000Z' },
              hashRecord(job)
            );
          }
          if (change === 'expired')
            f.ai.replace(
              'aiJobAttempt',
              { ...f.records.attempt, leaseExpiresAt: '2026-09-26T01:00:00.000Z' },
              hashRecord(f.records.attempt)
            );
          if (change === 'generation')
            f.ai.insert('aiJobAttempt', {
              ...f.records.attempt,
              attemptId: 'new-generation',
              ordinal: 2,
              leaseGeneration: 2
            });
          if (change === 'revoked')
            f.ai.replace(
              'aiGrant',
              { ...f.records.grant, revokedAt: '2026-10-01T00:00:00.000Z' },
              hashRecord(f.records.grant)
            );
          if (change === 'targets' || change === 'permission') {
            // 合成磁盘 fixture 修改不可变授权，再按真实加载路径打开；应用没有这种编辑入口。
            const data = JSON.parse(fs.readFileSync(f.file, 'utf8'));
            if (change === 'targets') data.aiRuntime.grants[0].maxTargets = 0;
            else data.aiRuntime.grants[0].actionKinds = ['read'];
            fs.writeFileSync(f.file, JSON.stringify(data));
            f.app = f.open();
          }
          if (change === 'epoch') f.app.dataStore.importSnapshot(f.app.dataStore.exportSnapshot());
          assert.throws(() => f.app.knowledgeExtractionCommit.commit(f.input));
          assert.equal(f.app.dataStore.state.knowledgeItems.length, 0);
          assert.equal(f.app.dataStore.knowledgeExtractionCommitStore.get(f.records.job), null);
        });
      }
    }
  },
  {
    name: 'P3 JSON 提炼：来源软删除、跨空间、快照删除和 owner 不匹配整体拒绝',
    async run() {
      for (const change of ['deleted', 'space', 'scope', 'owner'])
        await withFixture(async f => {
          if (change === 'deleted') f.knowledge.noteService.deleteNote(f.note.id);
          if (change === 'space') {
            const space = f.knowledge.knowledgeSpaceService.createKnowledgeSpace({
              userId: 'demo',
              name: '另一合成空间'
            });
            f.knowledge.repositories.noteRepository.save({ ...f.note, spaceId: space.id });
          }
          if (change === 'scope')
            f.knowledge.repositories.analysisScopeRepository.save({ ...f.scope, deletedAt: new Date().toISOString() });
          if (change === 'owner') {
            const data = JSON.parse(fs.readFileSync(f.file, 'utf8'));
            data.spaces[0].userId = 'other';
            fs.writeFileSync(f.file, JSON.stringify(data));
            assert.throws(() => f.open());
            return;
          }
          assert.throws(() => f.app.knowledgeExtractionCommit.commit(f.input));
          empty(f);
        });
    }
  },
  {
    name: 'P3 JSON 提炼：当前正文变化仍引用旧版本并标记 stale；空结果完成但不创造正式资产',
    async run() {
      await withFixture(async f => {
        f.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: '已变化的合成正文' });
        const receipt = f.app.knowledgeExtractionCommit.commit(f.input);
        const evidence = f.knowledge.knowledgeItemService.listEvidence(receipt.candidates[0].candidateInput.id)[0];
        assert.equal(evidence.status, 'stale');
        assert.equal(evidence.quoteText, f.output.candidates[0].citations[0].quote);
        assert.equal(evidence.noteVersionId, f.request.sources[0].noteVersionId);
      });
      await withFixture(async f => {
        const result = await f.respond({ ...f.output, candidates: [] });
        const receipt = f.app.knowledgeExtractionCommit.commit({ ...f.input, result });
        assert.deepEqual(receipt.candidates, []);
        assert.equal(f.app.dataStore.state.knowledgeItems.length, 0);
        assert.deepEqual(f.app.dataStore.state.knowledgeArtifactProvenance, []);
        assert.equal(f.ai.get('aiJob', f.input.jobId).status, 'succeeded');
      });
    }
  },
  {
    name: 'P3 JSON 提炼：错误引文/输入绑定、真实 provider、未知字段和嵌套提交不能部分写库',
    async run() {
      await withFixture(async f => {
        const forged = structuredClone(f.output);
        forged.candidates[0].citations[0].quote = '伪造引文';
        for (const input of [
          { ...f.input, result: { ...f.input.result, content: JSON.stringify(forged) } },
          { ...f.input, scopeId: 'missing' },
          { ...f.input, result: { ...f.input.result, provider: 'deepseek' } },
          { ...f.input, ownerId: 'other' }
        ]) {
          assert.throws(() => f.app.knowledgeExtractionCommit.commit(input));
          empty(f);
        }
        assert.throws(
          () => f.app.dataStore.runTransaction(() => f.app.knowledgeExtractionCommit.commit(f.input)),
          /最外层/
        );
        empty(f);
        const data = JSON.parse(fs.readFileSync(f.file, 'utf8'));
        data.aiRuntime.jobs[0].inputHash = '0'.repeat(64);
        fs.writeFileSync(f.file, JSON.stringify(data));
        assert.throws(() => f.open().knowledgeExtractionCommit.commit(f.input), {
          code: 'KNOWLEDGE_EXTRACTION_INPUT_CONFLICT'
        });
      });
    }
  },
  {
    name: 'P3 JSON 提炼：未知/损坏提交记录保留原文，关闭接纳入口，核心笔记仍可编辑',
    async run() {
      await withFixture(async f => {
        f.app.knowledgeExtractionCommit.commit(f.input);
        const data = JSON.parse(fs.readFileSync(f.file, 'utf8'));
        data.knowledgeExtractionCommits.receipts[0].receiptHash = 'broken';
        fs.writeFileSync(f.file, JSON.stringify(data));
        const broken = f.open();
        assert.equal(broken.knowledgeExtractionCommit, null);
        assert(broken.dataStore.knowledgeExtractionCommitStoreError);
        broken.modules.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: '损坏记录旁的正常合成编辑' });
        assert.equal(
          JSON.parse(fs.readFileSync(f.file, 'utf8')).knowledgeExtractionCommits.receipts[0].receiptHash,
          'broken'
        );
      });
    }
  },
  {
    name: 'P3 JSON 提炼：事务中候选或记录已经写入后到期仍整批回滚，21 个结果不能越过创建授权',
    async run() {
      for (const expiration of [1, 2])
        await withFixture(async f => {
          let ticks = 0;
          const service = createKnowledgeExtractionCommitService({
            store: f.app.dataStore.knowledgeExtractionCommitStore,
            ownerId: 'demo',
            createContext: () => ({
              aiRepository: f.ai,
              repositories: f.knowledge.repositories,
              knowledgeItemService: f.knowledge.knowledgeItemService
            }),
            clock: () => new Date(ticks++ >= expiration ? '2031-01-01T00:00:00.000Z' : '2026-10-02T00:00:00.000Z')
          });
          assert.throws(() => service.commit(f.input), { code: 'KNOWLEDGE_EXTRACTION_ATTEMPT_STALE' });
          empty(f);
          assert.equal(f.ai.get('aiJobAttempt', f.input.attemptId).status, 'sent');
        });
      await withFixture(async f => {
        const many = {
          ...f.output,
          candidates: Array.from({ length: 21 }, (_, i) => ({
            ...structuredClone(f.output.candidates[0]),
            title: `合成候选 ${i}`
          }))
        };
        assert.throws(
          () =>
            f.app.knowledgeExtractionCommit.commit({
              ...f.input,
              result: { ...f.input.result, content: JSON.stringify(many) }
            }),
          { code: 'KNOWLEDGE_EXTRACTION_TARGET_LIMIT' }
        );
        empty(f);
      });
    }
  }
];
