import assert from 'node:assert/strict';
import { createNoteDependencyLifecycle } from '../src/modules/knowledge/application/note-dependency-lifecycle.ts';
import { createAsyncNoteDependencyLifecycle } from '../src/modules/knowledge/application/postgres-async/note-dependency-lifecycle.ts';
import { createKnowledgeModule } from '../src/modules/knowledge/index.js';
import { createPostgresKnowledgeModule } from '../src/modules/knowledge/postgres-async-module.js';
import {
  legacyNoteDependencyLifecycle,
  legacyAsyncNoteDependencyLifecycle
} from './fixtures/note-dependency-lifecycle-legacy.js';

const note = Object.freeze({ id: 'n', rawMarkdown: 'after' });
const version = Object.freeze({ id: 'new', contentHash: 'hash-new' });
const change = Object.freeze({ before: 'before', after: 'after' });
const changedArgs = [note, version, change];
const factories = [
  [false, createNoteDependencyLifecycle, legacyNoteDependencyLifecycle],
  [true, createAsyncNoteDependencyLifecycle, legacyAsyncNoteDependencyLifecycle]
];
const permanentReads = [
  ['evidence.list', { noteId: 'n' }],
  ['versions.list', { noteId: 'n' }],
  ['sources.list'],
  ['scopes.list']
];
const permanentErrors = {
  evidence: {
    name: 'AppError',
    code: 'NOTE_HAS_KNOWLEDGE_EVIDENCE',
    statusCode: 409,
    message: 'Note has formal knowledge evidence and cannot be permanently deleted'
  },
  source: {
    name: 'AppError',
    code: 'NOTE_HAS_QUESTION_SOURCE',
    statusCode: 409,
    message: 'Note has a formal question source and cannot be permanently deleted'
  },
  scope: {
    name: 'AppError',
    code: 'NOTE_HAS_ANALYSIS_SCOPE',
    statusCode: 409,
    message: 'NoteVersion is referenced by an analysis scope snapshot and cannot be deleted'
  }
};

function fixture(factory, asyncMode, options = {}) {
  const calls = [],
    settled = [];
  const sentinel = Object.assign(new Error('synthetic dependency failure'), { code: 'SYNTHETIC_DEPENDENCY_FAILURE' });
  const data = {
    annotationIds: ['missing', 'resolved', 'absent', 'missing'],
    statuses: { missing: { anchorStatus: 'missing' }, resolved: { anchorStatus: 'resolved' } },
    versions: [{ id: 'old-2' }, { id: 'new' }, { id: 'old-1' }, { id: 'old-2' }],
    evidence: [],
    sources: [],
    scopes: [],
    annotationEvidence: id => [{ id: `e-${id}` }],
    directEvidence: [{ id: 'direct-2' }, { id: 'direct-1' }],
    deletedEvidence: [{ id: 'deleted-2' }, { id: 'deleted-1' }],
    ...options.data
  };
  let pending = 0;
  const call =
    (name, operation, synchronous = false) =>
    (...args) => {
      assert.equal(pending, 0, `前一异步依赖未完成便调用 ${name}`);
      calls.push([name, ...args]);
      const index = calls.length;
      const run = () => {
        if (options.failAt === index) throw sentinel;
        return operation(...args);
      };
      if (!asyncMode || synchronous) return run();
      pending++;
      return Promise.resolve().then(() => {
        pending--;
        settled.push(index);
        return run();
      });
    };
  const contentAnnotationService = {
    reconcileForNote: call('reconcile', () => ({ contentChangedAnnotationIds: data.annotationIds }))
  };
  const dependencies = {
    contentAnnotationService,
    createAnnotationService: call('createAnnotationService', () => contentAnnotationService, true),
    contentAnnotationRepository: { findById: call('annotations.findById', id => data.statuses[id]) },
    annotationIdentityShadow: { observe: call('observe', () => undefined) },
    knowledgeItemService: {
      markEvidenceByAnnotationId: call('mark.annotation', id => data.annotationEvidence(id)),
      markEvidenceByNoteVersionIds: call('mark.versions', () => data.directEvidence),
      markEvidenceByNoteId: call('mark.note', () => data.deletedEvidence)
    },
    questionService: { markSourcesStale: call('questions.stale', () => undefined) },
    noteVersionService: {
      listVersionIds: call('versions.ids', () => data.versions.map(item => item.id)),
      listVersions: call('versions.service.list', () => data.versions)
    },
    noteVersionRepository: {
      listIds: call('versions.ids', () => data.versions.map(item => item.id)),
      list: call('versions.list', () => data.versions)
    },
    knowledgeEvidenceRepository: { list: call('evidence.list', () => data.evidence) },
    questionSourceRepository: { list: call('sources.list', () => data.sources) },
    analysisScopeRepository: { list: call('scopes.list', () => data.scopes) },
    coalescePreviousVersion: call('coalesce', () => undefined)
  };
  const lifecycle = factory(dependencies);
  assert.deepEqual(calls, [], '创建生命周期不得提前读取或创建标注服务');
  return { lifecycle, calls, settled, sentinel, dependencies, data };
}
function expectedChange(asyncMode) {
  return [
    ...(asyncMode ? [['createAnnotationService']] : []),
    ['reconcile', 'n', 'hash-new', change],
    ...(!asyncMode ? [['observe', note, change]] : []),
    ['annotations.findById', 'missing'],
    ['mark.annotation', 'missing', 'insufficient'],
    ['annotations.findById', 'resolved'],
    ['mark.annotation', 'resolved', 'stale'],
    ['annotations.findById', 'absent'],
    ['mark.annotation', 'absent', 'stale'],
    ['annotations.findById', 'missing'],
    ['mark.annotation', 'missing', 'insufficient'],
    ['questions.stale', 'knowledgeEvidence', ['e-missing', 'e-resolved', 'e-absent', 'e-missing']],
    ['versions.ids', { noteId: 'n' }],
    ['mark.versions', ['old-2', 'old-1', 'old-2'], 'stale', 'noteVersion'],
    ['questions.stale', 'knowledgeEvidence', ['direct-2', 'direct-1']],
    ['questions.stale', 'noteVersion', ['old-2', 'old-1', 'old-2']],
    ...(!asyncMode ? [['coalesce', note, version, change]] : [])
  ];
}
function expectedDelete(asyncMode) {
  return [
    ['mark.note', 'n', 'invalid'],
    ['questions.stale', 'knowledgeEvidence', ['deleted-2', 'deleted-1']],
    [asyncMode ? 'versions.list' : 'versions.service.list', { noteId: 'n' }],
    ['questions.stale', 'noteVersion', ['old-2', 'new', 'old-1', 'old-2']]
  ];
}
async function outcome(f, hook, args) {
  try {
    return { value: await f.lifecycle[hook](...args), calls: f.calls };
  } catch (error) {
    return {
      error: { name: error.name, code: error.code, message: error.message, statusCode: error.statusCode },
      calls: f.calls
    };
  }
}

export const noteDependencyLifecycleTests = [
  {
    name: '笔记依赖生命周期：旧新正文级联精确差分保留顺序重复、缺失判定和本地观测合并',
    async run() {
      for (const [asyncMode, current, legacy] of factories) {
        const expected = { value: undefined, calls: expectedChange(asyncMode) };
        for (const factory of [legacy, current]) {
          const f = fixture(factory, asyncMode);
          assert.deepEqual(await outcome(f, 'onNoteContentChanged', changedArgs), expected);
          assert.equal(f.calls.find(([name]) => name === 'reconcile')[3], change);
          if (!asyncMode) {
            assert.equal(f.calls.at(-1)[1], note);
            assert.equal(f.calls.at(-1)[2], version);
            assert.equal(f.calls.at(-1)[3], change);
          } else {
            assert.equal(f.settled.length, expected.calls.length - 1, '每次读取与级联均已 await');
          }
        }
      }
    }
  },
  {
    name: '笔记依赖生命周期：旧新删除级联和空变更仍通知题目、不提前创建 PG 标注服务',
    async run() {
      for (const [asyncMode, current, legacy] of factories) {
        for (const factory of [legacy, current]) {
          const deleted = fixture(factory, asyncMode);
          assert.deepEqual(await outcome(deleted, 'onNoteDeleted', ['n']), {
            value: undefined,
            calls: expectedDelete(asyncMode)
          });
          const f = fixture(factory, asyncMode, {
            data: { annotationIds: [], versions: [{ id: 'new' }], directEvidence: [] }
          });
          assert.deepEqual(await outcome(f, 'onNoteContentChanged', changedArgs), {
            value: undefined,
            calls: [
              ...(asyncMode ? [['createAnnotationService']] : []),
              ['reconcile', 'n', 'hash-new', change],
              ...(!asyncMode ? [['observe', note, change]] : []),
              ['questions.stale', 'knowledgeEvidence', []],
              ['versions.ids', { noteId: 'n' }],
              ['mark.versions', [], 'stale', 'noteVersion'],
              ['questions.stale', 'knowledgeEvidence', []],
              ['questions.stale', 'noteVersion', []],
              ...(!asyncMode ? [['coalesce', note, version, change]] : [])
            ]
          });
          const emptyDelete = fixture(factory, asyncMode, { data: { versions: [], deletedEvidence: [] } });
          await emptyDelete.lifecycle.onNoteDeleted('n');
          assert.deepEqual(emptyDelete.calls, [
            ['mark.note', 'n', 'invalid'],
            ['questions.stale', 'knowledgeEvidence', []],
            [asyncMode ? 'versions.list' : 'versions.service.list', { noteId: 'n' }],
            ['questions.stale', 'noteVersion', []]
          ]);
        }
      }
    }
  },
  {
    name: '笔记依赖生命周期：永久删除守卫优先证据、题目来源、分析范围并保留短路读取',
    async run() {
      const cases = [
        [
          {
            evidence: [{}],
            sources: [{ sourceType: 'noteVersion', sourceId: 'old-1' }],
            scopes: [{ noteVersions: [{ noteId: 'n' }] }]
          },
          'evidence',
          1
        ],
        [
          {
            sources: [{ sourceType: 'noteVersion', sourceId: 'old-1' }],
            scopes: [{ noteVersions: [{ noteId: 'n' }] }]
          },
          'source',
          3
        ],
        [{ evidence: [{}], sources: [null], scopes: [null] }, 'evidence', 1],
        [{ sources: [{ sourceType: 'noteVersion', sourceId: 'old-1' }, null], scopes: [null] }, 'source', 3],
        [{ scopes: [{ noteVersions: [{ noteId: 'n' }, null] }, null] }, 'scope', 4],
        [{ scopes: [{ noteVersions: [{ noteId: 'other', noteVersionId: 'old-1' }] }] }, 'scope', 4],
        [{ versions: [], scopes: [{ noteVersions: [{ noteId: 'n' }] }] }, 'scope', 4],
        [
          {
            sources: [
              { sourceType: 'knowledgeEvidence', sourceId: 'old-1' },
              { sourceType: 'noteVersion', sourceId: 'foreign' }
            ],
            scopes: [{}, { noteVersions: null }, { noteVersions: [{ noteId: 'other', noteVersionId: 'foreign' }] }]
          },
          null,
          4
        ],
        [{ versions: [], sources: [], scopes: [] }, null, 4]
      ];
      for (const [asyncMode, current, legacy] of factories) {
        for (const [data, error, readCount] of cases) {
          const expected = {
            ...(error ? { error: permanentErrors[error] } : { value: undefined }),
            calls: permanentReads.slice(0, readCount)
          };
          const before = structuredClone(data);
          for (const factory of [legacy, current]) {
            assert.deepEqual(
              await outcome(fixture(factory, asyncMode, { data }), 'onBeforePermanentDelete', ['n']),
              expected
            );
          }
          assert.deepEqual(data, before);
        }
      }
    }
  },
  {
    name: '笔记依赖生命周期：每个依赖抛错或拒绝均原样传播并立即截断后续调用',
    async run() {
      for (const [asyncMode, current, legacy] of factories) {
        for (const [hook, args, expected] of [
          ['onNoteContentChanged', changedArgs, expectedChange(asyncMode)],
          ['onNoteDeleted', ['n'], expectedDelete(asyncMode)],
          ['onBeforePermanentDelete', ['n'], permanentReads]
        ]) {
          for (let failAt = 1; failAt <= expected.length; failAt++) {
            for (const factory of [legacy, current]) {
              const f = fixture(factory, asyncMode, { failAt });
              if (asyncMode) await assert.rejects(f.lifecycle[hook](...args), error => error === f.sentinel);
              else
                assert.throws(
                  () => f.lifecycle[hook](...args),
                  error => error === f.sentinel
                );
              assert.deepEqual(f.calls, expected.slice(0, failAt), `${hook} async=${asyncMode} failure=${failAt}`);
            }
          }
        }
      }
    }
  },
  {
    name: '笔记依赖生命周期：同步 flatMap 与 PG 串行 spread 的稀疏结果差异不被归一化',
    async run() {
      const sparseEvidence = [];
      sparseEvidence[1] = { id: 'kept' };
      const sparseIds = [];
      sparseIds[1] = 'resolved';
      for (const data of [
        { annotationIds: ['resolved'], annotationEvidence: () => sparseEvidence },
        { annotationIds: ['resolved'], annotationEvidence: () => ({ id: 'singleton' }) },
        { annotationIds: sparseIds }
      ]) {
        for (const [asyncMode, current, legacy] of factories) {
          const old = await outcome(fixture(legacy, asyncMode, { data }), 'onNoteContentChanged', changedArgs);
          const next = await outcome(fixture(current, asyncMode, { data }), 'onNoteContentChanged', changedArgs);
          assert.deepEqual(next, old);
          if (!asyncMode) assert.equal(next.error, undefined, '本地 flatMap 保留非数组单值、跳过空洞');
          else if (data.annotationEvidence) {
            assert.equal(next.error.name, 'TypeError');
            assert.equal(next.calls.at(-1)[0], 'mark.annotation', '异常后不得通知题目或读取旧版本');
          } else {
            assert.deepEqual(next.calls.slice(2, 4), [
              ['annotations.findById', undefined],
              ['mark.annotation', undefined, 'stale']
            ]);
          }
        }
      }
    }
  },
  {
    name: '笔记依赖生命周期：损坏返回值的错误时机与永久删除短路语义保持旧实现',
    async run() {
      for (const [asyncMode, current, legacy] of factories) {
        for (const [hook, data] of [
          ['onNoteContentChanged', { annotationIds: null }],
          ['onNoteContentChanged', { directEvidence: null }],
          ['onNoteDeleted', { deletedEvidence: null }],
          ['onBeforePermanentDelete', { versions: [null] }],
          ['onBeforePermanentDelete', { sources: [null] }],
          ['onBeforePermanentDelete', { scopes: [{ noteVersions: [null] }] }]
        ]) {
          const args = hook === 'onNoteContentChanged' ? changedArgs : ['n'];
          const expected = await outcome(fixture(legacy, asyncMode, { data }), hook, args);
          assert.equal(expected.error.name, 'TypeError');
          assert.deepEqual(await outcome(fixture(current, asyncMode, { data }), hook, args), expected);
        }
      }
    }
  },
  {
    name: '笔记依赖生命周期：PG 标注服务每次正文变更才创建且同步创建失败保留 rejected promise',
    async run() {
      for (const factory of [legacyAsyncNoteDependencyLifecycle, createAsyncNoteDependencyLifecycle]) {
        const f = fixture(factory, true);
        await f.lifecycle.onBeforePermanentDelete('n');
        await f.lifecycle.onNoteDeleted('n');
        assert.equal(
          f.calls.some(([name]) => name === 'createAnnotationService'),
          false
        );
        await f.lifecycle.onNoteContentChanged(...changedArgs);
        await f.lifecycle.onNoteContentChanged(...changedArgs);
        assert.equal(f.calls.filter(([name]) => name === 'createAnnotationService').length, 2);
        const failure = fixture(factory, true, { failAt: 1 });
        let promise;
        assert.doesNotThrow(() => {
          promise = failure.lifecycle.onNoteContentChanged(...changedArgs);
        });
        assert.equal(typeof promise.then, 'function');
        await assert.rejects(promise, error => error === failure.sentinel);
      }
    }
  }
];

noteDependencyLifecycleTests.push(
  {
    name: '笔记依赖生命周期：真实本地模块入口采用装配后替换的服务方法并接通三个 hooks',
    run() {
      const module = createKnowledgeModule();
      module.noteService.createNote({ id: 'n', spaceId: 's', title: '合成生命周期', rawMarkdown: 'before' });
      const f = fixture(createNoteDependencyLifecycle, false);
      // 原模块在 hooks 装配后才原位包装事务方法，故必须晚绑定对象的方法。
      Object.assign(module.contentAnnotationService, f.dependencies.contentAnnotationService);
      Object.assign(module.knowledgeItemService, f.dependencies.knowledgeItemService);
      Object.assign(module.questionService, f.dependencies.questionService);
      Object.assign(module.noteVersionService, f.dependencies.noteVersionService, { ensureForNote: () => version });
      Object.assign(module.repositories.contentAnnotationRepository, f.dependencies.contentAnnotationRepository);
      Object.assign(module.repositories.noteVersionRepository, f.dependencies.noteVersionRepository);
      Object.assign(module.repositories.knowledgeEvidenceRepository, f.dependencies.knowledgeEvidenceRepository);
      Object.assign(module.repositories.questionSourceRepository, f.dependencies.questionSourceRepository);
      Object.assign(module.repositories.analysisScopeRepository, f.dependencies.analysisScopeRepository);
      module.noteService.updateNote('n', { rawMarkdown: 'after' });
      const actualChange = f.calls[0][3];
      assert.equal(actualChange.before, 'before');
      assert.ok(actualChange.structure);
      const expected = expectedChange(false).filter(([name]) => !['observe', 'coalesce'].includes(name));
      expected[0] = ['reconcile', 'n', 'hash-new', actualChange];
      assert.deepEqual(f.calls, expected);
      f.calls.length = 0;
      module.noteService.deleteNote('n');
      assert.deepEqual(f.calls, expectedDelete(false));
      for (const [data, error, readCount] of [
        [{ evidence: [{}], sources: [null], scopes: [null] }, permanentErrors.evidence, 1],
        [
          { evidence: [], sources: [{ sourceType: 'noteVersion', sourceId: 'old-1' }], scopes: [null] },
          permanentErrors.source,
          3
        ],
        [{ evidence: [], sources: [], scopes: [{ noteVersions: [{ noteId: 'n' }] }] }, permanentErrors.scope, 4]
      ]) {
        Object.assign(f.data, data);
        f.calls.length = 0;
        assert.throws(() => module.noteService.permanentlyDeleteNote('n'), error);
        assert.deepEqual(f.calls, permanentReads.slice(0, readCount));
        assert.ok(module.repositories.noteRepository.findById('n'), '守卫失败不能删除笔记');
      }
      Object.assign(f.data, { scopes: [] });
      f.calls.length = 0;
      assert.equal(module.noteService.permanentlyDeleteNote('n').id, 'n');
      assert.deepEqual(f.calls, permanentReads);
      assert.equal(module.repositories.noteRepository.findById('n'), null);
    }
  },
  {
    name: '笔记依赖生命周期：真实 PG 模块三个 hooks 全程使用事务 repository、保留 Serializable 边界',
    async run() {
      const f = postgresModuleFixture();
      const saved = await f.module.noteService.updateNote('n', { rawMarkdown: 'after' });
      assert.equal(saved.rawMarkdown, 'after');
      assert.deepEqual(f.transactions, [{ isolationLevel: 'Serializable' }]);
      assert.ok(
        f.calls.some(([name]) => name === 'contentAnnotation.findMany'),
        '正文 hook 必须执行真实事务标注服务'
      );
      assert.ok(
        f.calls.some(([name, args]) => name === 'noteVersion.findMany' && args.select?.id === true),
        '旧版本必须使用事务内 ID 投影'
      );
      assert.deepEqual(
        f.calls.find(([name]) => name === 'knowledgeEvidence.findMany'),
        [
          'knowledgeEvidence.findMany',
          {
            where: {
              noteVersionId: { in: ['old'] },
              sourceType: 'noteVersion',
              status: { notIn: ['stale', 'invalid'] }
            }
          }
        ]
      );
      assert.deepEqual(
        f.calls.find(([name]) => name === 'questionSource.findMany'),
        [
          'questionSource.findMany',
          { where: { sourceType: 'noteVersion', sourceId: { in: ['old'] }, status: { not: 'stale' } } }
        ]
      );
      f.calls.length = 0;
      await f.module.noteService.deleteNote('n');
      assert.deepEqual(
        f.calls.find(([name]) => name === 'knowledgeEvidence.findMany'),
        ['knowledgeEvidence.findMany', { where: { noteId: 'n', status: { not: 'invalid' } } }]
      );
      const versions = f.calls.findIndex(([name]) => name === 'noteVersion.findMany');
      const questions = f.calls.findIndex(([name]) => name === 'questionSource.findMany');
      assert.ok(versions > 0 && questions > versions, '删除先取全部版本，再失效题目来源');
      assert.deepEqual(f.calls[questions][1].where.sourceId.in, ['old', f.currentVersion().id]);
      f.scopeRows.push({ id: 'scope', noteVersions: [{ noteId: 'n' }], createdAt: f.now, updatedAt: f.now });
      f.calls.length = 0;
      await assert.rejects(f.module.noteService.permanentlyDeleteNote('n'), permanentErrors.scope);
      assert.deepEqual(
        f.calls
          .filter(([name]) =>
            [
              'knowledgeEvidence.findMany',
              'noteVersion.findMany',
              'questionSource.findMany',
              'analysisScopeSnapshot.findMany'
            ].includes(name)
          )
          .map(([name]) => name),
        [
          'knowledgeEvidence.findMany',
          'noteVersion.findMany',
          'questionSource.findMany',
          'analysisScopeSnapshot.findMany'
        ]
      );
      assert.equal(
        f.calls.some(([name]) => name === 'note.delete'),
        false
      );
      f.scopeRows.length = 0;
      f.calls.length = 0;
      assert.equal((await f.module.noteService.permanentlyDeleteNote('n')).id, 'n');
      assert.equal(f.calls.at(-1)[0], 'note.delete');
      assert.equal(f.transactions.length, 4, '每个入口只开启一个事务');
      assert.ok(f.transactions.every(options => options.isolationLevel === 'Serializable'));
    }
  }
);

function postgresModuleFixture() {
  const repositoryNames = [
    'note',
    'folder',
    'tag',
    'tagGroup',
    'knowledgeSpace',
    'contentAnnotation',
    'pdfAnnotation',
    'annotationExclusion',
    'annotationRevision',
    'analysisScope',
    'noteVersion',
    'knowledgeItem',
    'knowledgeEvidence',
    'knowledgeArtifactProvenance',
    'learningObjective',
    'examProfile',
    'examFocus',
    'question',
    'questionObjective',
    'questionSource'
  ];
  const calls = [],
    transactions = [],
    scopeRows = [];
  const now = new Date('2026-01-01T00:00:00.000Z');
  let row = {
    id: 'n',
    spaceId: 's',
    title: 'PG 合成生命周期',
    rawMarkdown: 'before',
    contentHash: 'a'.repeat(64),
    folderId: null,
    noteTags: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    status: 'draft',
    sourceType: 'manual'
  };
  const old = {
    id: 'old',
    noteId: 'n',
    content: 'before',
    contentHash: 'a'.repeat(64),
    createdAt: now,
    createdBy: 'user'
  };
  let current = null;
  const record =
    (name, operation = () => []) =>
    async args => {
      calls.push([name, structuredClone(args)]);
      return operation(args);
    };
  const models = repositoryNames.map(name => (name === 'analysisScope' ? 'analysisScopeSnapshot' : name));
  const db = Object.fromEntries(models.map(name => [name, {}]));
  db.note = {
    findUnique: record('note.findUnique', () => row),
    updateMany: record('note.updateMany', ({ data }) => {
      row = { ...row, ...data };
      return { count: 1 };
    }),
    delete: record('note.delete', () => {
      const deleted = row;
      row = null;
      return deleted;
    })
  };
  db.noteTag = { deleteMany: record('noteTag.deleteMany', () => ({ count: 0 })) };
  db.noteVersion = {
    findUnique: record('noteVersion.findUnique', ({ where }) =>
      where.id === 'old'
        ? old
        : current && where.noteId_contentHash?.contentHash === current.contentHash
          ? current
          : null
    ),
    create: record('noteVersion.create', ({ data }) => {
      current = data;
      return data;
    }),
    findMany: record('noteVersion.findMany', () => (current ? [old, current] : [old]))
  };
  db.contentAnnotation.findMany = record('contentAnnotation.findMany');
  db.knowledgeEvidence.findMany = record('knowledgeEvidence.findMany');
  db.questionSource.findMany = record('questionSource.findMany');
  db.analysisScopeSnapshot.findMany = record('analysisScopeSnapshot.findMany', () => scopeRows);
  const outerNote = () =>
    row && {
      ...row,
      deleted: Boolean(row.deletedAt),
      tagIds: [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  const repositories = Object.fromEntries(
    repositoryNames.map(name => [
      `${name}Repository`,
      new Proxy(
        { supportsAsync: true },
        {
          get(target, key) {
            if (key in target) return target[key];
            return () => {
              throw new Error(`事务 hook 误用了顶层 ${name}.${String(key)}`);
            };
          }
        }
      )
    ])
  );
  Object.assign(repositories.noteRepository, { findById: async () => outerNote(), list: async () => [outerNote()] });
  Object.assign(repositories.knowledgeSpaceRepository, { findById: async () => ({ id: 's' }) });
  Object.assign(repositories.folderRepository, { list: async () => [] });
  Object.assign(repositories.tagRepository, { findByIds: async () => [] });
  const module = createPostgresKnowledgeModule({
    ...repositories,
    client: {
      async $transaction(operation, options) {
        transactions.push(options);
        return operation(db);
      }
    }
  });
  return { module, calls, transactions, scopeRows, now, currentVersion: () => current };
}
