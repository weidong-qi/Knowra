import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createAsyncNoteService } from '../src/modules/knowledge/application/postgres-async/note-service.js';
import { createInMemoryNoteRepository } from '../src/modules/knowledge/infrastructure/note-repository.js';
import { createPostgresKnowledgeModule } from '../src/modules/knowledge/postgres-async-module.js';
import { createPostgresKnowledgeHttpHandlers } from '../src/modules/knowledge/http/postgres-async-handlers.js';
import { handleNoteRoute } from '../src/modules/knowledge/http/note-routes.js';
import {
  marksOnlyDependencies,
  withInlineAnnotations
} from '../src/modules/knowledge/application/inline-annotations.js';

// 准确实际父源文和独立固定 oracle；普通运行不读取 Git，也不从候选派生预期值。
export const lifecycleParent = '31b449f26c7c009187e0eb910ce4cb627d4174fb';
export const lifecycleFrozenSource =
  "import { conflictError } from '../knowledge-errors.js';\n\n/** 只使用调用者装配的事务内依赖；标注服务仍在正文变更时惰性创建。 */\nexport function createAsyncNoteDependencyLifecycle({\n  createAnnotationService, contentAnnotationRepository, noteVersionRepository,\n  knowledgeEvidenceRepository, questionSourceRepository, analysisScopeRepository,\n  knowledgeItemService, questionService\n}) {\n  return {\n    onNoteContentChanged: async (note, version, annotationChange) => {\n      const transactionAnnotationService = createAnnotationService();\n      const reconciliation = await transactionAnnotationService.reconcileForNote(note.id, version.contentHash, annotationChange);\n      const changed = [];\n      for (const annotationId of reconciliation.contentChangedAnnotationIds) {\n        const annotation = await contentAnnotationRepository.findById(annotationId);\n        changed.push(...await knowledgeItemService.markEvidenceByAnnotationId(annotationId,\n          annotation?.anchorStatus === 'missing' ? 'insufficient' : 'stale'));\n      }\n      await questionService.markSourcesStale('knowledgeEvidence', changed.map((evidence) => evidence.id));\n      const oldVersionIds = (await noteVersionRepository.listIds({ noteId: note.id })).filter((id) => id !== version.id);\n      const directEvidence = await knowledgeItemService.markEvidenceByNoteVersionIds(oldVersionIds, 'stale', 'noteVersion');\n      await questionService.markSourcesStale('knowledgeEvidence', directEvidence.map((record) => record.id));\n      await questionService.markSourcesStale('noteVersion', oldVersionIds);\n    },\n    onNoteDeleted: async (noteId) => {\n      const changed = await knowledgeItemService.markEvidenceByNoteId(noteId, 'invalid');\n      await questionService.markSourcesStale('knowledgeEvidence', changed.map((evidence) => evidence.id));\n      const versions = await noteVersionRepository.list({ noteId });\n      await questionService.markSourcesStale(\n        'noteVersion',\n        versions.map((version) => version.id)\n      );\n    },\n    onBeforePermanentDelete: async (noteId) => {\n      if ((await knowledgeEvidenceRepository.list({ noteId })).length > 0) {\n        throw conflictError(\n          'NOTE_HAS_KNOWLEDGE_EVIDENCE',\n          'Note has formal knowledge evidence and cannot be permanently deleted'\n        );\n      }\n      const versions = await noteVersionRepository.list({ noteId });\n      const versionIds = new Set(versions.map((version) => version.id));\n      const sources = await questionSourceRepository.list();\n      if (sources.some((source) => (\n        source.sourceType === 'noteVersion'\n        && versionIds.has(source.sourceId)\n      ))) {\n        throw conflictError(\n          'NOTE_HAS_QUESTION_SOURCE',\n          'Note has a formal question source and cannot be permanently deleted'\n        );\n      }\n      const snapshots = await analysisScopeRepository.list();\n      if (snapshots.some((snapshot) => snapshot.noteVersions?.some((version) => (version.noteId === noteId || versionIds.has(version.noteVersionId))))) {\n        throw conflictError('NOTE_HAS_ANALYSIS_SCOPE', 'NoteVersion is referenced by an analysis scope snapshot and cannot be deleted');\n      }\n    }\n  };\n}\n";
export const hash = value => createHash('sha256').update(value).digest('hex');
export function lifecycleContractCases(subject) {
  const factory = subject.createAsyncNoteDependencyLifecycle;
  const rows = [];
  const check = (name, run) => rows.push({ name, run });
  const n = { id: 'n' },
    v = { id: 'v', contentHash: 'h' },
    change = { sentinel: true };
  function fixture(mode = 'sync', overrides = {}, failAt = 0) {
    const calls = [],
      marker = { failure: true };
    let pending = false;
    const data = {
      annotationIds: ['a', 'b', 'a'],
      annotations: new Map([
        ['a', { anchorStatus: 'missing' }],
        ['b', { anchorStatus: 'resolved' }]
      ]),
      versions: [{ id: 'old' }, { id: 'v' }, { id: 'old' }],
      evidence: [],
      sources: [],
      scopes: [],
      annotationEvidence: id => [{ id: 'e-' + String(id) }],
      directEvidence: [{ id: 'd' }],
      deletedEvidence: [{ id: 'x' }],
      ...overrides
    };
    const call = (name, fn, sync = false) =>
      function (...args) {
        assert.equal(pending, false);
        calls.push([name, ...args]);
        const at = calls.length;
        const act = () => {
          if (at === failAt) throw marker;
          return fn(...args);
        };
        if (sync || mode === 'sync') return act();
        pending = true;
        const settle = () => {
          pending = false;
          return act();
        };
        if (mode === 'promise') {
          const result = Promise.resolve().then(settle);
          result.catch(() => {});
          return result;
        }
        return {
          then(resolve, reject) {
            queueMicrotask(() => {
              try {
                resolve(settle());
              } catch (e) {
                reject(e);
              }
            });
          }
        };
      };
    const annotations = {
      reconcileForNote: call('reconcile', () => ({ contentChangedAnnotationIds: data.annotationIds }))
    };
    const deps = {
      createAnnotationService: call('create', () => annotations, true),
      contentAnnotationRepository: { findById: call('find', id => data.annotations.get(id)) },
      noteVersionRepository: {
        listIds: call('ids', () => data.versions.map(x => x.id)),
        list: call('versions', () => data.versions)
      },
      knowledgeEvidenceRepository: { list: call('evidence', () => data.evidence) },
      questionSourceRepository: { list: call('sources', () => data.sources) },
      analysisScopeRepository: { list: call('scopes', () => data.scopes) },
      knowledgeItemService: {
        markEvidenceByAnnotationId: call('markAnnotation', id => data.annotationEvidence(id)),
        markEvidenceByNoteVersionIds: call('markVersions', () => data.directEvidence),
        markEvidenceByNoteId: call('markNote', () => data.deletedEvidence)
      },
      questionService: { markSourcesStale: call('stale', () => ({ ignored: true })) }
    };
    const lifecycle = factory(deps);
    return { calls, marker, data, deps, lifecycle, annotations };
  }
  const changed = [
    ['create'],
    ['reconcile', 'n', 'h', change],
    ['find', 'a'],
    ['markAnnotation', 'a', 'insufficient'],
    ['find', 'b'],
    ['markAnnotation', 'b', 'stale'],
    ['find', 'a'],
    ['markAnnotation', 'a', 'insufficient'],
    ['stale', 'knowledgeEvidence', ['e-a', 'e-b', 'e-a']],
    ['ids', { noteId: 'n' }],
    ['markVersions', ['old', 'old'], 'stale', 'noteVersion'],
    ['stale', 'knowledgeEvidence', ['d']],
    ['stale', 'noteVersion', ['old', 'old']]
  ];
  const deleted = [
    ['markNote', 'n', 'invalid'],
    ['stale', 'knowledgeEvidence', ['x']],
    ['versions', { noteId: 'n' }],
    ['stale', 'noteVersion', ['old', 'v', 'old']]
  ];
  const before = [['evidence', { noteId: 'n' }], ['versions', { noteId: 'n' }], ['sources'], ['scopes']];
  check('shape, factory arity, no eager service creation, all three async arities', () => {
    const f = fixture();
    assert.equal(factory.length, 1);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(Object.keys(f.lifecycle), ['onNoteContentChanged', 'onNoteDeleted', 'onBeforePermanentDelete']);
    for (const [k, a] of [
      ['onNoteContentChanged', 3],
      ['onNoteDeleted', 1],
      ['onBeforePermanentDelete', 1]
    ]) {
      assert.equal(f.lifecycle[k].length, a);
      assert.equal(f.lifecycle[k].constructor.name, 'AsyncFunction');
    }
  });
  check('missing options sync failure, missing captured ports lazy rejected failures', async () => {
    assert.throws(() => factory(), TypeError);
    const x = factory({});
    await assert.rejects(x.onNoteDeleted('n'), TypeError);
  });
  for (const mode of ['sync', 'promise', 'thenable']) {
    for (const [hook, args, expected] of [
      ['onNoteContentChanged', [n, v, change], changed],
      ['onNoteDeleted', ['n'], deleted],
      ['onBeforePermanentDelete', ['n'], before]
    ]) {
      check(mode + ' ' + hook + ' exact ordered values and void result', async () => {
        const f = fixture(mode);
        assert.equal(await f.lifecycle[hook](...args), undefined);
        assert.deepEqual(f.calls, expected);
      });
      for (let failAt = 1; failAt <= expected.length; failAt++)
        check(mode + ' ' + hook + ' failure ' + failAt, async () => {
          const f = fixture(mode, {}, failAt);
          let promise;
          assert.doesNotThrow(() => (promise = f.lifecycle[hook](...args)));
          await assert.rejects(promise, e => e === f.marker);
          assert.deepEqual(f.calls, expected.slice(0, failAt));
        });
    }
  }
  for (const [data, code, count] of [
    [{ evidence: [{}], sources: [null], scopes: [null] }, 'NOTE_HAS_KNOWLEDGE_EVIDENCE', 1],
    [
      { sources: [{ sourceType: 'noteVersion', sourceId: 'old' }, null], scopes: [null] },
      'NOTE_HAS_QUESTION_SOURCE',
      3
    ],
    [{ scopes: [{ noteVersions: [{ noteId: 'n' }, null] }, null] }, 'NOTE_HAS_ANALYSIS_SCOPE', 4],
    [{ scopes: [{ noteVersions: [{ noteId: 'other', noteVersionId: 'old' }] }] }, 'NOTE_HAS_ANALYSIS_SCOPE', 4]
  ])
    check('permanent conflict priority ' + code + JSON.stringify(data), async () => {
      const f = fixture('thenable', data);
      await assert.rejects(f.lifecycle.onBeforePermanentDelete('n'), e => e.code === code && e.statusCode === 409);
      assert.deepEqual(f.calls, before.slice(0, count));
    });
  check('all nullish optional nested scope lists permit deletion', async () => {
    const f = fixture('sync', {
      scopes: [{}, { noteVersions: null }, { noteVersions: undefined }],
      sources: [{ sourceType: 'not-version', sourceId: 'old' }]
    });
    await f.lifecycle.onBeforePermanentDelete('n');
    assert.deepEqual(f.calls, before);
  });
  check('SameValueZero version membership preserves NaN and object identity', async () => {
    for (const id of [NaN, Symbol('v'), {}]) {
      const f = fixture('sync', { versions: [{ id }], sources: [{ sourceType: 'noteVersion', sourceId: id }] });
      await assert.rejects(f.lifecycle.onBeforePermanentDelete({}), e => e.code === 'NOTE_HAS_QUESTION_SOURCE');
    }
  });
  check('strict ID comparison does not stringify numeric/string', async () => {
    const f = fixture('sync', {
      versions: [{ id: 1 }],
      sources: [{ sourceType: 'noteVersion', sourceId: '1' }],
      scopes: [{ noteVersions: [{ noteId: '1' }] }]
    });
    await f.lifecycle.onBeforePermanentDelete(1);
  });
  check('NaN current id is not excluded by strict inequality', async () => {
    const f = fixture('sync', { annotationIds: [], versions: [{ id: NaN }] });
    await f.lifecycle.onNoteContentChanged(n, { id: NaN, contentHash: undefined }, change);
    assert.deepEqual(f.calls.find(x => x[0] === 'markVersions')[1], [NaN]);
  });
  check('no changed annotations still sends all empty notifications', async () => {
    const f = fixture('sync', { annotationIds: [], versions: [], directEvidence: [] });
    await f.lifecycle.onNoteContentChanged(n, v, change);
    assert.deepEqual(
      f.calls.map(x => x[0]),
      ['create', 'reconcile', 'stale', 'ids', 'markVersions', 'stale', 'stale']
    );
  });
  check('lazy synchronous service factory called once per content invocation, never deletion', async () => {
    const f = fixture();
    await f.lifecycle.onNoteDeleted('n');
    await f.lifecycle.onBeforePermanentDelete('n');
    assert.equal(f.calls.filter(x => x[0] === 'create').length, 0);
    await f.lifecycle.onNoteContentChanged(n, v, change);
    await f.lifecycle.onNoteContentChanged(n, v, change);
    assert.equal(f.calls.filter(x => x[0] === 'create').length, 2);
  });
  check('for-of accepts Set and custom one-shot iterable without materialization', async () => {
    let reads = 0;
    const ids = {
      *[Symbol.iterator]() {
        reads++;
        yield 'a';
        yield 'b';
      }
    };
    const f = fixture('sync', { annotationIds: ids, annotationEvidence: id => new Set([{ id }]) });
    await f.lifecycle.onNoteContentChanged(n, v, change);
    assert.equal(reads, 1);
    assert.deepEqual(f.calls.find(x => x[0] === 'stale')[2], ['a', 'b']);
  });
  check('sparse annotation ID iteration includes undefined', async () => {
    const ids = [];
    ids[1] = 'a';
    const f = fixture('sync', { annotationIds: ids });
    await f.lifecycle.onNoteContentChanged(n, v, change);
    assert.deepEqual(f.calls[2], ['find', undefined]);
  });
  check('sparse spread evidence fails only later at changed.map', async () => {
    const a = [];
    a[1] = { id: 'ok' };
    const f = fixture('sync', { annotationIds: ['a'], annotationEvidence: () => a });
    await assert.rejects(f.lifecycle.onNoteContentChanged(n, v, change), TypeError);
    assert.equal(f.calls.at(-1)[0], 'markAnnotation');
  });
  check('noniterable annotation evidence fails at original spread', async () => {
    const f = fixture('sync', { annotationIds: ['a'], annotationEvidence: () => ({ id: 'single' }) });
    await assert.rejects(f.lifecycle.onNoteContentChanged(n, v, change), TypeError);
    assert.equal(f.calls.at(-1)[0], 'markAnnotation');
  });
  check('object identities and arbitrary fields are not stringified or validated', async () => {
    const id = {},
      hash = Symbol(),
      annotationId = {};
    const f = fixture('sync', { annotationIds: [annotationId], annotationEvidence: () => [{ id: annotationId }] });
    f.data.annotations.set(annotationId, { anchorStatus: 'missing' });
    await f.lifecycle.onNoteContentChanged({ id }, { id: 0, contentHash: hash }, change);
    assert.equal(f.calls[1][1], id);
    assert.equal(f.calls[1][2], hash);
    assert.equal(f.calls[2][1], annotationId);
    assert.equal(f.calls.find(x => x[0] === 'stale')[2][0], annotationId);
  });
  check('note/version getters repeat in original order and per filter callback', async () => {
    const trace = [],
      f = fixture('sync', { annotationIds: [], versions: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const note = {
      get id() {
        trace.push('note.id');
        return 'n';
      }
    };
    const version = {
      get contentHash() {
        trace.push('version.hash');
        return 'h';
      },
      get id() {
        trace.push('version.id');
        return 2;
      }
    };
    await f.lifecycle.onNoteContentChanged(note, version, change);
    assert.deepEqual(trace, ['note.id', 'version.hash', 'note.id', 'version.id', 'version.id', 'version.id']);
    assert.deepEqual(f.calls.find(x => x[0] === 'markVersions')[1], [1, 3]);
  });
  check('captured ports, late method lookup and receiver preservation', async () => {
    const f = fixture();
    let count = 0;
    f.deps.questionService.markSourcesStale = function () {
      assert.equal(this, f.deps.questionService);
      count++;
    };
    f.annotations.reconcileForNote = function () {
      assert.equal(this, f.annotations);
      f.deps.noteVersionRepository.listIds = function () {
        assert.equal(this, f.deps.noteVersionRepository);
        return [];
      };
      return { contentChangedAnnotationIds: [] };
    };
    await f.lifecycle.onNoteContentChanged(n, v, change);
    assert.equal(count, 3);
  });
  check('custom some truthiness and receiver preserved', async () => {
    let called = 0;
    const some = {
      some(fn) {
        called++;
        assert.equal(this, some);
        assert.equal(typeof fn, 'function');
        return { truthy: true };
      }
    };
    const f = fixture('sync', { sources: some });
    await assert.rejects(f.lifecycle.onBeforePermanentDelete('n'), e => e.code === 'NOTE_HAS_QUESTION_SOURCE');
    assert.equal(called, 1);
  });
  check('custom map/filter method lookup and receiver preserved', async () => {
    const f = fixture('sync', { annotationIds: [] });
    let filters = 0,
      maps = 0;
    const ids = {
      filter(fn) {
        filters++;
        assert.equal(this, ids);
        assert.equal(fn('v'), false);
        return ['z'];
      }
    };
    const mapped = {
      map(fn) {
        maps++;
        assert.equal(this, mapped);
        return [fn({ id: 'direct' })];
      }
    };
    f.deps.noteVersionRepository.listIds = () => ids;
    f.data.directEvidence = mapped;
    await f.lifecycle.onNoteContentChanged(n, v, change);
    assert.equal(filters, 1);
    assert.equal(maps, 1);
    assert.deepEqual(f.calls.find(x => x[0] === 'markVersions')[1], ['z']);
  });
  check('unawaited annotation factory Promise fails before reconcile and remains rejected', async () => {
    const f = fixture();
    f.deps.createAnnotationService = () => Promise.resolve(f.annotations);
    const lifecycle = factory(f.deps);
    await assert.rejects(lifecycle.onNoteContentChanged(n, v, change), TypeError);
    assert.deepEqual(f.calls, []);
  });
  check('old-version array is reused after collaborator mutation', async () => {
    const f = fixture('sync', { annotationIds: [] });
    let sent;
    f.deps.knowledgeItemService.markEvidenceByNoteVersionIds = ids => {
      sent = ids;
      ids.push('later');
      return [];
    };
    await f.lifecycle.onNoteContentChanged(n, v, change);
    const final = f.calls.at(-1);
    assert.equal(final[0], 'stale');
    assert.equal(final[2], sent);
    assert.deepEqual(sent, ['old', 'old', 'later']);
  });
  check('annotation service method, note fields and then getter errors retain identity', async () => {
    for (const which of ['factory', 'method', 'note', 'then']) {
      const f = fixture();
      let lifecycle = f.lifecycle,
        note = n;
      const marker = { which };
      if (which === 'factory') {
        Object.defineProperty(f.deps, 'createAnnotationService', {
          get() {
            throw marker;
          }
        });
        assert.throws(
          () => factory(f.deps),
          e => e === marker
        );
        continue;
      }
      if (which === 'method')
        Object.defineProperty(f.annotations, 'reconcileForNote', {
          get() {
            throw marker;
          }
        });
      if (which === 'note')
        note = {
          get id() {
            throw marker;
          }
        };
      if (which === 'then')
        f.annotations.reconcileForNote = () => ({
          get then() {
            throw marker;
          }
        });
      await assert.rejects(lifecycle.onNoteContentChanged(note, v, change), e => e === marker);
    }
  });
  check('only exact missing anchor status is insufficient; missing/null/other statuses remain stale', async () => {
    for (const annotation of [
      undefined,
      null,
      {},
      { anchorStatus: null },
      { anchorStatus: false },
      { anchorStatus: 'resolved' },
      { anchorStatus: 'MISSING' },
      { anchorStatus: { toString: () => 'missing' } }
    ]) {
      const f = fixture('sync', { annotationIds: ['x'] });
      f.data.annotations.set('x', annotation);
      await f.lifecycle.onNoteContentChanged(n, v, change);
      assert.deepEqual(f.calls[3], ['markAnnotation', 'x', 'stale']);
    }
  });
  check('all conflict messages and status codes retain exact original values', async () => {
    for (const [overrides, code, message] of [
      [
        { evidence: [{}] },
        'NOTE_HAS_KNOWLEDGE_EVIDENCE',
        'Note has formal knowledge evidence and cannot be permanently deleted'
      ],
      [
        { sources: [{ sourceType: 'noteVersion', sourceId: 'old' }] },
        'NOTE_HAS_QUESTION_SOURCE',
        'Note has a formal question source and cannot be permanently deleted'
      ],
      [
        { scopes: [{ noteVersions: [{ noteId: 'n' }] }] },
        'NOTE_HAS_ANALYSIS_SCOPE',
        'NoteVersion is referenced by an analysis scope snapshot and cannot be deleted'
      ]
    ]) {
      const f = fixture('sync', overrides);
      await assert.rejects(
        f.lifecycle.onBeforePermanentDelete('n'),
        e => e.name === 'AppError' && e.code === code && e.message === message && e.statusCode === 409
      );
    }
  });
  check('captured dependency objects do not switch when original options properties change', async () => {
    const f = fixture();
    f.deps.questionService = {
      markSourcesStale() {
        assert.fail('must use captured object');
      }
    };
    f.deps.createAnnotationService = () => {
      assert.fail('must use captured factory');
    };
    await f.lifecycle.onNoteContentChanged(n, v, change);
    assert.deepEqual(f.calls, changed);
  });
  check('synchronous annotation factory is neither awaited nor then-inspected', async () => {
    const f = fixture('sync', { annotationIds: [] });
    Object.defineProperty(f.annotations, 'then', {
      get() {
        return assert.fail('factory result then getter must remain unread');
      }
    });
    await f.lifecycle.onNoteContentChanged(n, v, change);
    assert.equal(f.calls[0][0], 'create');
  });
  check(
    'service factory stays an unbound direct call, every repository and service method keeps its receiver',
    async () => {
      const f = fixture(),
        events = [];
      for (const port of [
        'contentAnnotationRepository',
        'noteVersionRepository',
        'knowledgeEvidenceRepository',
        'questionSourceRepository',
        'analysisScopeRepository',
        'knowledgeItemService',
        'questionService'
      ]) {
        const target = f.deps[port];
        for (const name of Object.keys(target)) {
          const original = target[name];
          target[name] = function (...args) {
            assert.equal(this, target);
            events.push(name);
            return original(...args);
          };
        }
      }
      const reconcile = f.annotations.reconcileForNote;
      f.annotations.reconcileForNote = function (...args) {
        assert.equal(this, f.annotations);
        return reconcile(...args);
      };
      f.deps.createAnnotationService = function () {
        assert.equal(this, undefined);
        return f.annotations;
      };
      const lifecycle = factory(f.deps);
      await lifecycle.onNoteContentChanged(n, v, change);
      await lifecycle.onNoteDeleted('n');
      await lifecycle.onBeforePermanentDelete('n');
      assert.ok(events.includes('listIds') && events.includes('markEvidenceByNoteId'));
    }
  );
  check('dependency methods are not read at construction or before previous awaited completion', async () => {
    const f = fixture('sync', { annotationIds: [] }),
      events = [];
    let release;
    f.annotations.reconcileForNote = () => ({
      then(resolve) {
        events.push('reconcile:pending');
        release = resolve;
      }
    });
    const original = f.deps.questionService.markSourcesStale;
    Object.defineProperty(f.deps.questionService, 'markSourcesStale', {
      get() {
        events.push('question:get');
        return original;
      }
    });
    const lifecycle = factory(f.deps);
    assert.deepEqual(events, []);
    const pending = lifecycle.onNoteContentChanged(n, v, change);
    pending.catch(() => {});
    try {
      for (let i = 0; i < 8; i++) await Promise.resolve();
      assert.deepEqual(events, ['reconcile:pending']);
      release({ contentChangedAnnotationIds: [] });
      await pending;
      assert.deepEqual(events, ['reconcile:pending', 'question:get', 'question:get', 'question:get']);
    } finally {
      release?.({ contentChangedAnnotationIds: [] });
      await pending.catch(() => {});
    }
  });
  check('thenable completion can replace later methods and late version ID reads', async () => {
    const f = fixture('sync', { annotationIds: [] }),
      events = [];
    let current = 'old';
    const version = {
      get id() {
        events.push('version.id');
        return current;
      },
      contentHash: 'h'
    };
    f.annotations.reconcileForNote = () => ({
      then(resolve) {
        current = 'v';
        f.deps.noteVersionRepository.listIds = function () {
          assert.equal(this, f.deps.noteVersionRepository);
          events.push('new.ids');
          return ['old', 'v'];
        };
        resolve({ contentChangedAnnotationIds: [] });
      }
    });
    await f.lifecycle.onNoteContentChanged(n, version, change);
    assert.deepEqual(events, ['new.ids', 'version.id', 'version.id']);
    assert.deepEqual(f.calls.find(x => x[0] === 'markVersions')[1], ['old']);
  });
  check('note ID and version ID getters may change between the original repeated reads', async () => {
    const f = fixture('sync', { annotationIds: [], versions: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    let notes = 0,
      versions = 0;
    await f.lifecycle.onNoteContentChanged(
      {
        get id() {
          return ++notes;
        }
      },
      {
        get id() {
          return ++versions;
        },
        contentHash: 'h'
      },
      change
    );
    assert.equal(f.calls[1][1], 1);
    assert.deepEqual(f.calls.find(x => x[0] === 'ids')[1], { noteId: 2 });
    assert.deepEqual(f.calls.find(x => x[0] === 'markVersions')[1], []);
    assert.equal(notes, 2);
    assert.equal(versions, 3);
  });
  check('sparse lists preserve native filter/map/some holes instead of materializing undefined', async () => {
    const f = fixture('sync', { annotationIds: [] });
    const ids = [];
    ids[2] = 'old';
    f.deps.noteVersionRepository.listIds = () => ids;
    await f.lifecycle.onNoteContentChanged(n, v, change);
    assert.deepEqual(f.calls.find(x => x[0] === 'markVersions')[1], ['old']);
    const versions = [];
    versions[2] = { id: 'old' };
    f.data.versions = versions;
    f.calls.length = 0;
    await f.lifecycle.onNoteDeleted('n');
    assert.equal(f.calls.at(-1)[2].length, 3);
    assert.equal(0 in f.calls.at(-1)[2], false);
    f.data.sources = new Array(3);
    f.data.scopes = [{ noteVersions: new Array(3) }];
    await f.lifecycle.onBeforePermanentDelete('n');
  });
  check('one-shot annotation iterator stays interleaved with fully awaited work', async () => {
    const events = [],
      f = fixture('thenable', { annotationIds: [] });
    let iteratorCount = 0;
    f.data.annotationIds = {
      *[Symbol.iterator]() {
        assert.equal(++iteratorCount, 1);
        events.push('yield:a');
        yield 'a';
        events.push('yield:b');
        yield 'b';
        events.push('done');
      }
    };
    f.deps.knowledgeItemService.markEvidenceByAnnotationId = id => ({
      then(resolve) {
        events.push('settle:' + id);
        resolve([{ id }]);
      }
    });
    await f.lifecycle.onNoteContentChanged(n, v, change);
    assert.deepEqual(events, ['yield:a', 'settle:a', 'yield:b', 'settle:b', 'done']);
  });
  check('sparse annotation evidence does not skip holes or switch spread to flatMap', async () => {
    const sparse = [];
    sparse[1] = { id: 'valid' };
    const f = fixture('sync', { annotationIds: ['a', 'b'], annotationEvidence: () => sparse });
    await assert.rejects(f.lifecycle.onNoteContentChanged(n, v, change), TypeError);
    assert.deepEqual(
      f.calls.map(x => x[0]),
      ['create', 'reconcile', 'find', 'markAnnotation', 'find', 'markAnnotation']
    );
  });
  check('only noteVersion source type reads sourceId and scope noteId match short circuits version ID', async () => {
    const f = fixture('sync', {
      sources: [
        {
          sourceType: 'knowledgeEvidence',
          get sourceId() {
            return assert.fail('sourceId short circuit');
          }
        }
      ],
      scopes: [
        {
          noteVersions: [
            {
              noteId: 'n',
              get noteVersionId() {
                return assert.fail('scope short circuit');
              }
            },
            null
          ]
        },
        null
      ]
    });
    await assert.rejects(f.lifecycle.onBeforePermanentDelete('n'), e => e.code === 'NOTE_HAS_ANALYSIS_SCOPE');
  });
  check('custom length, version map and nested some views keep receiver and original truthiness', async () => {
    const f = fixture('sync', { evidence: { length: '1' } });
    await assert.rejects(f.lifecycle.onBeforePermanentDelete('n'), e => e.code === 'NOTE_HAS_KNOWLEDGE_EVIDENCE');
    for (const length of [-1, NaN, undefined, '0']) {
      f.data.evidence = { length };
      await f.lifecycle.onBeforePermanentDelete('n');
    }
    let maps = 0,
      nested = 0;
    const versions = {
      map(fn) {
        assert.equal(this, versions);
        maps++;
        return [fn({ id: 'old' })];
      }
    };
    f.data.versions = versions;
    const noteVersions = {
      some(fn) {
        assert.equal(this, noteVersions);
        nested++;
        assert.equal(fn({ noteId: 'foreign', noteVersionId: 'old' }), true);
        return 'truthy';
      }
    };
    f.data.scopes = [{ noteVersions }];
    await assert.rejects(f.lifecycle.onBeforePermanentDelete('n'), e => e.code === 'NOTE_HAS_ANALYSIS_SCOPE');
    assert.equal(maps, 1);
    assert.equal(nested, 1);
  });
  check('custom map result is sent unchanged without validation or Array conversion', async () => {
    const f = fixture('sync', { annotationIds: [] }),
      token = { arbitrary: true };
    const view = {
      map(fn) {
        assert.equal(this, view);
        assert.equal(fn({ id: 'x' }), 'x');
        return token;
      }
    };
    f.data.directEvidence = view;
    f.data.deletedEvidence = view;
    await f.lifecycle.onNoteContentChanged(n, v, change);
    assert.equal(f.calls.at(-2)[2], token);
    f.calls.length = 0;
    await f.lifecycle.onNoteDeleted('n');
    assert.equal(f.calls[1][2], token);
  });
  for (const [hook, args, port, method] of [
    ['onNoteContentChanged', [n, v, change], 'contentAnnotationRepository', 'findById'],
    ['onNoteContentChanged', [n, v, change], 'noteVersionRepository', 'listIds'],
    ['onNoteContentChanged', [n, v, change], 'knowledgeItemService', 'markEvidenceByAnnotationId'],
    ['onNoteContentChanged', [n, v, change], 'knowledgeItemService', 'markEvidenceByNoteVersionIds'],
    ['onNoteContentChanged', [n, v, change], 'questionService', 'markSourcesStale'],
    ['onNoteDeleted', ['n'], 'knowledgeItemService', 'markEvidenceByNoteId'],
    ['onNoteDeleted', ['n'], 'noteVersionRepository', 'list'],
    ['onBeforePermanentDelete', ['n'], 'knowledgeEvidenceRepository', 'list'],
    ['onBeforePermanentDelete', ['n'], 'noteVersionRepository', 'list'],
    ['onBeforePermanentDelete', ['n'], 'questionSourceRepository', 'list'],
    ['onBeforePermanentDelete', ['n'], 'analysisScopeRepository', 'list']
  ])
    for (const failure of ['method-get', 'then-get', 'nested-reject'])
      check(`${hook} ${port}.${method} ${failure} preserves exact thrown object`, async () => {
        const f = fixture(),
          marker = { hook, method, failure },
          target = f.deps[port];
        const methodValue = () =>
          failure === 'then-get'
            ? {
                get then() {
                  throw marker;
                }
              }
            : {
                then(resolve) {
                  resolve({
                    then(_resolve, reject) {
                      reject(marker);
                    }
                  });
                }
              };
        Object.defineProperty(target, method, {
          get() {
            if (failure === 'method-get') throw marker;
            return methodValue;
          }
        });
        await assert.rejects(f.lifecycle[hook](...args), e => e === marker);
      });
  check(
    'final notification is awaited through nested thenables, ignores duplicate settlements and returns void',
    async () => {
      const f = fixture('sync', { annotationIds: [] }),
        events = [];
      const outer = {
        get then() {
          events.push('outer:get');
          return function (resolve, reject) {
            assert.equal(this, outer);
            events.push('outer:call');
            resolve({
              then(done) {
                events.push('inner:call');
                done({ ignored: true });
              }
            });
            reject(Error('ignored'));
            throw Error('ignored');
          };
        }
      };
      f.deps.questionService.markSourcesStale = type => (type !== 'noteVersion' ? 17 : outer);
      assert.equal(await f.lifecycle.onNoteContentChanged(n, v, change), undefined);
      assert.deepEqual(events, ['outer:get', 'outer:call', 'inner:call']);
    }
  );
  check(
    'strict content version inequality separates numeric and string IDs and boxed source types are ignored',
    async () => {
      const f = fixture('sync', {
        annotationIds: [],
        versions: [{ id: 1 }, { id: '1' }],
        sources: [{ sourceType: { toString: () => 'noteVersion' }, sourceId: 1 }]
      });
      await f.lifecycle.onNoteContentChanged(n, { id: '1', contentHash: 'h' }, change);
      assert.deepEqual(f.calls.find(x => x[0] === 'markVersions')[1], [1]);
      await f.lifecycle.onBeforePermanentDelete('n');
    }
  );
  return rows;
}

export function lifecycleConsumerCases(subject) {
  const rows = [],
    check = (name, run) => rows.push({ name, run });
  for (const mode of ['sync', 'promise', 'thenable'])
    check(
      `${mode}: actual async note service and in-memory repository reach lifecycle through route handlers`,
      async () => {
        const convert = x =>
          mode === 'sync'
            ? x
            : mode === 'promise'
              ? Promise.resolve(x)
              : {
                  then(resolve) {
                    resolve(x);
                  }
                };
        const calls = [],
          evidence = [];
        const deps = {
          createAnnotationService: () => ({
            reconcileForNote: (...args) => {
              calls.push(['reconcile', ...args]);
              return convert({ contentChangedAnnotationIds: [] });
            }
          }),
          contentAnnotationRepository: { findById: () => convert(null) },
          noteVersionRepository: { listIds: () => convert([]), list: () => convert([]) },
          knowledgeEvidenceRepository: { list: () => convert(evidence) },
          questionSourceRepository: { list: () => convert([]) },
          analysisScopeRepository: { list: () => convert([]) },
          knowledgeItemService: {
            markEvidenceByAnnotationId: () => convert([]),
            markEvidenceByNoteVersionIds: () => convert([]),
            markEvidenceByNoteId: (id, status) => {
              calls.push(['markNote', id, status]);
              return convert([]);
            }
          },
          questionService: {
            markSourcesStale: (type, ids) => {
              calls.push(['stale', type, ids]);
              return convert(undefined);
            }
          }
        };
        const lifecycle = subject.createAsyncNoteDependencyLifecycle(deps),
          repository = createInMemoryNoteRepository();
        const noteVersionService = { ensureForNote: note => convert({ id: 'v', contentHash: note.contentHash }) };
        const service = createAsyncNoteService({
          repository,
          noteVersionService,
          runTransaction: op => op({ noteRepository: repository, noteVersionService, ...lifecycle })
        });
        const module = { noteService: service };
        const created = await runLifecycleRoute(module, 'POST', '/api/knowledge/notes', {
          id: 'note with space',
          spaceId: 's',
          title: '合成',
          rawMarkdown: 'before'
        });
        assert.equal(created.status, 201);
        assert.equal(created.body.data.id, 'note with space');
        assert.equal(calls.filter(x => x[0] === 'reconcile').length, 1);
        const updated = await runLifecycleRoute(module, 'PATCH', '/api/knowledge/notes/note%20with%20space', {
          rawMarkdown: 'after',
          expectedUpdatedAt: repository.findById('note with space').updatedAt
        });
        assert.equal(updated.body.data.rawMarkdown, 'after');
        assert.equal(calls.filter(x => x[0] === 'reconcile').length, 2);
        const deleted = await runLifecycleRoute(module, 'DELETE', '/api/knowledge/notes/note%20with%20space');
        assert.equal(deleted.body.data.deleted, true);
        assert.deepEqual(
          calls.find(x => x[0] === 'markNote'),
          ['markNote', 'note with space', 'invalid']
        );
        evidence.push({ id: 'formal' });
        const before = repository.findById('note with space');
        await assert.rejects(
          runLifecycleRoute(module, 'DELETE', '/api/knowledge/notes/note%20with%20space/permanent'),
          e => e.code === 'NOTE_HAS_KNOWLEDGE_EVIDENCE'
        );
        assert.equal(repository.findById('note with space'), before);
        evidence.length = 0;
        const removed = await runLifecycleRoute(module, 'DELETE', '/api/knowledge/notes/note%20with%20space/permanent');
        assert.equal(removed.body.data.id, 'note with space');
        assert.equal(repository.findById('note with space'), null);
      }
    );
  check(
    'actual decorators preserve marks-only/full-content branch and apply identity then inline refresh after cascade',
    async () => {
      const calls = [],
        annotations = [];
      const repository = {
        findById: () => null,
        list: () => {
          calls.push('annotations.list');
          return [];
        },
        save: value => {
          annotations.push(value);
          calls.push('annotation.save');
          return value;
        }
      };
      const dependencies = {
        createAnnotationService: () => ({
          reconcileForNote: () => {
            calls.push('reconcile');
            return { contentChangedAnnotationIds: [] };
          }
        }),
        contentAnnotationRepository: repository,
        noteVersionRepository: {
          listIds: () => {
            calls.push('versions');
            return ['old'];
          },
          list: () => []
        },
        knowledgeEvidenceRepository: { list: () => [] },
        questionSourceRepository: { list: () => [] },
        analysisScopeRepository: { list: () => [] },
        knowledgeItemService: {
          markEvidenceByAnnotationId: () => [],
          markEvidenceByNoteId: () => [],
          markEvidenceByNoteVersionIds: () => {
            calls.push('direct-evidence');
            return [{ id: 'e' }];
          }
        },
        questionService: {
          markSourcesStale: type => {
            calls.push(type);
          }
        }
      };
      const lifecycle = deps => subject.createAsyncNoteDependencyLifecycle(deps);
      const decorated = withInlineAnnotations(lifecycle(dependencies), {
        repository,
        revisionRepository: { save: value => value },
        marksOnlyLifecycle: lifecycle(marksOnlyDependencies(dependencies))
      });
      await decorated.onNoteContentChanged(
        { id: 'n', spaceId: 's', rawMarkdown: '<mark data-k="m">before</mark>' },
        { id: 'new', contentHash: 'h' },
        { before: 'before' }
      );
      assert.deepEqual(calls, [
        'reconcile',
        'knowledgeEvidence',
        'versions',
        'knowledgeEvidence',
        'annotations.list',
        'annotation.save'
      ]);
      assert.equal(annotations.length, 1);
      calls.length = 0;
      await decorated.onNoteContentChanged(
        { id: 'n', spaceId: 's', rawMarkdown: 'after' },
        { id: 'new', contentHash: 'h' },
        { before: 'before' }
      );
      assert.deepEqual(calls, [
        'reconcile',
        'knowledgeEvidence',
        'versions',
        'direct-evidence',
        'knowledgeEvidence',
        'noteVersion',
        'annotations.list'
      ]);
    }
  );
  check(
    'actual PG transaction wrapper and real repositories distinguish marks-only/full-content through real route, no real database',
    async () => {
      const f = postgresLifecycleFixture();
      const marked = '<mark data-k="m1">before</mark>';
      const onlyMarks = await runLifecycleRoute(f.module, 'PATCH', '/api/knowledge/notes/n', {
        rawMarkdown: marked,
        expectedUpdatedAt: f.now.toISOString()
      });
      assert.equal(onlyMarks.body.data.rawMarkdown, marked);
      assert.deepEqual(f.transactions, [{ isolationLevel: 'Serializable' }]);
      assert.ok(f.calls.some(([name, args]) => name === 'noteVersion.findMany' && args.select?.id === true));
      assert.equal(
        f.calls.some(([name]) => name === 'knowledgeEvidence.findMany'),
        false,
        'marks-only suppresses version evidence cascade'
      );
      assert.equal(
        f.calls.some(([name]) => name === 'questionSource.findMany'),
        false,
        'marks-only suppresses version question cascade'
      );
      assert.ok(
        f.calls.some(([name]) => name === 'contentAnnotation.upsert'),
        'inline marks are derived after lifecycle'
      );
      f.calls.length = 0;
      const full = await runLifecycleRoute(f.module, 'PATCH', '/api/knowledge/notes/n', {
        rawMarkdown: 'after',
        expectedUpdatedAt: onlyMarks.body.data.updatedAt
      });
      assert.equal(full.body.data.rawMarkdown, 'after');
      const idsRead = f.calls.findIndex(([name, args]) => name === 'noteVersion.findMany' && args.select?.id === true);
      const evidenceRead = f.calls.findIndex(([name]) => name === 'knowledgeEvidence.findMany');
      const sourceRead = f.calls.findIndex(([name]) => name === 'questionSource.findMany');
      assert.ok(idsRead >= 0 && evidenceRead > idsRead && sourceRead > evidenceRead);
      assert.deepEqual(f.calls[evidenceRead][1].where, {
        noteVersionId: { in: ['old'] },
        sourceType: 'noteVersion',
        status: { notIn: ['stale', 'invalid'] }
      });
      assert.deepEqual(f.calls[sourceRead][1].where, {
        sourceType: 'noteVersion',
        sourceId: { in: ['old'] },
        status: { not: 'stale' }
      });
      f.calls.length = 0;
      await runLifecycleRoute(f.module, 'DELETE', '/api/knowledge/notes/n');
      assert.deepEqual(f.calls.find(([name]) => name === 'knowledgeEvidence.findMany')[1].where, {
        noteId: 'n',
        status: { not: 'invalid' }
      });
      f.scopeRows.push({ id: 'scope', noteVersions: [{ noteId: 'n' }], createdAt: f.now, updatedAt: f.now });
      f.calls.length = 0;
      await assert.rejects(
        runLifecycleRoute(f.module, 'DELETE', '/api/knowledge/notes/n/permanent'),
        e => e.code === 'NOTE_HAS_ANALYSIS_SCOPE'
      );
      assert.equal(
        f.calls.some(([name]) => name === 'note.delete'),
        false
      );
      f.scopeRows.length = 0;
      await runLifecycleRoute(f.module, 'DELETE', '/api/knowledge/notes/n/permanent');
      assert.equal(f.calls.at(-1)[0], 'note.delete');
      assert.equal(f.transactions.length, 5);
      assert.ok(f.transactions.every(options => options.isolationLevel === 'Serializable'));
    }
  );
  return rows;
}

// 仅调用实际路由及处理器，使用合成内存流，不监听端口。
async function runLifecycleRoute(knowledgeModule, method, path, body) {
  const knowledge = createPostgresKnowledgeHttpHandlers({ knowledgeModule });
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.headers = { 'content-type': 'application/json' };
  const response = {
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(content) {
      this.content = content;
    }
  };
  assert.equal(
    await handleNoteRoute({ request, response, url: new URL(path, 'https://synthetic.invalid'), knowledge }),
    true
  );
  return { status: response.status, body: JSON.parse(response.content) };
}

// 实际 PG 装配与真实 repository，只有 client/model 层为合成 double，不证明真实数据库回滚。
function postgresLifecycleFixture() {
  const repositoryNames = [
    'note',
    'folder',
    'tag',
    'tagGroup',
    'knowledgeSpace',
    'contentAnnotation',
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
  db.contentAnnotation.upsert = record('contentAnnotation.upsert', ({ create }) => create);
  db.annotationRevision.create = record('annotationRevision.create', ({ data }) => data);
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

// 每个 seed 新建所有对象、getter、迭代器和可变数组，旧实现不能消耗新实现的输入。
export async function observeLifecycle(subject, seed) {
  const variant = Math.floor(seed / 3),
    operation = ['content', 'deleted', 'before'][seed % 3];
  const trace = [],
    marker = { synthetic: true },
    opaque = {},
    other = {},
    symbol = Symbol('id');
  const ids = ['old', 'v', 1, '1', NaN, 0, -0, false, '', null, undefined, opaque, other, symbol];
  const id = ids[Math.floor(variant / 3) % ids.length],
    mode = variant % 3;
  const stageNames = [
    'none',
    'create',
    'reconcile',
    'find',
    'markAnnotation',
    'markVersions',
    'markNote',
    'stale',
    'ids',
    'versions',
    'evidence',
    'sources',
    'scopes'
  ];
  const failStage = stageNames[Math.floor(variant / 7) % stageNames.length];
  const failure = ['get', 'throw', 'then-get', 'reject'][Math.floor(variant / 91) % 4];
  const encode = value =>
    value === opaque
      ? 'object:first'
      : value === other
        ? 'object:other'
        : value === symbol
          ? 'symbol:id'
          : value === undefined
            ? 'undefined'
            : typeof value === 'number' && Number.isNaN(value)
              ? 'NaN'
              : Object.is(value, -0)
                ? '-0'
                : Array.isArray(value)
                  ? value.map(encode)
                  : value && typeof value === 'object'
                    ? Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, encode(nested)]))
                    : value;
  let noteReads = 0,
    versionReads = 0,
    iterableReads = 0;
  const record = value => ({
    get id() {
      trace.push(['record.id', encode(value)]);
      return value;
    }
  });
  const annotationIds =
    variant % 19 === 0
      ? null
      : variant % 17 === 0
        ? new Array(2)
        : variant % 13 === 0
          ? []
          : {
              *[Symbol.iterator]() {
                trace.push(['iterator', ++iterableReads]);
                if (iterableReads > 1) throw marker;
                for (const value of [id, 'a', id]) {
                  trace.push(['yield', encode(value)]);
                  yield value;
                }
              }
            };
  const annotationEvidence = () =>
    variant % 31 === 0
      ? { id }
      : variant % 29 === 0
        ? new Array(2)
        : variant % 11 === 0
          ? new Set([record(id), record(id)])
          : [record(id), record('e')];
  const versions = [record(id), record('v'), record(id)];
  const customMap = items => ({
    map(fn) {
      trace.push(['custom.map', this === mapped]);
      return items.map(fn);
    }
  });
  let mapped;
  const resultFor = stage => {
    if (stage === 'create') return annotations;
    if (stage === 'reconcile')
      return {
        get contentChangedAnnotationIds() {
          trace.push('annotationIds:get');
          return annotationIds;
        }
      };
    if (stage === 'find')
      return variant % 5 === 0
        ? null
        : {
            get anchorStatus() {
              trace.push('anchorStatus:get');
              return variant % 2 === 0 ? 'missing' : 'resolved';
            }
          };
    if (stage === 'markAnnotation') return annotationEvidence();
    if (stage === 'markVersions' || stage === 'markNote') {
      const items = variant % 23 === 0 ? new Array(1) : [record(id), record(id)];
      if (variant % 7 === 0) {
        mapped = customMap(items);
        return mapped;
      }
      return items;
    }
    if (stage === 'stale') return { ignored: true };
    if (stage === 'ids') {
      const values = [id, 'v', id];
      if (variant % 5 === 0) {
        const view = {
          filter(fn) {
            trace.push(['custom.filter', this === view]);
            return values.filter(fn);
          }
        };
        return view;
      }
      return values;
    }
    if (stage === 'versions') return variant % 37 === 0 ? [null] : versions;
    if (stage === 'evidence')
      return {
        get length() {
          trace.push('evidence.length');
          return variant % 4 === 0 ? '1' : 0;
        }
      };
    if (stage === 'sources')
      return variant % 41 === 0
        ? [null]
        : [
            {
              get sourceType() {
                trace.push('source.type');
                return variant % 3 === 0 ? 'other' : 'noteVersion';
              },
              get sourceId() {
                trace.push('source.id');
                return variant % 2 === 0 ? id : other;
              }
            }
          ];
    return variant % 43 === 0
      ? [null]
      : [
          {
            get noteVersions() {
              trace.push('scope.versions');
              return variant % 5 === 0
                ? null
                : [
                    {
                      get noteId() {
                        trace.push('scope.noteId');
                        return variant % 3 === 0 ? id : 'foreign';
                      },
                      get noteVersionId() {
                        trace.push('scope.versionId');
                        return variant % 2 === 0 ? id : other;
                      }
                    }
                  ];
            }
          }
        ];
  };
  const install = (target, name, stage, sync = false) =>
    Object.defineProperty(target, name, {
      configurable: true,
      get() {
        trace.push([stage, 'get']);
        if (stage === failStage && failure === 'get') throw marker;
        return function (...args) {
          trace.push([stage, 'call', sync ? this === undefined : this === target, encode(args)]);
          if (stage === failStage && failure === 'throw') throw marker;
          if (stage === 'markVersions' && variant % 4 === 0) {
            args[0].push('mutated');
            trace.push('ids:mutated');
          }
          const settle = () => resultFor(stage);
          if (sync) return settle();
          if (stage === failStage && failure === 'then-get')
            return {
              get then() {
                trace.push([stage, 'then:get']);
                throw marker;
              }
            };
          if (stage === failStage && failure === 'reject')
            return {
              then(_resolve, reject) {
                trace.push([stage, 'reject']);
                reject(marker);
              }
            };
          if (mode === 0) return settle();
          if (mode === 1)
            return Promise.resolve().then(() => {
              trace.push([stage, 'promise']);
              return settle();
            });
          const thenable = {
            get then() {
              trace.push([stage, 'then:get']);
              return function (resolve) {
                trace.push([stage, 'then:call', this === thenable]);
                resolve(settle());
              };
            }
          };
          return thenable;
        };
      }
    });
  const annotations = {};
  install(annotations, 'reconcileForNote', 'reconcile');
  const dependencies = {};
  install(dependencies, 'createAnnotationService', 'create', true);
  for (const [port, methods] of [
    ['contentAnnotationRepository', [['findById', 'find']]],
    [
      'noteVersionRepository',
      [
        ['listIds', 'ids'],
        ['list', 'versions']
      ]
    ],
    ['knowledgeEvidenceRepository', [['list', 'evidence']]],
    ['questionSourceRepository', [['list', 'sources']]],
    ['analysisScopeRepository', [['list', 'scopes']]],
    [
      'knowledgeItemService',
      [
        ['markEvidenceByAnnotationId', 'markAnnotation'],
        ['markEvidenceByNoteVersionIds', 'markVersions'],
        ['markEvidenceByNoteId', 'markNote']
      ]
    ],
    ['questionService', [['markSourcesStale', 'stale']]]
  ]) {
    const target = {};
    dependencies[port] = target;
    for (const [name, stage] of methods) install(target, name, stage);
  }
  let outcome;
  try {
    const lifecycle = subject.createAsyncNoteDependencyLifecycle(dependencies);
    const promise =
      operation === 'content'
        ? lifecycle.onNoteContentChanged(
            {
              get id() {
                trace.push(['note.id', ++noteReads]);
                return variant % 9 === 0 && noteReads > 1 ? other : id;
              }
            },
            {
              get contentHash() {
                trace.push('version.hash');
                return symbol;
              },
              get id() {
                trace.push(['version.id', ++versionReads]);
                return variant % 8 === 0 && versionReads > 1 ? id : 'v';
              }
            },
            marker
          )
        : operation === 'deleted'
          ? lifecycle.onNoteDeleted(id)
          : lifecycle.onBeforePermanentDelete(id);
    trace.push(['returned-promise', promise instanceof Promise]);
    outcome = { kind: 'fulfilled', value: encode(await promise) };
  } catch (error) {
    outcome =
      error === marker
        ? { kind: 'marker' }
        : { kind: error.name, code: error.code, message: error.message, status: error.statusCode };
  }
  return { operation, trace, outcome };
}
