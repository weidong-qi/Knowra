import assert from 'node:assert/strict';
import { assertMinimalProvenanceTransport } from './fixtures/knowledge-artifact-provenance.fixture.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresAppContext } from '../src/postgres-app.factory.js';
import { createPostgresAiRepository } from '../src/modules/ai/postgres-record-repository.ts';
import { validateKnowledgeExtractionCommit } from '../src/modules/ai/knowledge-extraction-commit-contract.js';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { createKnowledgeExtractionJobFixture } from './fixtures/knowledge-extraction-job.fixture.js';

function assertInjectedRepositoryFailure(error, injectionPattern) {
  assert.equal(error.name, 'AppError');
  assert.equal(error.code, 'DATABASE_OPERATION_FAILED');
  assert.equal(error.statusCode, 500);
  assert.equal(error.message, 'PostgreSQL operation failed');
  assert.match(error.cause?.message ?? '', injectionPattern);
  return true;
}

async function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-extraction-pg-'));
  const apps = [];
  let database;
  try {
    database = await createPostgresTestDatabase();
    const ownerId = `extraction-${randomUUID()}`;
    const start = async () => {
      const app = await createPostgresAppContext({
        databaseUrl: database.databaseUrl,
        ownerId,
        storageRootDir: root,
        uploadsDir: path.join(root, 'uploads')
      });
      apps.push(app);
      return app;
    };
    const app = await start(),
      ai = createPostgresAiRepository({ client: app.prisma, ownerId });
    await run({ app, ai, start, ownerId, ...(await createKnowledgeExtractionJobFixture(app, ai, ownerId)) });
  } finally {
    try {
      for (const app of apps.reverse()) {
        try {
          await app.ai?.agent?.close?.();
          await app.ai?.worker?.close?.();
        } finally {
          await app.close();
        }
      }
    } finally {
      try {
        await database?.close();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
}

export const aiKnowledgeExtractionCommitPostgresTests = process.env.KNOWRA_SYNC_TEST_DATABASE_URL
  ? [
      {
        name: 'P3 PostgreSQL 提炼：两实例同结果竞争、断响应重启复用，业务/任务/provenance/outbox 同一提交',
        async run() {
          await withFixture(async f => {
            const other = await f.start();
            const receipts = await Promise.all(
              [f.app, other].map(app => app.knowledgeExtractionCommit.commit(f.input))
            );
            assert.deepEqual(receipts[0], receipts[1]);
            assert.equal(await f.app.prisma.knowledgeItem.count(), 1);
            assert.equal(await f.app.prisma.knowledgeEvidence.count(), 1);
            assert.equal(await f.app.prisma.knowledgeArtifactProvenance.count(), 1);
            const [{ count }] = await f.app.prisma.$queryRawUnsafe(
              'SELECT count(*)::int AS count FROM knowledge_extraction_commits'
            );
            assert.equal(count, 1);
            assert.equal((await f.ai.get('aiJob', f.input.jobId)).status, 'succeeded');
            assert.equal((await f.ai.get('aiJobAttempt', f.input.attemptId)).status, 'validated');
            const receipt = receipts[0],
              item = await f.app.repositories.knowledgeItemRepository.findById(receipt.candidates[0].candidateInput.id);
            const [stored] = await f.app.prisma.$queryRawUnsafe(
              'SELECT receipt_json FROM knowledge_extraction_commits'
            );
            assert.equal(typeof stored.receipt_json, 'string');
            assert.equal(stored.receipt_json, JSON.stringify(receipt));
            assert.deepEqual(validateKnowledgeExtractionCommit(JSON.parse(stored.receipt_json)), receipt);
            assert.equal(item.reviewStatus, 'candidate');
            await f.app.http.knowledge.updateKnowledgeItem(
              { id: item.id },
              { title: '用户合成修订', expectedUpdatedAt: item.updatedAt }
            );
            const restarted = await f.start();
            assert.deepEqual(await restarted.knowledgeExtractionCommit.commit(f.input), receipt);
            assert.equal(
              (await restarted.repositories.knowledgeItemRepository.findById(item.id)).title,
              '用户合成修订'
            );
            const journal = await f.app.prisma.syncJournal.findUnique({ where: { ownerId: f.ownerId } });
            assert(JSON.stringify(journal.payload).includes(item.id));
            const provenance = await f.app.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(item.id);
            assert.equal(provenance.origin.receiptHash, receipt.receiptHash);
            assert.equal(provenance.provider, 'mock');
            assertMinimalProvenanceTransport(journal.payload, provenance);
            const projection = await f.app.http.knowledge.getKnowledgeProvenance({ id: item.id });
            assert.equal(projection.state, 'recorded');
            assert.deepEqual(projection.record, provenance);
            assert.equal(projection.sources[0].resolvedVersionId, provenance.sources[0].originNoteVersionId);
            const changed = structuredClone(f.output);
            changed.candidates[0].title = '另一模拟结果';
            await assert.rejects(
              f.app.knowledgeExtractionCommit.commit({ ...f.input, result: await f.respond(changed) }),
              { code: 'KNOWLEDGE_EXTRACTION_OUTPUT_CONFLICT' }
            );
          });
        }
      },
      {
        name: 'P3 PostgreSQL 提炼：两实例不同结果竞争只采纳首份正文，绝不混合两批候选或来源',
        async run() {
          await withFixture(async f => {
            const other = await f.start(),
              changed = structuredClone(f.output);
            changed.candidates[0].title = '第二个完整结果';
            const outcomes = await Promise.allSettled([
              f.app.knowledgeExtractionCommit.commit(f.input),
              other.knowledgeExtractionCommit.commit({ ...f.input, result: await f.respond(changed) })
            ]);
            assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
            const failure = outcomes.find(value => value.status === 'rejected');
            assert.equal(failure.reason.code, 'KNOWLEDGE_EXTRACTION_OUTPUT_CONFLICT');
            const accepted = outcomes.find(value => value.status === 'fulfilled').value;
            const item = await f.app.repositories.knowledgeItemRepository.findById(
              accepted.candidates[0].candidateInput.id
            );
            assert.equal(item.title, accepted.result.candidates[0].title);
            assert.equal(await f.app.prisma.knowledgeItem.count(), 1);
            assert.equal(await f.app.prisma.knowledgeEvidence.count(), 1);
          });
        }
      },
      {
        name: 'P3 PostgreSQL 提炼：提交记录及最后任务更新 SQL 故障都回滚所有业务和同步记录',
        async run() {
          for (const table of ['"KnowledgeArtifactProvenance"', 'knowledge_extraction_commits', 'ai_jobs'])
            await withFixture(async f => {
              const before = await f.app.prisma.syncJournal.findUnique({ where: { ownerId: f.ownerId } });
              await f.app.prisma
                .$executeRawUnsafe(`CREATE FUNCTION fail_extraction_commit() RETURNS trigger LANGUAGE plpgsql AS
        'BEGIN RAISE EXCEPTION ''injected extraction sql failure''; END;'`);
              await f.app.prisma
                .$executeRawUnsafe(`CREATE TRIGGER fail_extraction_commit BEFORE ${table === 'ai_jobs' ? 'UPDATE' : 'INSERT'} ON ${table}
        FOR EACH ROW EXECUTE FUNCTION fail_extraction_commit()`);
              try {
                await assert.rejects(
                  f.app.knowledgeExtractionCommit.commit(f.input),
                  table === '"KnowledgeArtifactProvenance"'
                    ? error => assertInjectedRepositoryFailure(error, /injected extraction sql failure/)
                    : /injected extraction sql failure/
                );
              } finally {
                await f.app.prisma.$executeRawUnsafe(`DROP TRIGGER fail_extraction_commit ON ${table}`);
              }
              assert.equal(await f.app.prisma.knowledgeItem.count(), 0);
              assert.equal(await f.app.prisma.knowledgeEvidence.count(), 0);
              assert.equal(await f.app.prisma.knowledgeArtifactProvenance.count(), 0);
              assert.equal((await f.ai.get('aiJob', f.input.jobId)).status, 'running');
              assert.equal((await f.ai.get('aiJobAttempt', f.input.attemptId)).status, 'sent');
              const [{ count }] = await f.app.prisma.$queryRawUnsafe(
                'SELECT count(*)::int AS count FROM knowledge_extraction_commits'
              );
              assert.equal(count, 0);
              assert.deepEqual(await f.app.prisma.syncJournal.findUnique({ where: { ownerId: f.ownerId } }), before);
              const accepted = await f.app.knowledgeExtractionCommit.commit(f.input);
              assert.equal(accepted.candidates.length, 1);
            });
        }
      },
      {
        name: '05B PostgreSQL核心来源读取与purge原子回滚；摘要清理留墓碑，历史receipt重试不复活',
        async run() {
          await withFixture(async f => {
            const receipt = await f.app.knowledgeExtractionCommit.commit(f.input),
              id = receipt.candidates[0].candidateInput.id;
            const provenance = (await f.app.http.knowledge.getKnowledgeProvenance({ id })).record;
            const item = await f.app.repositories.knowledgeItemRepository.findById(id);
            const trashed = await f.app.http.knowledge.trashKnowledgeItem(
              { id },
              { expectedUpdatedAt: item.updatedAt }
            );
            const trashedProjection = await f.app.http.knowledge.getKnowledgeProvenance({ id });
            assert.equal(trashedProjection.state, 'recorded');
            assert.deepEqual(trashedProjection.record, provenance);
            assert.equal(trashedProjection.sources.length, provenance.sources.length);
            assert(trashedProjection.sources.every(source => source.sourceState === 'unavailable'));
            const preflight = await f.app.http.knowledge.inspectKnowledgePurge({ id });
            assert.deepEqual(preflight.exclusiveRecords.knowledgeArtifactProvenanceIds, [provenance.id]);
            const before = await f.app.prisma.syncJournal.findUnique({ where: { ownerId: f.ownerId } });
            await f.app.prisma
              .$executeRawUnsafe(`CREATE FUNCTION fail_provenance_purge() RETURNS trigger LANGUAGE plpgsql AS
        'BEGIN RAISE EXCEPTION ''injected provenance purge''; END;'`);
            await f.app.prisma.$executeRawUnsafe(
              'CREATE TRIGGER fail_provenance_purge BEFORE DELETE ON "KnowledgeEvidence" FOR EACH ROW EXECUTE FUNCTION fail_provenance_purge()'
            );
            try {
              await assert.rejects(
                f.app.http.knowledge.permanentlyDeleteKnowledgeItem({ id }, { expectedUpdatedAt: trashed.updatedAt }),
                error => assertInjectedRepositoryFailure(error, /injected provenance purge/)
              );
            } finally {
              await f.app.prisma.$executeRawUnsafe('DROP TRIGGER fail_provenance_purge ON "KnowledgeEvidence"');
            }
            assert.deepEqual(
              await f.app.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(id),
              provenance
            );
            assert.equal(await f.app.prisma.knowledgeEvidence.count(), 1);
            assert.equal(await f.app.prisma.knowledgeItem.count(), 1);
            assert.deepEqual(await f.app.prisma.syncJournal.findUnique({ where: { ownerId: f.ownerId } }), before);
            const purged = await f.app.http.knowledge.permanentlyDeleteKnowledgeItem(
              { id },
              { expectedUpdatedAt: trashed.updatedAt }
            );
            assert.equal(purged.exclusiveRecordsDeleted.knowledgeArtifactProvenance, 1);
            assert.equal(purged.exclusiveRecordsDeleted.knowledgeEvidence, 1);
            assert.equal(await f.app.prisma.knowledgeArtifactProvenance.count(), 0);
            const journal = await f.app.prisma.syncJournal.findUnique({ where: { ownerId: f.ownerId } });
            assert(journal.payload.tombstones[JSON.stringify(['knowledgeArtifactProvenance', provenance.id])]);
            const reopened = await f.start();
            assert.deepEqual(await reopened.knowledgeExtractionCommit.commit(f.input), receipt);
            assert.equal(await reopened.prisma.knowledgeItem.count(), 0);
            assert.equal(await reopened.prisma.knowledgeArtifactProvenance.count(), 0);
            const [row] = await reopened.prisma.$queryRawUnsafe(
              'SELECT receipt_json FROM knowledge_extraction_commits'
            );
            assert.equal(row.receipt_json, JSON.stringify(receipt));
            await assert.rejects(reopened.http.knowledge.getKnowledgeProvenance({ id }), {
              code: 'KNOWLEDGE_ITEM_NOT_FOUND'
            });
          });
        }
      },
      {
        name: '05B PostgreSQL旧receipt回填保留当前编辑及原receipt TEXT，重启幂等',
        async run() {
          await withFixture(async f => {
            const receipt = await f.app.knowledgeExtractionCommit.commit(f.input);
            const id = receipt.candidates[0].candidateInput.id;
            const provenance = await f.app.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(id);
            const item = await f.app.repositories.knowledgeItemRepository.findById(id);
            await f.app.http.knowledge.updateKnowledgeItem(
              { id },
              { title: '旧库中的用户编辑', expectedUpdatedAt: item.updatedAt }
            );
            // 合成升级前形状；raw SQL 仅用于此隔离库 fixture，不制造业务 purge tombstone。
            await f.app.prisma.$executeRawUnsafe('DELETE FROM "KnowledgeArtifactProvenance"');
            await f.app.prisma.$executeRawUnsafe('DELETE FROM knowledge_artifact_provenance_migrations');
            const reopened = await f.start();
            assert.deepEqual(
              await reopened.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(id),
              provenance
            );
            assert.equal((await reopened.repositories.knowledgeItemRepository.findById(id)).title, '旧库中的用户编辑');
            const [row] = await reopened.prisma.$queryRawUnsafe(
              'SELECT receipt_json FROM knowledge_extraction_commits'
            );
            assert.equal(row.receipt_json, JSON.stringify(receipt));
            assert.deepEqual(
              await (await f.start()).repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(id),
              provenance
            );
          });
        }
      },
      {
        name: 'P3 PostgreSQL 提炼：核心源删除/旧 epoch 拒绝，嵌套接纳不绕过事务边界',
        async run() {
          await withFixture(async f => {
            let ran = false;
            await f.app.prisma.$transaction(async () => {
              await assert.rejects(async () => {
                await f.app.knowledgeExtractionCommit.commit(f.input);
                ran = true;
              }, /最外层/);
            });
            assert.equal(ran, false);
            assert.equal(await f.app.prisma.knowledgeItem.count(), 0);
            await f.app.http.knowledge.deleteNote({ id: f.note.id });
            await assert.rejects(f.app.knowledgeExtractionCommit.commit(f.input), {
              code: 'KNOWLEDGE_EXTRACTION_SOURCE_UNAVAILABLE'
            });
            assert.equal(await f.app.prisma.knowledgeItem.count(), 0);
            await f.ai.rotateEpoch();
            await assert.rejects(f.app.knowledgeExtractionCommit.commit(f.input), {
              code: 'KNOWLEDGE_EXTRACTION_JOB_INVALID'
            });
          });
        }
      }
    ]
  : [];
