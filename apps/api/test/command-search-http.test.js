import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createAppContext } from '../src/app.factory.js';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import { createKnowledgeModule } from '../src/modules/knowledge/index.js';
import { createKnowledgeHttpHandlers } from '../src/modules/knowledge/http/knowledge-handlers.ts';
import { createPostgresKnowledgeHttpHandlers } from '../src/modules/knowledge/http/postgres-async-handlers.ts';
import { createAsyncSearchService } from '../src/modules/knowledge/application/postgres-async/search-service.ts';
import { createServer } from '../src/server.js';

export const COMMAND_OWNER = 'command-owner';
export const BODY_QUERY = '中文深处命中';

export async function withCommandServer(appContext, operation) {
  const server = createServer({ appContext, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await operation(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

export async function searchRequest(baseUrl, input) {
  const response = await fetch(`${baseUrl}/api/knowledge/search/notes?${new URLSearchParams(input)}`);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  return { status: response.status, payload: await response.json() };
}

export async function seedCommandNotes(knowledge) {
  const space = await knowledge.createDefaultKnowledgeSpace();
  const otherSpace = await knowledge.createKnowledgeSpace({ name: '同 owner 的其他空间' });
  const folder = await knowledge.createFolder({ spaceId: space.id, name: '合成目录' });
  const body = await knowledge.createNote({
    id: 'command-body',
    spaceId: space.id,
    folderId: folder.id,
    title: '只有正文匹配的合成资料',
    rawMarkdown: `开头秘密${'前文内容。'.repeat(150)}\n\n${BODY_QUERY}${'后文内容。'.repeat(150)}结尾秘密`
  });
  const title = await knowledge.createNote({
    id: 'command-title',
    spaceId: space.id,
    title: 'TITLE-ONLY 查询',
    rawMarkdown: '普通正文'
  });
  const deleted = await knowledge.createNote({
    id: 'command-deleted',
    spaceId: space.id,
    title: '回收站',
    rawMarkdown: BODY_QUERY
  });
  await knowledge.deleteNote({ id: deleted.id });
  const other = await knowledge.createNote({
    id: 'command-other',
    spaceId: otherSpace.id,
    title: '其他空间',
    rawMarkdown: BODY_QUERY
  });
  const folded = await knowledge.createNote({
    id: 'command-folded',
    spaceId: space.id,
    title: '大小写偏移合成资料',
    rawMarkdown: `${'İ'.repeat(350)}🙂中文偏移边界${'末文'.repeat(200)}`
  });
  await knowledge.createNote({
    id: 'command-long-query',
    spaceId: space.id,
    title: '查询边界资料',
    rawMarkdown: `${'🙂前'.repeat(100)}${'长'.repeat(200)}${'🙂后'.repeat(100)}`
  });
  for (let index = 0; index < 35; index += 1) {
    await knowledge.createNote({
      id: `command-limit-${index}`,
      spaceId: space.id,
      title: `限额资料 ${index}`,
      rawMarkdown: '限额检查'
    });
  }
  return { space, otherSpace, body, title, deleted, other, folded };
}

export async function assertCommandRoute(baseUrl, fixture) {
  const input = { result: 'command', spaceId: fixture.space.id, query: BODY_QUERY };
  const found = await searchRequest(baseUrl, { ...input, includeDeleted: 'true', deletedOnly: 'true' });
  assert.equal(found.status, 200);
  assert.equal(found.payload.data.length, 1);
  const hit = found.payload.data[0];
  assert.deepEqual(Object.keys(hit).sort(), ['folderId', 'id', 'snippet', 'title']);
  assert.equal(hit.id, fixture.body.id);
  assert.equal(hit.folderId, fixture.body.folderId);
  assert.match(hit.snippet, new RegExp(BODY_QUERY));
  assert.ok(hit.snippet.length <= 220);
  assert.ok(!JSON.stringify(found.payload).includes('开头秘密'));
  assert.ok(!JSON.stringify(found.payload).includes('结尾秘密'));
  assert.equal(fixture.body.plainText.slice(0, 240).includes(BODY_QUERY), false);
  const title = await searchRequest(baseUrl, { ...input, query: 'title-only' });
  assert.equal(title.status, 200);
  assert.equal(title.payload.data[0].id, fixture.title.id);
  const folded = await searchRequest(baseUrl, { ...input, query: '中文偏移边界' });
  assert.equal(folded.payload.data[0].id, fixture.folded.id);
  assert.match(folded.payload.data[0].snippet, /中文偏移边界/);
  const long = await searchRequest(baseUrl, { ...input, query: '长'.repeat(200) });
  assert.equal(long.status, 200);
  assert.ok(long.payload.data[0].snippet.includes('长'.repeat(200)));
  assert.ok(long.payload.data[0].snippet.length <= 220);
  assert.ok(long.payload.data[0].snippet.isWellFormed());

  const limited = await searchRequest(baseUrl, { ...input, query: '限额检查', limit: '999' });
  assert.equal(limited.status, 200);
  assert.equal(limited.payload.data.length, 30);
  assert.equal((await searchRequest(baseUrl, { ...input, query: '限额检查', limit: '2' })).payload.data.length, 2);
  const empty = await searchRequest(baseUrl, { ...input, query: '  ' });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.payload.data, []);

  for (const invalid of [
    { spaceId: '' },
    { spaceId: 's'.repeat(201) },
    { query: '词'.repeat(201) },
    { limit: '0' },
    { limit: '-1' },
    { limit: '1.5' },
    { limit: 'invalid' }
  ]) {
    const rejected = await searchRequest(baseUrl, { ...input, ...invalid });
    assert.equal(rejected.status, 422, JSON.stringify(invalid));
    assert.equal(typeof rejected.payload.error.code, 'string');
  }
  const missing = await searchRequest(baseUrl, { result: 'command', query: BODY_QUERY });
  assert.equal(missing.status, 422);
  const unknown = await searchRequest(baseUrl, { ...input, spaceId: 'missing' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.payload.error.code, 'KNOWLEDGE_SPACE_NOT_FOUND');
  const other = await searchRequest(baseUrl, { ...input, spaceId: fixture.otherSpace.id });
  assert.deepEqual(
    other.payload.data.map(note => note.id),
    [fixture.other.id]
  );

  // 原索引页使用 includeDeleted=true 的 ID 搜索；旧全 note 查询仍返回完整 note。
  const ids = await searchRequest(baseUrl, { ...input, result: 'ids', includeDeleted: 'true' });
  assert.deepEqual(new Set(ids.payload.data), new Set([fixture.body.id, fixture.deleted.id]));
  const notes = await searchRequest(baseUrl, { spaceId: fixture.space.id, query: BODY_QUERY });
  assert.equal(notes.payload.data[0].rawMarkdown, fixture.body.rawMarkdown);
  assert.equal(notes.payload.data[0].plainText, fixture.body.plainText);
}

async function withLocalFixture(driver, operation) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-command-search-'));
  let dataStore;
  try {
    dataStore =
      driver === 'json'
        ? createFileDataStore(path.join(root, 'data.json'))
        : (await import('../../desktop-runtime/src/sqlite-data-store.mjs')).createSqliteDataStore(
            path.join(root, 'data.sqlite')
          );
    const app = createAppContext({ dataStore, storageRootDir: root, ownerId: COMMAND_OWNER });
    const fixture = await seedCommandNotes(app.http.knowledge);
    await withCommandServer(app, baseUrl => operation(baseUrl, fixture));
  } finally {
    dataStore?.close?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export const commandSearchHttpTests = [
  ...['json', 'sqlite'].map(driver => ({
    name: `命令正文搜索 ${driver} HTTP：长正文命中、有界 DTO、空间隔离、回收站与旧契约`,
    run: () => withLocalFixture(driver, assertCommandRoute)
  })),
  {
    name: '命令搜索 async service/handler HTTP 协议回归（内存协作者，非真实 PostgreSQL 验收）',
    async run() {
      const module = createKnowledgeModule({ enforceReferences: true });
      const fixture = await seedCommandNotes(
        createKnowledgeHttpHandlers({ knowledgeModule: module, ownerId: COMMAND_OWNER })
      );
      const searchService = createAsyncSearchService({
        listNotes: async input => module.noteService.listNotes(input),
        findKnowledgeSpace: async id => module.repositories.knowledgeSpaceRepository.findById(id)
      });
      const knowledge = createPostgresKnowledgeHttpHandlers({
        knowledgeModule: { ...module, searchService },
        ownerId: COMMAND_OWNER
      });
      await withCommandServer({ http: { knowledge, storage: {} } }, async baseUrl => {
        await assertCommandRoute(baseUrl, fixture);
        const foreign = module.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'foreign-owner' });
        const rejected = await searchRequest(baseUrl, {
          result: 'command',
          query: BODY_QUERY,
          spaceId: foreign.id,
          ownerId: 'foreign-owner'
        });
        assert.equal(rejected.status, 404);
        assert.equal(rejected.payload.error.code, 'KNOWLEDGE_SPACE_NOT_FOUND');
      });
    }
  },
  {
    name: '命令正文搜索 HTTP：服务端 owner 拒绝跨 owner 和客户端覆盖',
    async run() {
      const module = createKnowledgeModule({ enforceReferences: true });
      const space = module.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'foreign-owner' });
      module.noteService.createNote({ spaceId: space.id, title: '其他 owner 私有资料', rawMarkdown: BODY_QUERY });
      const knowledge = createKnowledgeHttpHandlers({ knowledgeModule: module, ownerId: COMMAND_OWNER });
      await withCommandServer({ http: { knowledge, storage: {} } }, async baseUrl => {
        const foreign = await searchRequest(baseUrl, {
          result: 'command',
          query: BODY_QUERY,
          spaceId: space.id,
          ownerId: 'foreign-owner',
          userId: 'foreign-owner'
        });
        assert.equal(foreign.status, 404);
        assert.equal(foreign.payload.error.code, 'KNOWLEDGE_SPACE_NOT_FOUND');
        assert.equal('data' in foreign.payload, false);
      });
    }
  }
];
