import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresAppContext } from '../src/postgres-app.factory.ts';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { createAuthorizedKeywordSearch } from '../src/modules/ai/keyword-search.ts';
import { calculateContentHash } from '../src/modules/knowledge/domain/note-version.ts';

async function withDatabase(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-keyword-pg-'));
  const ownerId = `coverage-${randomUUID()}`;
  let database, app;
  try {
    database = await createPostgresTestDatabase();
    app = await createPostgresAppContext({ databaseUrl: database.databaseUrl, ownerId, storageRootDir: root });
    assert(app.ai.access, '正式 PostgreSQL 应用必须装配 R02 access 服务');
    const space = await app.http.knowledge.createDefaultKnowledgeSpace();
    await run({ app, space, ownerId });
  } finally {
    try {
      await app?.close();
    } finally {
      try {
        await database?.close();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
}

async function assertReference(access, grantId, hit) {
  const { note, version, contentHash } = await access.verifyRead({ grantId, noteId: hit.noteId, tool: 'notes_search' });
  assert.equal(hit.title, note.title);
  assert.equal(hit.ref.noteId, note.id);
  assert.equal(hit.ref.noteVersionId, version.id);
  assert.equal(hit.ref.contentHash, contentHash);
  assert.equal(contentHash, calculateContentHash(note.rawMarkdown));
  assert.equal(hit.text, version.content.slice(hit.ref.start, hit.ref.end));
  assert.equal(hit.ref.quoteHash, calculateContentHash(hit.text));
}

export const aiKeywordCoveragePostgresTests =
  process.env.KNOWRA_SYNC_TEST_DATABASE_URL && process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES === '1'
    ? [
        {
          name: '真实 PostgreSQL 关键词覆盖：301 篇后的正文/标题、当前引用、owner 范围与处理上限',
          run: () =>
            withDatabase(async ({ app, space, ownerId }) => {
              const access = app.ai.access,
                notes = app.modules.knowledge.noteService;
              const content = 'pgcommontoken 普通合成正文',
                contentHash = calculateContentHash(content);
              const stamp = new Date('2026-01-01T00:00:00.000Z');
              // 只批量创建本测试 schema 的合成前缀；检索和目标保存走正式应用/repository。
              const filler = Array.from({ length: 300 }, (_, index) => ({
                id: `pg-filler-${String(index).padStart(3, '0')}`,
                spaceId: space.id,
                title: `普通合成笔记 ${index}`,
                rawMarkdown: content,
                plainText: content,
                contentHash,
                favorite: true,
                createdAt: stamp,
                updatedAt: stamp
              }));
              await app.prisma.$transaction(async tx => {
                await tx.note.createMany({ data: filler });
                await tx.noteVersion.createMany({
                  data: filler.map(note => ({
                    id: `version-${note.id}`,
                    noteId: note.id,
                    content,
                    contentHash,
                    createdBy: 'synthetic',
                    createdAt: stamp
                  }))
                });
              });
              const create = input => notes.createNote({ spaceId: space.id, ...input });
              const body = await create({
                id: 'pg-body-target',
                title: '仅正文合成来源',
                rawMarkdown: '😀pgbodytoken pgcommontoken 旧合成正文。'
              });
              const title = await create({
                id: 'pg-title-target',
                title: 'pgtitletoken 合成标题',
                rawMarkdown: 'pgcommontoken 普通标题正文。'
              });
              const excluded = await create({
                id: 'pg-excluded',
                title: '排除来源',
                rawMarkdown: 'pgbodytoken pgtitletoken pgcommontoken',
                favorite: true
              });
              const deleted = await create({
                id: 'pg-deleted',
                title: '删除来源',
                rawMarkdown: 'pgbodytoken pgtitletoken pgcommontoken',
                favorite: true
              });
              await notes.deleteNote(deleted.id);
              const otherSpace = await app.http.knowledge.createKnowledgeSpace({ name: '不同空间合成资料' });
              const foreign = await notes.createNote({
                id: 'pg-foreign',
                spaceId: otherSpace.id,
                title: '跨空间来源',
                rawMarkdown: 'pgbodytoken pgtitletoken pgcommontoken',
                favorite: true
              });
              const listed = await app.repositories.noteRepository.list({ spaceId: space.id });
              assert(listed.findIndex(note => note.id === body.id) >= 300);
              assert(listed.findIndex(note => note.id === title.id) >= 300);
              const conversation = await app.ai.conversationStore.createConversation({
                ownerId,
                actorId: ownerId,
                spaceId: space.id
              });
              const grant = async (scope = { kind: 'library' }, excludedNoteIds = [excluded.id]) => {
                const policy = await access.createPolicy({
                  spaceId: space.id,
                  scope,
                  excludedNoteIds,
                  includeAttachments: false,
                  read: true,
                  egress: false,
                  recipients: [],
                  expiresAt: new Date(Date.now() + 86_400_000).toISOString()
                });
                return {
                  policy,
                  run: await access.createRunGrant({
                    policyId: policy.policyId,
                    conversationId: conversation.conversationId
                  })
                };
              };
              const { policy, run } = await grant();
              const search = createAuthorizedKeywordSearch({ access });
              const input = query => ({ grantId: run.grantId, query });
              const bodyResult = await search.search(input('pgbodytoken'));
              const titleResult = await search.search(input('pgtitletoken'));
              assert.deepEqual(
                bodyResult.hits.map(hit => hit.noteId),
                [body.id]
              );
              assert.deepEqual(
                titleResult.hits.map(hit => hit.noteId),
                [title.id]
              );
              assert.equal(bodyResult.truncated, false);
              assert.equal(titleResult.truncated, false);
              assert.equal(titleResult.hits[0].score, 5);
              await assertReference(access, run.grantId, bodyResult.hits[0]);
              await assertReference(access, run.grantId, titleResult.hits[0]);
              await notes.updateNote(body.id, { rawMarkdown: '😀pgbodytoken pgcommontoken 新合成正文。' });
              const updated = await search.search(input('pgbodytoken'));
              assert.notEqual(updated.hits[0].ref.noteVersionId, bodyResult.hits[0].ref.noteVersionId);
              assert(!updated.hits[0].text.includes('旧合成正文'));
              await assertReference(access, run.grantId, updated.hits[0]);

              const noteLimited = await createAuthorizedKeywordSearch({ access, maxScanNotes: 300 }).search(
                input('pgbodytoken')
              );
              assert.deepEqual(noteLimited.hits, []);
              assert.equal(noteLimited.truncated, true);
              assert.deepEqual(noteLimited.coverage.limitedBy, ['notes']);
              const candidateLimited = await createAuthorizedKeywordSearch({ access, maxCandidates: 1 }).search(
                input('pgcommontoken')
              );
              assert.equal(candidateLimited.inspected, 1);
              assert.equal(candidateLimited.coverage.matchedNotes, 302);
              assert.equal(candidateLimited.truncated, true);
              assert.deepEqual(candidateLimited.coverage.limitedBy, ['candidates']);
              assert.deepEqual(
                candidateLimited.hits.map(hit => hit.noteId),
                [body.id]
              );
              const fixed = await grant({ kind: 'fixed', noteIds: [body.id, title.id] }, []);
              const currentBody = await app.repositories.noteRepository.findById(body.id);
              const totalChars =
                currentBody.title.length +
                currentBody.rawMarkdown.length +
                title.title.length +
                title.rawMarkdown.length;
              const exact = await createAuthorizedKeywordSearch({ access, maxScanChars: totalChars }).search({
                grantId: fixed.run.grantId,
                query: 'pgcommontoken'
              });
              assert.equal(exact.hits.length, 2);
              assert.equal(exact.truncated, false);
              const charLimited = await createAuthorizedKeywordSearch({ access, maxScanChars: totalChars - 1 }).search({
                grantId: fixed.run.grantId,
                query: 'pgcommontoken'
              });
              assert.equal(charLimited.truncated, true);
              assert.deepEqual(charLimited.coverage.limitedBy, ['chars']);
              for (const noteId of [excluded.id, deleted.id, foreign.id]) {
                await assert.rejects(access.verifyRead({ grantId: run.grantId, noteId, tool: 'notes_search' }), {
                  code: 'AI_SCOPE_FORBIDDEN'
                });
              }
              // 初始化后注入不同 owner 的空间，验证运行中的 R02 边界；不创建第二个非法单 owner 宿主。
              const otherOwner = `other-${randomUUID()}`;
              await app.prisma.user.create({ data: { id: otherOwner, status: 'active' } });
              await app.prisma.knowledgeSpace.update({ where: { id: otherSpace.id }, data: { userId: otherOwner } });
              await assert.rejects(
                access.createPolicy({
                  spaceId: otherSpace.id,
                  scope: { kind: 'library' },
                  excludedNoteIds: [],
                  includeAttachments: false,
                  read: true,
                  egress: false,
                  recipients: [],
                  expiresAt: new Date(Date.now() + 86_400_000).toISOString()
                }),
                { code: 'AI_SCOPE_FORBIDDEN' }
              );
              const isolated = await search.search(input('pgbodytoken'));
              assert.deepEqual(
                isolated.hits.map(hit => hit.noteId),
                [body.id]
              );
              await access.narrowPolicy(policy.policyId, { revision: 1, revoke: true });
              await assert.rejects(search.search(input('pgbodytoken')), { code: 'AI_ACCESS_REVOKED' });
            })
        }
      ]
    : [];
