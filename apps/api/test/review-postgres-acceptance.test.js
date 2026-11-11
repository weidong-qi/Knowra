import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { createPostgresAppContext } from '../src/postgres-app.factory.js';
import { buildJsonMigrationPlan, applyJsonMigration } from '../src/infrastructure/migration/json-to-postgres.js';

async function fixture(operation) {
  const database = await createPostgresTestDatabase();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-review-pg-'));
  const apps = [];
  const open = async name => {
    const app = await createPostgresAppContext({
      databaseUrl: database.databaseUrl,
      storageRootDir: path.join(root, name),
      uploadsDir: path.join(root, name, 'uploads')
    });
    apps.push(app);
    return app;
  };
  try {
    await operation({ open });
  } finally {
    try {
      for (const app of apps) await app.close();
    } finally {
      try {
        await database.close();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
}

export const reviewPostgresAcceptanceTests = process.env.KNOWRA_SYNC_TEST_DATABASE_URL
  ? [
      {
        name: '真实 PostgreSQL R04：分组迁移、快照往返、外键和替换事务回滚',
        async run() {
          await fixture(async ({ open }) => {
            const app = await open('migration');
            const source = {
              spaces: [{ id: 's', userId: 'demo', name: '合成空间' }],
              folders: [],
              tagGroups: [
                {
                  id: 'g',
                  spaceId: 's',
                  name: '自定义分组',
                  code: null,
                  selectionMode: 'single',
                  isSystem: false,
                  sortOrder: 12,
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-02-01T00:00:00.000Z'
                }
              ],
              tags: [{ id: 't', spaceId: 's', groupId: 'g', name: '合成标签' }],
              notes: [{ id: 'n', spaceId: 's', title: '合成笔记', rawMarkdown: 'text', tagIds: ['t'] }],
              attachments: [],
              contentAnnotations: []
            };
            const prepared = buildJsonMigrationPlan({ input: source });
            assert.equal(prepared.canApply, true);
            await applyJsonMigration({
              client: app.prisma,
              ...prepared,
              requireEmptyTarget: false,
              replaceExisting: true
            });
            const before = await app.http.storage.exportKnowledgeBase();
            const group = before.data.tagGroups.find(item => item.id === 'g');
            assert.equal(group.selectionMode, 'single');
            assert.equal(group.sortOrder, 12);
            assert.equal(group.updatedAt, '2026-02-01T00:00:00.000Z');
            assert.equal(before.data.tagGroups.length, 5);
            await assert.rejects(app.prisma.tagGroup.delete({ where: { id: 'g' } }), { code: 'P2003' });
            await app.http.storage.importKnowledgeBase(before);
            const after = await app.http.storage.exportKnowledgeBase();
            assert.deepEqual(after.data.tagGroups, before.data.tagGroups);
            assert.deepEqual(after.data.tags, before.data.tags);
            await app.prisma.$executeRawUnsafe(
              `CREATE FUNCTION fail_review_tag() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected review tag failure'; END $$`
            );
            await app.prisma.$executeRawUnsafe(
              `CREATE TRIGGER review_tag_failure BEFORE INSERT ON "Tag" FOR EACH ROW EXECUTE FUNCTION fail_review_tag()`
            );
            try {
              await assert.rejects(app.http.storage.importKnowledgeBase(before));
              const rolledBack = await app.http.storage.exportKnowledgeBase();
              assert.deepEqual(rolledBack.data, after.data);
            } finally {
              await app.prisma.$executeRawUnsafe('DROP TRIGGER review_tag_failure ON "Tag"');
              await app.prisma.$executeRawUnsafe('DROP FUNCTION fail_review_tag()');
            }
          });
        }
      },
      {
        name: '真实 PostgreSQL R07–R10：恢复名称、分组竞争、标签查询和初始化回滚',
        async run() {
          await fixture(async ({ open }) => {
            const a = await open('a'),
              b = await open('b');
            const k = a.http.knowledge;
            const space = await k.createDefaultKnowledgeSpace();
            assert.equal((await k.listTagGroups({ spaceId: space.id })).length, 4);
            await b.http.knowledge.createDefaultKnowledgeSpace();
            assert.equal((await k.listTagGroups({ spaceId: space.id })).length, 4);
            const deleted = await k.createNote({ spaceId: space.id, title: '名称冲突', rawMarkdown: 'old' });
            await k.deleteNote({ id: deleted.id });
            await k.createNote({ spaceId: space.id, title: '名称冲突', rawMarkdown: 'new' });
            await assert.rejects(k.restoreNote({ id: deleted.id }), { code: 'SIBLING_NAME_CONFLICT' });
            assert((await a.prisma.note.findUnique({ where: { id: deleted.id } })).deletedAt);
            const groupInput = { id: 'race-group', spaceId: space.id, name: '唯一分组', selectionMode: 'single' };
            const results = await Promise.allSettled([
              k.createTagGroup(groupInput),
              b.http.knowledge.createTagGroup(groupInput)
            ]);
            assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
            assert.equal(results.find(result => result.status === 'rejected').reason.code, 'TAG_GROUP_ID_CONFLICT');
            const group = await a.prisma.tagGroup.findUnique({ where: { id: groupInput.id } });
            assert.equal(group.selectionMode, 'single');
            const tags = [];
            for (const name of ['A', 'B']) tags.push(await k.createTag({ spaceId: space.id, groupId: group.id, name }));
            const both = await k.createNote({
              spaceId: space.id,
              title: '检索双标签',
              rawMarkdown: '',
              tagIds: tags.map(tag => tag.id)
            });
            const only = await k.createNote({
              spaceId: space.id,
              title: '检索单标签',
              rawMarkdown: '',
              tagIds: [tags[0].id]
            });
            for (const [tagMatch, ids] of [
              ['all', [both.id]],
              ['any', [both.id, only.id]]
            ]) {
              const found = await k.searchNotes({
                spaceId: space.id,
                query: '检索',
                tagIds: tags.map(tag => tag.id),
                tagMatch
              });
              assert.deepEqual(found.map(note => note.id).sort(), ids.sort());
            }
            // 真实数据库在第二个系统分组插入时失败：新空间和首组必须一起撤销。
            await a.prisma.$executeRawUnsafe(
              `CREATE FUNCTION fail_review_group() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.code = 'mastery' THEN RAISE EXCEPTION 'injected review group failure'; END IF; RETURN NEW; END $$`
            );
            await a.prisma.$executeRawUnsafe(
              `CREATE TRIGGER review_group_failure BEFORE INSERT ON "TagGroup" FOR EACH ROW EXECUTE FUNCTION fail_review_group()`
            );
            const count = await a.prisma.knowledgeSpace.count();
            try {
              await assert.rejects(k.createKnowledgeSpace({ name: '回滚空间' }));
              assert.equal(await a.prisma.knowledgeSpace.count(), count);
              assert.equal(await a.prisma.tagGroup.count({ where: { space: { name: '回滚空间' } } }), 0);
            } finally {
              await a.prisma.$executeRawUnsafe('DROP TRIGGER review_group_failure ON "TagGroup"');
              await a.prisma.$executeRawUnsafe('DROP FUNCTION fail_review_group()');
            }
          });
        }
      },
      {
        name: '真实 PostgreSQL R18：独立连接的合并和重排等待维护独占锁',
        async run() {
          await fixture(async ({ open }) => {
            const a = await open('writer'),
              b = await open('blocker');
            const space = await a.http.knowledge.createDefaultKnowledgeSpace();
            const tags = [];
            for (const name of ['原标签', '目标标签'])
              tags.push(await a.http.knowledge.createTag({ spaceId: space.id, name }));
            const note = await a.http.knowledge.createNote({
              spaceId: space.id,
              title: '锁竞争笔记',
              rawMarkdown: '',
              tagIds: [tags[0].id]
            });
            for (const operation of [
              () => a.http.knowledge.reorderTags({ tagIds: tags.map(tag => tag.id) }),
              () => a.http.knowledge.mergeTags({ sourceTagId: tags[0].id, targetTagId: tags[1].id })
            ]) {
              let release, acquired;
              const unlocked = new Promise(resolve => {
                release = resolve;
              });
              const locked = new Promise(resolve => {
                acquired = resolve;
              });
              const blocker = b.prisma.$transaction(
                async tx => {
                  await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(1266775634, 32)::text');
                  acquired();
                  await unlocked;
                },
                { timeout: 10000 }
              );
              await locked;
              let settled = false;
              const mutation = operation().finally(() => {
                settled = true;
              });
              try {
                let waiting = false;
                for (let attempt = 0; attempt < 100; attempt++) {
                  const rows = await b.prisma.$queryRawUnsafe(
                    `SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'`
                  );
                  if (rows[0].count > 0) {
                    waiting = true;
                    break;
                  }
                  await delay(20);
                }
                assert(waiting, '服务写操作必须实际在 PostgreSQL 等待 advisory lock');
                assert.equal(settled, false);
              } finally {
                release();
                await blocker;
                await mutation;
              }
            }
            const loaded = await a.modules.knowledge.noteService.getNote(note.id);
            assert.deepEqual(loaded.tagIds, [tags[1].id]);
            assert.equal(await a.prisma.tag.count({ where: { id: tags[0].id } }), 0);
          });
        }
      }
    ]
  : [];
