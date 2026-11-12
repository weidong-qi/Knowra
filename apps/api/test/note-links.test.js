import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNoteLinkUrl } from '@study-accelerator/content-anchor';
import { createPersistentAppContext } from '../src/app.factory.ts';
import { withCommandServer } from './command-search-http.test.js';
import { createPostgresAppContext } from '../src/postgres-app.factory.ts';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { createKnowledgeHttpHandlers } from '../src/modules/knowledge/http/knowledge-handlers.ts';

async function acceptance(app) {
  const k = app.http.knowledge;
  const space = await k.createDefaultKnowledgeSpace();
  const other = await k.createKnowledgeSpace({ name: '链接其他空间' });
  const target = await k.createNote({
    id: 'link-target',
    spaceId: space.id,
    title: '合成目标',
    rawMarkdown: '目标正文隐私边界',
    aiVisibility: 'private'
  });
  const folder = await k.createFolder({ spaceId: space.id, name: '链接目标目录' });
  const foreign = await k.createNote({
    id: 'link-foreign',
    spaceId: other.id,
    title: '跨空间目标',
    rawMarkdown: '范围外'
  });
  const first = createNoteLinkUrl(target.id, 'ref-first');
  const second = createNoteLinkUrl(target.id, 'ref-second');
  const raw = `首段 [原显示名字](${first}) 的上下文。\n\n另段 [原显示名字](${second}) 第二处。`;
  const source = await k.createNote({ id: 'link-source', spaceId: space.id, title: '合成来源', rawMarkdown: raw });
  await withCommandServer(app, async base => {
    const request = async id => {
      const r = await fetch(`${base}/api/knowledge/notes/${id}/link-relations`);
      assert.equal(r.status, 200);
      return (await r.json()).data;
    };
    let incoming = await request(target.id);
    assert.equal(incoming.backlinks.length, 1);
    assert.equal(incoming.backlinks[0].occurrences.length, 2);
    assert.match(incoming.backlinks[0].occurrences[1].context, /第二处/);
    assert.ok(!JSON.stringify(incoming).includes('目标正文隐私边界'));
    await k.updateNote({ id: target.id }, { title: '目标改名', folderId: folder.id });
    let outgoing = await request(source.id);
    assert.equal(outgoing.outgoing[0].title, '目标改名');
    assert.equal(outgoing.outgoing[0].folderId, folder.id);
    assert.equal(outgoing.outgoing[0].occurrences[0].label, '原显示名字');
    await k.deleteNote({ id: target.id });
    assert.equal((await request(source.id)).outgoing[0].status, 'deleted');
    await k.restoreNote({ id: target.id });
    assert.equal((await request(source.id)).outgoing[0].status, 'active');
    await k.updateNote({ id: source.id }, { rawMarkdown: `新增前文\n\n[修改文字](${second})` });
    incoming = await request(target.id);
    assert.equal(incoming.backlinks[0].occurrences.length, 1);
    assert.equal(incoming.backlinks[0].occurrences[0].label, '修改文字');
    assert.ok(incoming.backlinks[0].occurrences[0].sourceStart > 0);
    await k.updateNote({ id: source.id }, { rawMarkdown: '移除后普通正文' });
    assert.equal((await request(target.id)).backlinks.length, 0);
    await k.updateNote({ id: source.id }, { rawMarkdown: raw });
    assert.equal((await request(target.id)).backlinks[0].occurrences.length, 2);
    await k.deleteNote({ id: source.id });
    assert.equal((await request(target.id)).backlinks.length, 0);
    await k.restoreNote({ id: source.id });
    assert.equal((await request(target.id)).backlinks[0].occurrences.length, 2);
    await assert.rejects(
      async () =>
        k.updateNote({ id: source.id }, { rawMarkdown: `[越界](${createNoteLinkUrl(foreign.id, 'ref-cross')})` }),
      { code: 'NOTE_LINK_TARGET_INVALID' }
    );
    await assert.rejects(
      async () =>
        k.updateNote(
          { id: source.id },
          { rawMarkdown: `[越界][ref]\n\n[ref]: ${createNoteLinkUrl(foreign.id, 'ref-cross')}\n[ref]: ${first}` }
        ),
      { code: 'NOTE_LINK_TARGET_INVALID' }
    );
    await k.deleteNote({ id: target.id });
    await k.permanentlyDeleteNote({ id: target.id });
    assert.equal((await request(source.id)).outgoing[0].status, 'deleted');
    await k.updateNote({ id: source.id }, { rawMarkdown: '版本移除链接' });
    await k.updateNote({ id: source.id }, { rawMarkdown: raw });
    assert.equal((await request(source.id)).outgoing[0].status, 'deleted');
    return source;
  });
}

export const noteLinkTests = [
  {
    name: 'JSON HTTP：逐处反链、目标稳定身份、编辑删除恢复及当前空间约束',
    async run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-note-links-'));
      let app;
      try {
        app = createPersistentAppContext({ storageRootDir: root, ownerId: 'links-owner' });
        await acceptance(app);
        await app.close?.();
        app = createPersistentAppContext({ storageRootDir: root, ownerId: 'links-owner' });
        const relations = await app.http.knowledge.getNoteLinkRelations({ id: 'link-source' });
        assert.equal(relations.outgoing[0].status, 'deleted');
        assert.equal(relations.outgoing[0].occurrences.length, 2);
      } finally {
        await app?.close?.();
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: '关系读取先验证真实空间owner，客户端无法借链接穿越owner',
    run() {
      let readRelations = false;
      const handlers = createKnowledgeHttpHandlers({
        ownerId: 'current',
        knowledgeModule: {
          repositories: { knowledgeSpaceRepository: { findById: () => ({ userId: 'foreign' }) } },
          noteService: {
            getNote: () => ({ spaceId: 'foreign-space' }),
            getNoteLinkRelations: () => {
              readRelations = true;
            }
          }
        }
      });
      assert.throws(() => handlers.getNoteLinkRelations({ id: 'foreign-note' }), { code: 'KNOWLEDGE_SPACE_NOT_FOUND' });
      assert.equal(readRelations, false);
    }
  }
];

export const noteLinkPostgresTests =
  process.env.KNOWRA_SYNC_TEST_DATABASE_URL && process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES === '1'
    ? [
        {
          name: '真实 PostgreSQL HTTP：逐处链接关系、持久化与删除恢复同 JSON',
          async run() {
            const database = await createPostgresTestDatabase();
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-note-links-pg-'));
            let app;
            try {
              app = await createPostgresAppContext({
                databaseUrl: database.databaseUrl,
                storageRootDir: root,
                ownerId: 'links-owner'
              });
              await acceptance(app);
            } finally {
              try {
                await app?.close();
              } finally {
                await database.close();
                fs.rmSync(root, { recursive: true, force: true });
              }
            }
          }
        }
      ]
    : [];
