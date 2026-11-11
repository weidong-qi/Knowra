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
import { createAuthorizedKeywordSearch } from '../src/modules/ai/keyword-search.js';

const instant = new Date('2026-10-02T00:00:00.000Z');
const stamp = instant.toISOString();

async function withFixture(run, driver = 'json', asynchronous = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-keyword-coverage-'));
  let data;
  try {
    data =
      driver === 'sqlite'
        ? (await import('../../desktop-runtime/src/sqlite-data-store.mjs')).createSqliteDataStore(
            path.join(root, 'data.sqlite')
          )
        : createFileDataStore(path.join(root, 'data.json'));
    const notes = createInMemoryNoteRepository({ records: data.state.notes });
    const versions = createInMemoryNoteVersionRepository({ records: data.state.noteVersions });
    const folders = createInMemoryFolderRepository({ records: data.state.folders });
    const spaces = createInMemoryKnowledgeSpaceRepository({ records: data.state.spaces });
    spaces.save({ id: 'coverage-space', userId: 'demo', name: '合成覆盖集' });
    spaces.save({ id: 'other-space', userId: 'other', name: '其他 owner 合成空间' });
    const asyncRepository = repository =>
      Object.fromEntries(
        Object.entries(repository).map(([key, value]) => [
          key,
          typeof value === 'function' ? async (...args) => value(...args) : value
        ])
      );
    const access = createAiAccessService({
      store: data.aiAccessStore,
      noteRepository: asynchronous ? asyncRepository(notes) : notes,
      noteVersionRepository: asynchronous ? asyncRepository(versions) : versions,
      folderRepository: asynchronous ? asyncRepository(folders) : folders,
      spaceRepository: asynchronous ? asyncRepository(spaces) : spaces,
      ownerId: 'demo',
      now: () => instant
    });
    const put = (id, title, content, extra = {}) => {
      notes.save({
        id,
        title,
        rawMarkdown: content,
        plainText: content,
        folderId: null,
        spaceId: 'coverage-space',
        tagIds: [],
        deleted: false,
        favorite: false,
        createdAt: stamp,
        updatedAt: stamp,
        ...extra
      });
      versions.save(new NoteVersion({ id: `version-${id}-${calculateContentHash(content)}`, noteId: id, content }));
    };
    const grant = async (scope = { kind: 'library' }, excludedNoteIds = []) => {
      data.flush();
      const policy = await access.createPolicy({
        spaceId: 'coverage-space',
        scope,
        excludedNoteIds,
        includeAttachments: false,
        read: true,
        egress: false,
        recipients: [],
        expiresAt: '2026-10-03T00:00:00.000Z'
      });
      return {
        policy,
        run: await access.createRunGrant({ policyId: policy.policyId, conversationId: 'coverage-conversation' })
      };
    };
    await run({ data, access, notes, versions, folders, spaces, put, grant });
  } finally {
    data?.close?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const assertReference = async (access, grantId, hit) => {
  const { note, version, contentHash } = await access.verifyRead({ grantId, noteId: hit.noteId, tool: 'notes_search' });
  assert.equal(hit.title, note.title);
  assert.equal(hit.ref.noteVersionId, version.id);
  assert.equal(hit.ref.contentHash, contentHash);
  assert.equal(hit.text, version.content.slice(hit.ref.start, hit.ref.end));
  assert.equal(hit.ref.quoteHash, calculateContentHash(hit.text));
};

const storageTests = ['json', 'sqlite'].flatMap(driver => [
  {
    name: `关键词覆盖 KW01 ${driver}：第 301 篇唯一正文命中仍可召回`,
    run: () =>
      withFixture(async ({ access, notes, put, grant }) => {
        for (let index = 0; index < 301; index++)
          put(
            `note-${String(index).padStart(3, '0')}`,
            '普通标题',
            index === 300 ? '正文含 uniquebodytoken。' : '没有目标词'
          );
        assert.equal(notes.list({ spaceId: 'coverage-space' })[300].id, 'note-300');
        const { run } = await grant();
        const found = await createAuthorizedKeywordSearch({ access }).search({
          grantId: run.grantId,
          query: 'uniquebodytoken'
        });
        assert.deepEqual(
          found.hits.map(hit => hit.noteId),
          ['note-300']
        );
        assert.equal(found.truncated, false);
        await assertReference(access, run.grantId, found.hits[0]);
      }, driver)
  },
  {
    name: `关键词覆盖 KW02 ${driver}：第 301 篇唯一标题命中不依赖收藏或列表顺序`,
    run: () =>
      withFixture(async ({ access, notes, put, grant }) => {
        for (let index = 0; index < 301; index++)
          put(`note-${String(index).padStart(3, '0')}`, index === 300 ? 'uniquetitletoken' : '普通标题', '普通正文', {
            favorite: index < 300
          });
        assert.equal(notes.list({ spaceId: 'coverage-space' })[300].id, 'note-300');
        const { run } = await grant();
        const found = await createAuthorizedKeywordSearch({ access }).search({
          grantId: run.grantId,
          query: 'uniquetitletoken'
        });
        assert.deepEqual(
          found.hits.map(hit => hit.noteId),
          ['note-300']
        );
        assert.equal(found.hits[0].score, 5);
        assert.equal(found.truncated, false);
        await assertReference(access, run.grantId, found.hits[0]);
      }, driver)
  },
  {
    name: `关键词覆盖 KW03 ${driver}：301 篇匹配时仍保留原分数和 ID 稳定排序并报告候选截断`,
    run: () =>
      withFixture(async ({ access, put, grant }) => {
        for (let index = 0; index < 300; index++)
          put(`note-${String(index).padStart(3, '0')}`, '普通标题', 'ranktoken', { favorite: true });
        put('late-best', 'ranktoken', 'ranktoken');
        const { run } = await grant();
        const found = await createAuthorizedKeywordSearch({ access }).search({
          grantId: run.grantId,
          query: 'ranktoken',
          limit: 8
        });
        assert.deepEqual(
          found.hits.map(hit => hit.noteId),
          ['late-best', ...Array.from({ length: 7 }, (_, i) => `note-${String(i).padStart(3, '0')}`)]
        );
        assert.deepEqual(
          found.hits.map(hit => hit.score),
          [7, 2, 2, 2, 2, 2, 2, 2]
        );
        assert.equal(found.inspected, 300);
        assert.equal(found.coverage.scannedNotes, 301);
        assert.equal(found.coverage.matchedNotes, 301);
        assert.deepEqual(found.coverage.limitedBy, ['candidates']);
        assert.equal(found.truncated, true);
      }, driver)
  },
  {
    name: `关键词覆盖 KW04 ${driver}：目录、固定、排除、删除、跨空间和 owner 在正文谓词前过滤`,
    run: () =>
      withFixture(async ({ access, folders, spaces, put, grant }) => {
        for (const [id, parentId, deletedAt] of [
          ['root', null, null],
          ['child', 'root', null],
          ['outside', null, null],
          ['trash', null, stamp]
        ]) {
          folders.save({ id, parentId, deletedAt, spaceId: 'coverage-space', name: id });
        }
        put('inside', 'inside', 'scopetoken', { folderId: 'root' });
        put('child', 'child', 'scopetoken', { folderId: 'child' });
        put('outside', 'outside', 'scopetoken', { folderId: 'outside', favorite: true });
        put('excluded', 'excluded', '禁止进入谓词', { folderId: 'root' });
        put('deleted', 'deleted', '禁止进入谓词', { folderId: 'root', deleted: true });
        put('other-owner', 'other-owner', '禁止进入谓词', { spaceId: 'other-space' });
        put('trash-note', 'trash-note', '禁止进入谓词', { folderId: 'trash', deleted: true });
        for (const [scope, expected] of [
          [{ kind: 'folder', folderId: 'root' }, ['child', 'inside']],
          [{ kind: 'fixed', noteIds: ['inside', 'outside'] }, ['inside']],
          [{ kind: 'library' }, ['child', 'inside']]
        ]) {
          const { run } = await grant(scope, ['excluded', 'outside']);
          const seen = [];
          const selected = await access.findAuthorizedSearchCandidates({
            grantId: run.grantId,
            maxCandidates: 300,
            maxScanNotes: 5000,
            maxScanChars: 4_000_000,
            maxNoteChars: 200_000,
            scoreNote({ title, rawMarkdown }) {
              assert(!rawMarkdown.includes('禁止'));
              seen.push(title);
              return 1;
            }
          });
          assert.deepEqual(seen.sort(), expected);
          assert.deepEqual(
            selected.candidates.map(row => row.noteId),
            expected
          );
          const found = await createAuthorizedKeywordSearch({ access }).search({
            grantId: run.grantId,
            query: 'scopetoken'
          });
          assert.deepEqual(
            found.hits.map(hit => hit.noteId),
            expected
          );
          assert.equal(found.truncated, false);
        }
        const { run } = await grant();
        spaces.save({ ...spaces.findById('coverage-space'), userId: 'other' });
        await assert.rejects(
          createAuthorizedKeywordSearch({ access }).search({ grantId: run.grantId, query: 'scopetoken' }),
          { code: 'AI_SCOPE_FORBIDDEN' }
        );
      }, driver)
  },
  {
    name: `关键词覆盖 KW05 ${driver}：301 篇目录成员的正文召回和列表顺序一致`,
    run: () =>
      withFixture(async ({ access, folders, put, grant }) => {
        folders.save({ id: 'root', parentId: null, deletedAt: null, spaceId: 'coverage-space', name: '授权目录' });
        for (let index = 0; index < 301; index++)
          put(`member-${String(index).padStart(3, '0')}`, '成员', index === 300 ? 'foldertoken' : '正文', {
            folderId: 'root',
            favorite: index < 300
          });
        put('outside', 'foldertoken', 'foldertoken', { favorite: true });
        const { run } = await grant({ kind: 'folder', folderId: 'root' });
        const found = await createAuthorizedKeywordSearch({ access }).search({
          grantId: run.grantId,
          query: 'foldertoken'
        });
        assert.deepEqual(
          found.hits.map(hit => hit.noteId),
          ['member-300']
        );
        assert.equal(found.truncated, false);
        assert.equal(found.coverage.scannedNotes, 301);
      }, driver)
  }
]);

export const aiKeywordCoverageTests = [
  ...storageTests,
  {
    name: '关键词覆盖 KW06：无命中和非匹配笔记不加载不可变版本，扫描工作计数有界',
    run: () =>
      withFixture(async ({ access, versions, put, grant }) => {
        for (let index = 0; index < 401; index++) put(`note-${index}`, '标题', index === 400 ? 'readtoken' : '正文');
        const { run } = await grant();
        let versionReads = 0;
        const find = versions.findByNoteIdAndContentHash;
        versions.findByNoteIdAndContentHash = (...args) => {
          versionReads++;
          return find(...args);
        };
        const search = createAuthorizedKeywordSearch({ access });
        const absent = await search.search({ grantId: run.grantId, query: 'absenttoken' });
        assert.deepEqual(absent.hits, []);
        assert.equal(absent.inspected, 0);
        assert.equal(absent.truncated, false);
        assert.equal(absent.coverage.scannedNotes, 401);
        assert.equal(versionReads, 0);
        const found = await search.search({ grantId: run.grantId, query: 'readtoken' });
        assert.deepEqual(
          found.hits.map(hit => hit.noteId),
          ['note-400']
        );
        assert.equal(found.inspected, 1);
        assert(versionReads < 10, `单一匹配不应触发全库版本读取：${versionReads}`);
        assert.equal(found.coverage.scannedChars, 400 * '标题正文'.length + '标题readtoken'.length);
      })
  },
  {
    name: '关键词覆盖 KW07：笔记和字符预算恰好边界有完整覆盖，多一条或一单位即报告受限',
    run: () =>
      withFixture(async ({ access, put, grant }) => {
        put('first', 'aa', 'nothing');
        put('second', 'bb', 'boundarytoken');
        const { run } = await grant();
        const input = { grantId: run.grantId, query: 'boundarytoken' };
        const total = 'aanothingbbboundarytoken'.length;
        const complete = await createAuthorizedKeywordSearch({ access, maxScanNotes: 2, maxScanChars: total }).search(
          input
        );
        assert.deepEqual(
          complete.hits.map(hit => hit.noteId),
          ['second']
        );
        assert.equal(complete.truncated, false);
        assert.equal(complete.coverage.scannedChars, total);
        for (const [config, reason] of [
          [{ maxScanNotes: 1 }, 'notes'],
          [{ maxScanChars: total - 1 }, 'chars']
        ]) {
          const limited = await createAuthorizedKeywordSearch({ access, ...config }).search(input);
          assert.deepEqual(limited.hits, []);
          assert.equal(limited.truncated, true);
          assert.equal(limited.coverage.scannedNotes, 1);
          assert.deepEqual(limited.coverage.limitedBy, [reason]);
        }
        const beforeFirst = await createAuthorizedKeywordSearch({ access, maxScanChars: 1 }).search(input);
        assert.equal(beforeFirst.truncated, true);
        assert.equal(beforeFirst.inspected, 0);
        assert.equal(beforeFirst.coverage.scannedNotes, 0);
        assert.equal(beforeFirst.coverage.scannedChars, 0);
      })
  },
  {
    name: '关键词覆盖 KW08：超大笔记跳过并报告，恰好单篇上限仍参与检索',
    run: () =>
      withFixture(async ({ access, put, grant }) => {
        put('huge', 'hugetoken', 'x'.repeat(200_001), { favorite: true });
        put('exact', '标题', `${'x'.repeat(200_000 - 'hugetoken'.length)}hugetoken`);
        const { run } = await grant();
        const found = await createAuthorizedKeywordSearch({ access }).search({
          grantId: run.grantId,
          query: 'hugetoken'
        });
        assert.deepEqual(
          found.hits.map(hit => hit.noteId),
          ['exact']
        );
        assert.equal(found.truncated, true);
        assert.equal(found.coverage.skippedOversize, 1);
        assert.deepEqual(found.coverage.limitedBy, ['oversize']);
        assert.equal(found.coverage.scannedNotes, 2);
        assert.equal(found.coverage.scannedChars, 200_000 + '标题'.length);
        await assertReference(access, run.grantId, found.hits[0]);
      })
  },
  {
    name: '关键词覆盖 KW09：NFKC 展开、全角和 emoji 保留原文 UTF-16 合法片段',
    run: () =>
      withFixture(async ({ access, put, grant }) => {
        const content = `${'a'.repeat(79)}😀ＡＢＣ ﬃ ${'b'.repeat(238)}😀结尾`;
        put('unicode', '全角标题', content);
        const { run } = await grant();
        const found = await createAuthorizedKeywordSearch({ access }).search({
          grantId: run.grantId,
          query: 'ABC ffi'
        });
        assert.deepEqual(
          found.hits.map(hit => hit.noteId),
          ['unicode']
        );
        assert.equal(found.hits[0].score, 4);
        assert(found.hits[0].text.includes('ＡＢＣ ﬃ'));
        assert(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(found.hits[0].text));
        await assertReference(access, run.grantId, found.hits[0]);
      })
  },
  {
    name: '关键词覆盖 KW10：查询预选只匹配当前 Markdown，不将 plainText 或历史版本当来源',
    run: () =>
      withFixture(async ({ access, put, grant }) => {
        put('old', '旧正文', 'versiontoken 历史文本');
        put('old', '当前正文', '当前没有目标词', { plainText: 'versiontoken 伪造摘要' });
        put('current', '当前版本', '```\nversiontoken\n```', { plainText: '' });
        const { run } = await grant();
        const found = await createAuthorizedKeywordSearch({ access }).search({
          grantId: run.grantId,
          query: 'versiontoken'
        });
        assert.deepEqual(
          found.hits.map(hit => hit.noteId),
          ['current']
        );
        assert(!JSON.stringify(found).includes('历史文本'));
        assert.equal(found.truncated, false);
        await assertReference(access, run.grantId, found.hits[0]);
      })
  },
  {
    name: '关键词覆盖 KW11：候选扫描后撤销、收窄、换 epoch 或空间 owner 均 fail closed',
    run: async () => {
      for (const mutation of ['revoke', 'narrow', 'epoch', 'owner'])
        await withFixture(async ({ data, access, spaces, put, grant }) => {
          put('inside', '标题', 'racetoken');
          const { policy, run } = await grant();
          const select = access.findAuthorizedSearchCandidates;
          access.findAuthorizedSearchCandidates = async input => {
            const selected = await select(input);
            if (mutation === 'revoke') await access.narrowPolicy(policy.policyId, { revision: 1, revoke: true });
            if (mutation === 'narrow')
              await access.narrowPolicy(policy.policyId, { revision: 1, excludedNoteIds: ['inside'] });
            if (mutation === 'epoch') data.importSnapshot(data.exportSnapshot());
            if (mutation === 'owner') spaces.save({ ...spaces.findById('coverage-space'), userId: 'other' });
            return selected;
          };
          await assert.rejects(
            createAuthorizedKeywordSearch({ access }).search({ grantId: run.grantId, query: 'racetoken' }),
            { code: mutation === 'owner' ? 'AI_SCOPE_FORBIDDEN' : 'AI_ACCESS_REVOKED' }
          );
        });
    }
  },
  {
    name: '关键词覆盖 KW12：枚举期间撤销使无命中检索也失败',
    run: () =>
      withFixture(async ({ access, notes, put, grant }) => {
        put('inside', '标题', '普通正文');
        const { policy, run } = await grant();
        const list = notes.list;
        notes.list = async options => {
          const result = list(options);
          await access.narrowPolicy(policy.policyId, { revision: 1, revoke: true });
          return result;
        };
        await assert.rejects(
          createAuthorizedKeywordSearch({ access }).search({ grantId: run.grantId, query: 'absenttoken' }),
          { code: 'AI_ACCESS_REVOKED' }
        );
      })
  },
  {
    name: '关键词覆盖 KW13：候选形成后更新版本、标题、删除或移出目录均拒绝旧结果',
    run: async () => {
      for (const mutation of ['version', 'title', 'delete', 'folder'])
        await withFixture(async ({ access, notes, folders, put, grant }) => {
          folders.save({ id: 'root', parentId: null, deletedAt: null, spaceId: 'coverage-space', name: '授权目录' });
          put('inside', '标题', 'racetoken 当前版本', { folderId: 'root' });
          const { run } = await grant({ kind: 'folder', folderId: 'root' });
          const select = access.findAuthorizedSearchCandidates;
          access.findAuthorizedSearchCandidates = async input => {
            const selected = await select(input);
            if (mutation === 'version') put('inside', '标题', 'racetoken 新版本', { folderId: 'root' });
            else
              notes.save({
                ...notes.findById('inside'),
                ...(mutation === 'title'
                  ? { title: '新标题' }
                  : mutation === 'delete'
                    ? { deleted: true }
                    : { folderId: null })
              });
            return selected;
          };
          await assert.rejects(
            createAuthorizedKeywordSearch({ access }).search({ grantId: run.grantId, query: 'racetoken' }),
            { code: ['version', 'title'].includes(mutation) ? 'AI_SOURCE_STALE' : 'AI_SCOPE_FORBIDDEN' }
          );
        });
    }
  },
  {
    name: '关键词覆盖 KW14：评分完成后的版本变化和最终授权撤销仍拒绝返回',
    run: async () => {
      for (const mutation of ['version', 'revoke'])
        await withFixture(async ({ access, put, grant }) => {
          put('inside', '标题', 'latetoken 旧正文');
          const { policy, run } = await grant();
          const verify = access.verifyRead;
          let reads = 0;
          access.verifyRead = async input => {
            const result = await verify(input);
            reads++;
            if (reads === 1 && mutation === 'version') put('inside', '标题', 'latetoken 新正文');
            if (reads === 2 && mutation === 'revoke')
              await access.narrowPolicy(policy.policyId, { revision: 1, revoke: true });
            return result;
          };
          await assert.rejects(
            createAuthorizedKeywordSearch({ access }).search({ grantId: run.grantId, query: 'latetoken' }),
            { code: mutation === 'version' ? 'AI_SOURCE_STALE' : 'AI_ACCESS_REVOKED' }
          );
        });
    }
  },
  {
    name: '关键词覆盖 KW15：异步 repository 契约同样召回第 301 篇正文（非真实 PostgreSQL 验收）',
    run: () =>
      withFixture(
        async ({ access, put, grant }) => {
          for (let index = 0; index < 301; index++)
            put(`note-${index}`, '标题', index === 300 ? 'asynctoken' : '普通正文');
          const { run } = await grant();
          const found = await createAuthorizedKeywordSearch({ access }).search({
            grantId: run.grantId,
            query: 'asynctoken'
          });
          assert.deepEqual(
            found.hits.map(hit => hit.noteId),
            ['note-300']
          );
          assert.equal(found.truncated, false);
          await assertReference(access, run.grantId, found.hits[0]);
        },
        'json',
        true
      )
  },
  {
    name: '关键词覆盖 KW16：无效预算和无可分词查询保持受控授权边界',
    run: () =>
      withFixture(async ({ access, put, grant }) => {
        put('inside', '标题', '普通正文');
        const { policy, run } = await grant();
        for (const config of [
          { maxCandidates: 0 },
          { maxNoteChars: Infinity },
          { maxScanNotes: -1 },
          { maxScanChars: NaN }
        ]) {
          assert.throws(() => createAuthorizedKeywordSearch({ access, ...config }), TypeError);
        }
        const search = createAuthorizedKeywordSearch({ access });
        assert.deepEqual(await search.search({ grantId: run.grantId, query: '😀' }), {
          hits: [],
          inspected: 0,
          truncated: false
        });
        await access.narrowPolicy(policy.policyId, { revision: 1, revoke: true });
        await assert.rejects(search.search({ grantId: run.grantId, query: '😀' }), { code: 'AI_ACCESS_REVOKED' });
      })
  },
  {
    name: '关键词覆盖 KW17：空正文标题命中不占用可引用候选额度',
    run: () =>
      withFixture(async ({ access, put, grant }) => {
        put('empty', 'emptytoken', '', { favorite: true });
        put('actual', '普通标题', 'emptytoken 当前正文');
        const { run } = await grant();
        const found = await createAuthorizedKeywordSearch({ access, maxCandidates: 1 }).search({
          grantId: run.grantId,
          query: 'emptytoken'
        });
        assert.deepEqual(
          found.hits.map(hit => hit.noteId),
          ['actual']
        );
        assert.equal(found.truncated, false);
        await assertReference(access, run.grantId, found.hits[0]);
      })
  },
  {
    name: '关键词覆盖 KW18：匹配正文的权威版本缺失、内容哈希损坏或笔记身份错配均失败',
    run: async () => {
      for (const mutation of ['missing', 'content', 'identity'])
        await withFixture(async ({ access, versions, put, grant }) => {
          put('inside', '标题', 'authoritytoken 当前正文');
          const { run } = await grant();
          const find = versions.findByNoteIdAndContentHash;
          versions.findByNoteIdAndContentHash = (...args) => {
            const version = find(...args);
            if (mutation === 'missing') return null;
            return { ...version, ...(mutation === 'content' ? { content: '伪造内容' } : { noteId: 'other-note' }) };
          };
          await assert.rejects(
            createAuthorizedKeywordSearch({ access }).search({ grantId: run.grantId, query: 'authoritytoken' }),
            { code: 'AI_SOURCE_STALE' }
          );
        });
    }
  },
  {
    name: '关键词覆盖 KW19：候选版本异步读取期间撤销或保存新版本都 fail closed',
    run: async () => {
      for (const mutation of ['revoke', 'version'])
        await withFixture(async ({ access, versions, put, grant }) => {
          put('inside', '标题', 'asyncversiontoken 旧正文');
          const { policy, run } = await grant();
          const find = versions.findByNoteIdAndContentHash;
          let reads = 0;
          versions.findByNoteIdAndContentHash = async (...args) => {
            const previous = find(...args);
            if (++reads === 1) {
              await Promise.resolve();
              if (mutation === 'revoke') await access.narrowPolicy(policy.policyId, { revision: 1, revoke: true });
              else put('inside', '标题', 'asyncversiontoken 新正文');
            }
            return previous;
          };
          await assert.rejects(
            createAuthorizedKeywordSearch({ access }).search({ grantId: run.grantId, query: 'asyncversiontoken' }),
            { code: mutation === 'revoke' ? 'AI_ACCESS_REVOKED' : 'AI_SOURCE_STALE' }
          );
        });
    }
  },
  {
    name: '关键词覆盖 KW20：预选与权威版本评分使用同一逐码点 NFKC，组合符号不漏基线命中',
    run: () =>
      withFixture(async ({ access, put, grant }) => {
        put('combining', '标题', 'Ｃａｆｅ\u0301');
        const { run } = await grant();
        const found = await createAuthorizedKeywordSearch({ access }).search({ grantId: run.grantId, query: 'cafe' });
        assert.deepEqual(
          found.hits.map(hit => hit.noteId),
          ['combining']
        );
        assert.equal(found.hits[0].score, 2);
        assert.equal(found.hits[0].text, 'Ｃａｆｅ\u0301');
        await assertReference(access, run.grantId, found.hits[0]);
      })
  },
  {
    name: '关键词覆盖 KW21：预选后正文增至单篇上限外，复核在超大版本查询前失败',
    run: () =>
      withFixture(async ({ data, access, notes, versions, put, grant }) => {
        put('growing', '标题', 'growthtoken 原正文');
        const { run } = await grant();
        const select = access.findAuthorizedSearchCandidates;
        access.findAuthorizedSearchCandidates = async input => {
          const selected = await select(input);
          put('growing', '标题', `growthtoken${'x'.repeat(200_001 - 'growthtoken'.length)}`);
          data.flush();
          return selected;
        };
        const find = versions.findByNoteIdAndContentHash;
        versions.findByNoteIdAndContentHash = (...args) => {
          assert(notes.findById(args[0]).rawMarkdown.length <= 200_000, '单篇上限外的当前正文不能触发版本查询');
          return find(...args);
        };
        await assert.rejects(
          createAuthorizedKeywordSearch({ access }).search({ grantId: run.grantId, query: 'growthtoken' }),
          { code: 'AI_SOURCE_STALE' }
        );
      })
  },
  {
    name: '关键词覆盖 KW22：普通 R02 read 保留大正文语义，可选受信上限验证仍先复核授权',
    run: () =>
      withFixture(async ({ access, versions, put, grant }) => {
        put('large', '标题', 'x'.repeat(200_001));
        const { policy, run } = await grant({ kind: 'fixed', noteIds: ['large'] });
        const input = { grantId: run.grantId, noteId: 'large' };
        const find = versions.findByNoteIdAndContentHash;
        let reads = 0;
        versions.findByNoteIdAndContentHash = (...args) => {
          reads++;
          return find(...args);
        };
        const ordinary = await access.verifyRead(input);
        assert.equal(ordinary.version.content.length, 200_001);
        const before = reads;
        await assert.rejects(access.verifyRead({ ...input, maxContentChars: 200_000 }), { code: 'AI_SOURCE_STALE' });
        assert.equal(reads, before);
        for (const maxContentChars of [0, -1, 1.5, Infinity, undefined]) {
          if (maxContentChars === undefined)
            assert.equal((await access.verifyRead({ ...input, maxContentChars })).version.id, ordinary.version.id);
          else await assert.rejects(access.verifyRead({ ...input, maxContentChars }), TypeError);
        }
        await access.narrowPolicy(policy.policyId, { revision: 1, revoke: true });
        await assert.rejects(access.verifyRead({ ...input, maxContentChars: 0 }), { code: 'AI_ACCESS_REVOKED' });
      })
  }
];
