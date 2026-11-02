import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createNoteService } from '../src/modules/knowledge/application/note-service.js';
import { createInMemoryNoteRepository } from '../src/modules/knowledge/infrastructure/note-repository.js';
import { createKnowledgeModule } from '../src/modules/knowledge/index.js';
import { createKnowledgeHttpHandlers } from '../src/modules/knowledge/http/knowledge-handlers.js';
import { handleNoteRoute } from '../src/modules/knowledge/http/note-routes.js';
import {
  marksOnlyDependencies,
  withInlineAnnotations
} from '../src/modules/knowledge/application/inline-annotations.js';

// 准确实际父源文与独立固定预期。普通运行无需 Git，不从待测实现生成预期。
export const lifecycleParent = '0a2776147d2b974c90ccc78995ae615efef669e1';
export const lifecycleFrozenSource =
  "import { conflictError } from './knowledge-errors.js';\n\n/** 笔记变更的同步依赖级联；由原笔记服务的事务包裹，不另开事务。 */\nexport function createNoteDependencyLifecycle({\n  contentAnnotationService, contentAnnotationRepository, annotationIdentityShadow,\n  knowledgeItemService, questionService, noteVersionService, noteVersionRepository,\n  knowledgeEvidenceRepository, questionSourceRepository, analysisScopeRepository,\n  coalescePreviousVersion\n}) {\n  return {\n    onNoteContentChanged: (note, version, annotationChange) => {\n      const reconciliation = contentAnnotationService.reconcileForNote(note.id, version.contentHash, annotationChange);\n      annotationIdentityShadow.observe(note, annotationChange);\n      const changed = reconciliation.contentChangedAnnotationIds.flatMap((annotationId) => (\n        knowledgeItemService.markEvidenceByAnnotationId(annotationId,\n          contentAnnotationRepository.findById(annotationId)?.anchorStatus === 'missing' ? 'insufficient' : 'stale')\n      ));\n      questionService.markSourcesStale('knowledgeEvidence', changed.map((evidence) => evidence.id));\n      const oldVersionIds = noteVersionService.listVersionIds({ noteId: note.id }).filter((id) => id !== version.id);\n      const directEvidence = knowledgeItemService.markEvidenceByNoteVersionIds(oldVersionIds, 'stale', 'noteVersion');\n      questionService.markSourcesStale('knowledgeEvidence', directEvidence.map((record) => record.id));\n      questionService.markSourcesStale('noteVersion', oldVersionIds);\n      coalescePreviousVersion(note, version, annotationChange);\n    },\n    onNoteDeleted: (noteId) => {\n      const changed = knowledgeItemService.markEvidenceByNoteId(noteId, 'invalid');\n      questionService.markSourcesStale('knowledgeEvidence', changed.map((evidence) => evidence.id));\n      questionService.markSourcesStale('noteVersion', noteVersionService.listVersions({ noteId }).map((version) => version.id));\n    },\n    onBeforePermanentDelete: (noteId) => {\n      if (knowledgeEvidenceRepository.list({ noteId }).length > 0) {\n        throw conflictError('NOTE_HAS_KNOWLEDGE_EVIDENCE', 'Note has formal knowledge evidence and cannot be permanently deleted');\n      }\n      const versionIds = new Set(\n        noteVersionRepository.list({ noteId }).map((version) => version.id)\n      );\n      if (\n        questionSourceRepository.list().some((source) => (\n          source.sourceType === 'noteVersion'\n          && versionIds.has(source.sourceId)\n        ))\n      ) {\n        throw conflictError(\n          'NOTE_HAS_QUESTION_SOURCE',\n          'Note has a formal question source and cannot be permanently deleted'\n        );\n      }\n      if (analysisScopeRepository.list().some((snapshot) => (\n        snapshot.noteVersions?.some((version) => (version.noteId === noteId || versionIds.has(version.noteVersionId)))\n      ))) {\n        throw conflictError('NOTE_HAS_ANALYSIS_SCOPE', 'NoteVersion is referenced by an analysis scope snapshot and cannot be deleted');\n      }\n    },\n  };\n}\n";
export const hash = value => createHash('sha256').update(value).digest('hex');
export function lifecycleContractCases(subject) {
  const factory = subject.createNoteDependencyLifecycle;
  const results = [];
  function check(name, run) {
    results.push({ name, run });
  }
  function fixture(input = {}) {
    const trace = [],
      ignored = {
        get then() {
          throw new Error('ignored then must not be read');
        }
      },
      sentinel = { synthetic: 'failure' };
    const note = { id: 'n', rawMarkdown: 'after' },
      version = { id: 'new', contentHash: 'hash' },
      change = { before: 'before', after: 'after' };
    const data = {
      ids: ['missing', 'ok', 'missing'],
      versions: [{ id: 'old' }, { id: 'new' }, { id: 'old' }],
      annotationEvidence: id => [{ id: 'e-' + id }],
      direct: [{ id: 'direct' }],
      deleted: [{ id: 'deleted' }],
      evidence: [],
      sources: [],
      scopes: [],
      ...input
    };
    const port = (name, methods) =>
      Object.fromEntries(
        Object.entries(methods).map(([key, fn]) => [
          key,
          function (...args) {
            assert.equal(this, deps[name]);
            trace.push([name + '.' + key, ...args]);
            if (data.failAt === trace.length) throw sentinel;
            return fn(...args);
          }
        ])
      );
    const deps = {
      contentAnnotationService: port('contentAnnotationService', {
        reconcileForNote: () => ({ contentChangedAnnotationIds: data.ids })
      }),
      contentAnnotationRepository: port('contentAnnotationRepository', {
        findById: id => (id === 'missing' ? { anchorStatus: 'missing' } : null)
      }),
      annotationIdentityShadow: port('annotationIdentityShadow', { observe: () => ignored }),
      knowledgeItemService: port('knowledgeItemService', {
        markEvidenceByAnnotationId: id => data.annotationEvidence(id),
        markEvidenceByNoteVersionIds: () => data.direct,
        markEvidenceByNoteId: () => data.deleted
      }),
      questionService: port('questionService', { markSourcesStale: () => ignored }),
      noteVersionService: port('noteVersionService', {
        listVersionIds: () => data.versions.map(v => v.id),
        listVersions: () => data.versions
      }),
      noteVersionRepository: port('noteVersionRepository', { list: () => data.versions }),
      knowledgeEvidenceRepository: port('knowledgeEvidenceRepository', { list: () => data.evidence }),
      questionSourceRepository: port('questionSourceRepository', { list: () => data.sources }),
      analysisScopeRepository: port('analysisScopeRepository', { list: () => data.scopes }),
      coalescePreviousVersion: function (...args) {
        assert.equal(this, undefined);
        trace.push(['coalescePreviousVersion', ...args]);
        if (data.failAt === trace.length) throw sentinel;
        return ignored;
      }
    };
    const lifecycle = factory(deps);
    return { trace, data, note, version, change, deps, lifecycle, sentinel };
  }
  const args = f => [f.note, f.version, f.change];
  const bodyNames = [
    'contentAnnotationService.reconcileForNote',
    'annotationIdentityShadow.observe',
    'contentAnnotationRepository.findById',
    'knowledgeItemService.markEvidenceByAnnotationId',
    'contentAnnotationRepository.findById',
    'knowledgeItemService.markEvidenceByAnnotationId',
    'contentAnnotationRepository.findById',
    'knowledgeItemService.markEvidenceByAnnotationId',
    'questionService.markSourcesStale',
    'noteVersionService.listVersionIds',
    'knowledgeItemService.markEvidenceByNoteVersionIds',
    'questionService.markSourcesStale',
    'questionService.markSourcesStale',
    'coalescePreviousVersion'
  ];
  const deleteNames = [
    'knowledgeItemService.markEvidenceByNoteId',
    'questionService.markSourcesStale',
    'noteVersionService.listVersions',
    'questionService.markSourcesStale'
  ];
  const permanentNames = [
    'knowledgeEvidenceRepository.list',
    'noteVersionRepository.list',
    'questionSourceRepository.list',
    'analysisScopeRepository.list'
  ];
  check('factory and hooks arity, order, synchronous functions', () => {
    const f = fixture();
    assert.equal(factory.length, 1);
    assert.deepEqual(Object.keys(f.lifecycle), ['onNoteContentChanged', 'onNoteDeleted', 'onBeforePermanentDelete']);
    assert.deepEqual(
      Object.values(f.lifecycle).map(x => [x.length, x.constructor.name]),
      [
        [3, 'Function'],
        [1, 'Function'],
        [1, 'Function']
      ]
    );
    assert.deepEqual(f.trace, []);
  });
  check('missing options synchronous throw', () => assert.throws(() => factory(), TypeError));
  check('missing dependencies remain lazy synchronous failures', () => {
    const l = factory({});
    for (const k of Object.keys(l)) assert.throws(() => l[k]({}, {}), TypeError);
  });
  check('body full sequence, original identities and ignored thenables', () => {
    const f = fixture();
    assert.equal(f.lifecycle.onNoteContentChanged(...args(f)), undefined);
    assert.deepEqual(
      f.trace.map(c => c[0]),
      bodyNames
    );
    assert.deepEqual(f.trace[8], [
      'questionService.markSourcesStale',
      'knowledgeEvidence',
      ['e-missing', 'e-ok', 'e-missing']
    ]);
    assert.equal(f.trace[1][1], f.note);
    assert.equal(f.trace[1][2], f.change);
    assert.deepEqual(f.trace.at(-1).slice(1), args(f));
    assert.equal(f.trace.at(-1)[1], f.note);
    assert.equal(f.trace.at(-1)[2], f.version);
    assert.equal(f.trace.at(-1)[3], f.change);
  });
  check('delete full sequence and undefined result', () => {
    const f = fixture();
    assert.equal(f.lifecycle.onNoteDeleted('n'), undefined);
    assert.deepEqual(
      f.trace.map(c => c[0]),
      deleteNames
    );
    assert.deepEqual(f.trace[0], ['knowledgeItemService.markEvidenceByNoteId', 'n', 'invalid']);
    assert.deepEqual(f.trace.at(-1), ['questionService.markSourcesStale', 'noteVersion', ['old', 'new', 'old']]);
  });
  check('permanent full sequence and undefined result', () => {
    const f = fixture();
    assert.equal(f.lifecycle.onBeforePermanentDelete('n'), undefined);
    assert.deepEqual(
      f.trace.map(c => c[0]),
      permanentNames
    );
  });
  for (const [hook, names] of [
    ['onNoteContentChanged', bodyNames],
    ['onNoteDeleted', deleteNames],
    ['onBeforePermanentDelete', permanentNames]
  ])
    for (let failAt = 1; failAt <= names.length; failAt++)
      check(`${hook} stage ${failAt} original synchronous error and truncation`, () => {
        const f = fixture({ failAt });
        assert.throws(
          () => f.lifecycle[hook](...(hook === 'onNoteContentChanged' ? args(f) : ['n'])),
          e => e === f.sentinel
        );
        assert.deepEqual(
          f.trace.map(c => c[0]),
          names.slice(0, failAt)
        );
      });
  check('empty body still emits all empty notifications and coalesces', () => {
    const f = fixture({ ids: [], versions: [{ id: 'new' }], direct: [] });
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.deepEqual(
      f.trace.filter(c => c[0] === 'questionService.markSourcesStale').map(c => c.slice(1)),
      [
        ['knowledgeEvidence', []],
        ['knowledgeEvidence', []],
        ['noteVersion', []]
      ]
    );
    assert.equal(f.trace.at(-1)[0], 'coalescePreviousVersion');
  });
  check('sparse annotation ids skipped by flatMap', () => {
    const ids = [];
    ids[2] = 'ok';
    const f = fixture({ ids });
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.deepEqual(
      f.trace.filter(c => c[0] === 'contentAnnotationRepository.findById').map(c => c[1]),
      ['ok']
    );
  });
  check('sparse evidence holes skipped by flatMap', () => {
    const sparse = [];
    sparse[2] = { id: 'kept' };
    const f = fixture({ ids: ['ok'], annotationEvidence: () => sparse });
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.deepEqual(f.trace.find(c => c[0] === 'questionService.markSourcesStale')[2], ['kept']);
  });
  check('single evidence record is retained as flatMap scalar', () => {
    const f = fixture({ ids: ['ok'], annotationEvidence: () => ({ id: 'scalar' }) });
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.deepEqual(f.trace.find(c => c[0] === 'questionService.markSourcesStale')[2], ['scalar']);
  });
  check('flatMap flattens one level only', () => {
    const inner = [{ id: 'nested' }];
    const f = fixture({ ids: ['ok'], annotationEvidence: () => [inner] });
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.deepEqual(f.trace.find(c => c[0] === 'questionService.markSourcesStale')[2], [undefined]);
  });
  for (const scalar of [undefined, null])
    check(`flatMap ${scalar} fails later at evidence.id without notifications`, () => {
      const f = fixture({ ids: ['ok'], annotationEvidence: () => scalar });
      assert.throws(() => f.lifecycle.onNoteContentChanged(...args(f)), TypeError);
      assert.equal(f.trace.at(-1)[0], 'knowledgeItemService.markEvidenceByAnnotationId');
    });
  check('Set annotation ids fail only after reconcile and shadow observe', () => {
    const f = fixture({ ids: new Set(['ok']) });
    assert.throws(() => f.lifecycle.onNoteContentChanged(...args(f)), TypeError);
    assert.deepEqual(
      f.trace.map(c => c[0]),
      bodyNames.slice(0, 2)
    );
  });
  check('custom flatMap and map receiver preserved without Array restriction', () => {
    const f = fixture();
    const mapped = {
      map(callback) {
        assert.equal(this, mapped);
        return [callback({ id: 'custom' })];
      }
    };
    const own = {
      flatMap(callback) {
        assert.equal(this, own);
        assert.deepEqual(callback('missing'), [{ id: 'e-missing' }]);
        return mapped;
      }
    };
    f.data.ids = own;
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.deepEqual(f.trace.find(c => c[0] === 'questionService.markSourcesStale')[2], ['custom']);
  });
  check('filter result mutable alias shared with subsequent notification', () => {
    const f = fixture();
    const original = f.deps.knowledgeItemService.markEvidenceByNoteVersionIds;
    let seen;
    f.deps.knowledgeItemService.markEvidenceByNoteVersionIds = function (ids, ...rest) {
      seen = ids;
      ids.push('mutated');
      return original.call(this, ids, ...rest);
    };
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.equal(f.trace.at(-2)[2], seen);
    assert.deepEqual(seen, ['old', 'old', 'mutated']);
  });
  check('strict old-version inequality retains NaN and number-string differences', () => {
    const obj = {};
    const sym = Symbol();
    const f = fixture({ versions: [{ id: NaN }, { id: 1 }, { id: '1' }, { id: obj }, { id: sym }] });
    f.version.id = 1;
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.deepEqual(f.trace.find(c => c[0] === 'knowledgeItemService.markEvidenceByNoteVersionIds')[1], [
      NaN,
      '1',
      obj,
      sym
    ]);
  });
  check('version getter reread for each actual filter callback', () => {
    const f = fixture();
    let reads = 0;
    Object.defineProperty(f.version, 'id', {
      get() {
        reads++;
        return reads === 1 ? 'old' : 'new';
      }
    });
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.equal(reads, 3);
    assert.deepEqual(f.trace.find(c => c[0] === 'knowledgeItemService.markEvidenceByNoteVersionIds')[1], ['old']);
  });
  check('note id reread after shadow mutation', () => {
    const f = fixture();
    f.deps.annotationIdentityShadow.observe = function (note) {
      assert.equal(this, f.deps.annotationIdentityShadow);
      note.id = 'next';
    };
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.equal(f.trace[0][1], 'n');
    assert.deepEqual(f.trace.find(c => c[0] === 'noteVersionService.listVersionIds')[1], { noteId: 'next' });
  });
  check('callee getter evaluation precedes argument findById getter', () => {
    const f = fixture({ ids: ['ok'] });
    const order = [];
    const m = f.deps.knowledgeItemService.markEvidenceByAnnotationId,
      a = f.deps.contentAnnotationRepository.findById;
    Object.defineProperty(f.deps.knowledgeItemService, 'markEvidenceByAnnotationId', {
      get() {
        order.push('mark-get');
        return m;
      }
    });
    Object.defineProperty(f.deps.contentAnnotationRepository, 'findById', {
      get() {
        order.push('find-get');
        return a;
      }
    });
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.deepEqual(order, ['mark-get', 'find-get']);
  });
  check('shadow observe can replace later methods and reconciliation ids getter', () => {
    const f = fixture({ ids: [] });
    const returned = {
      get contentChangedAnnotationIds() {
        assert.equal(f.note.changed, true);
        return [];
      }
    };
    f.deps.contentAnnotationService.reconcileForNote = () => returned;
    f.deps.annotationIdentityShadow.observe = note => {
      note.changed = true;
      f.deps.questionService.markSourcesStale = () => {
        f.note.notified = true;
      };
    };
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.equal(f.note.notified, true);
  });
  for (const status of ['missing', 'resolved', 'MISSING', undefined, null, 0, {}, new String('missing')])
    check('strict status branch ' + String(status), () => {
      const f = fixture({ ids: ['ok'] });
      f.deps.contentAnnotationRepository.findById = () => ({ anchorStatus: status });
      f.lifecycle.onNoteContentChanged(...args(f));
      assert.equal(
        f.trace.find(c => c[0] === 'knowledgeItemService.markEvidenceByAnnotationId')[2],
        status === 'missing' ? 'insufficient' : 'stale'
      );
    });
  const cases = [
    ['evidence priority', { evidence: [{}], sources: [null], scopes: [null] }, 'NOTE_HAS_KNOWLEDGE_EVIDENCE', 1],
    [
      'source priority',
      { sources: [{ sourceType: 'noteVersion', sourceId: 'old' }, null], scopes: [null] },
      'NOTE_HAS_QUESTION_SOURCE',
      3
    ],
    [
      'scope note short circuit',
      {
        scopes: [
          {
            noteVersions: [
              {
                noteId: 'n',
                get noteVersionId() {
                  throw new Error('short circuit');
                }
              },
              null
            ]
          },
          null
        ]
      },
      'NOTE_HAS_ANALYSIS_SCOPE',
      4
    ],
    [
      'scope version',
      { scopes: [{ noteVersions: [{ noteId: 'other', noteVersionId: 'old' }] }] },
      'NOTE_HAS_ANALYSIS_SCOPE',
      4
    ],
    ['nullish scopes noteVersions', { scopes: [{}, { noteVersions: null }, { noteVersions: undefined }] }, null, 4],
    ['source wrong type', { sources: [{ sourceType: 'knowledgeEvidence', sourceId: 'old' }] }, null, 4],
    [
      'number versus string',
      { versions: [{ id: 1 }], sources: [{ sourceType: 'noteVersion', sourceId: '1' }] },
      null,
      4
    ],
    [
      'Set SameValueZero NaN',
      { versions: [{ id: NaN }], sources: [{ sourceType: 'noteVersion', sourceId: NaN }] },
      'NOTE_HAS_QUESTION_SOURCE',
      3
    ]
  ];
  for (const [name, data, code, length] of cases)
    check(name, () => {
      const f = fixture(data);
      if (code)
        assert.throws(
          () => f.lifecycle.onBeforePermanentDelete('n'),
          e => e.code === code && e.statusCode === 409 && e.name === 'AppError'
        );
      else assert.equal(f.lifecycle.onBeforePermanentDelete('n'), undefined);
      assert.deepEqual(
        f.trace.map(c => c[0]),
        permanentNames.slice(0, length)
      );
    });
  check('custom some truthiness is not normalized to true', () => {
    const f = fixture({
      sources: {
        some() {
          return { truthy: true };
        }
      }
    });
    assert.throws(
      () => f.lifecycle.onBeforePermanentDelete('n'),
      e => e.code === 'NOTE_HAS_QUESTION_SOURCE'
    );
  });
  check('custom length coercion and getter kept', () => {
    const f = fixture({
      evidence: {
        get length() {
          return { valueOf: () => 1 };
        }
      }
    });
    assert.throws(
      () => f.lifecycle.onBeforePermanentDelete('n'),
      e => e.code === 'NOTE_HAS_KNOWLEDGE_EVIDENCE'
    );
    assert.equal(f.trace.length, 1);
  });
  check('ignored Promise results are never awaited and body remains sync', () => {
    const f = fixture();
    let called = false;
    f.deps.coalescePreviousVersion = () =>
      Promise.resolve().then(() => {
        called = true;
      });
    f.lifecycle = factory(f.deps);
    assert.equal(f.lifecycle.onNoteContentChanged(...args(f)), undefined);
    assert.equal(called, false);
  });

  check('factory destructures each dependency once, in exact order, without method reads', () => {
    const f = fixture(),
      names = Object.keys(f.deps),
      reads = [],
      options = {};
    for (const name of names)
      Object.defineProperty(options, name, {
        get() {
          reads.push(name);
          return f.deps[name];
        }
      });
    const lifecycle = factory(options);
    assert.deepEqual(reads, names);
    assert.deepEqual(f.trace, []);
    lifecycle.onNoteDeleted('n');
    assert.deepEqual(reads, names);
  });
  check('dependency objects and coalescer captured, service methods remain late-bound', () => {
    const f = fixture(),
      options = { ...f.deps },
      lifecycle = factory(options);
    let replacement = 0;
    options.questionService = {
      markSourcesStale: () => {
        throw new Error('replacement object');
      }
    };
    options.annotationIdentityShadow = {
      observe: () => {
        throw new Error('replacement shadow');
      }
    };
    options.coalescePreviousVersion = () => {
      throw new Error('replacement callback');
    };
    f.deps.questionService.markSourcesStale = function () {
      assert.equal(this, f.deps.questionService);
      replacement++;
    };
    lifecycle.onNoteContentChanged(...args(f));
    assert.equal(replacement, 3);
    assert.equal(f.trace.at(-1)[0], 'coalescePreviousVersion');
  });
  check('shadow observes before reconciliation IDs getter and coalescer runs after final notification', () => {
    const f = fixture({ ids: [] }),
      order = [];
    f.deps.contentAnnotationService.reconcileForNote = () => {
      order.push('reconcile');
      return {
        get contentChangedAnnotationIds() {
          order.push('ids');
          return [];
        }
      };
    };
    f.deps.annotationIdentityShadow.observe = () => {
      order.push('shadow');
      return f.note;
    };
    f.deps.questionService.markSourcesStale = type => {
      order.push(type);
      return 7;
    };
    f.deps.coalescePreviousVersion = () => {
      order.push('coalesce');
      return 8;
    };
    f.lifecycle = factory(f.deps);
    assert.equal(f.lifecycle.onNoteContentChanged(...args(f)), undefined);
    assert.deepEqual(order, [
      'reconcile',
      'shadow',
      'ids',
      'knowledgeEvidence',
      'knowledgeEvidence',
      'noteVersion',
      'coalesce'
    ]);
  });
  for (const [name, target, key] of [
    ['shadow', 'annotationIdentityShadow', 'observe'],
    ['question', 'questionService', 'markSourcesStale'],
    ['coalesce', null, 'coalescePreviousVersion']
  ])
    check(`all ${name} Promise and thenable returns ignored without reading then`, () => {
      for (const mode of ['thenable', 'promise']) {
        const f = fixture();
        let called = 0,
          thenReads = 0;
        const value =
          mode === 'promise'
            ? Promise.resolve('ignored')
            : {
                get then() {
                  thenReads++;
                  throw new Error('must not read then');
                }
              };
        const method = () => {
          called++;
          return value;
        };
        if (target) f.deps[target][key] = method;
        else f.deps[key] = method;
        f.lifecycle = factory(f.deps);
        assert.equal(f.lifecycle.onNoteContentChanged(...args(f)), undefined);
        assert.equal(called, name === 'question' ? 3 : 1);
        assert.equal(thenReads, 0);
      }
    });
  check('deleted hook ignores question returned entities and thenables', () => {
    const f = fixture();
    let calls = 0;
    f.deps.questionService.markSourcesStale = () => {
      calls++;
      return {
        get then() {
          throw new Error('not awaited');
        }
      };
    };
    assert.equal(f.lifecycle.onNoteDeleted('n'), undefined);
    assert.equal(calls, 2);
  });
  for (const target of [
    'contentAnnotationService',
    'annotationIdentityShadow',
    'knowledgeItemService',
    'questionService',
    'noteVersionService'
  ])
    check(`${target} method getter failure propagates exact sentinel synchronously`, () => {
      const f = fixture(),
        method = {
          contentAnnotationService: 'reconcileForNote',
          annotationIdentityShadow: 'observe',
          knowledgeItemService: 'markEvidenceByAnnotationId',
          questionService: 'markSourcesStale',
          noteVersionService: 'listVersionIds'
        }[target];
      Object.defineProperty(f.deps[target], method, {
        get() {
          throw f.sentinel;
        }
      });
      assert.throws(
        () => f.lifecycle.onNoteContentChanged(...args(f)),
        e => e === f.sentinel
      );
      assert.equal(
        f.trace.some(row => row[0] === 'coalescePreviousVersion'),
        false
      );
    });
  check('method getter remains ahead of argument getter when both can throw', () => {
    const f = fixture({ ids: ['ok'] }),
      other = { wrong: true };
    Object.defineProperty(f.deps.knowledgeItemService, 'markEvidenceByAnnotationId', {
      get() {
        throw f.sentinel;
      }
    });
    Object.defineProperty(f.deps.contentAnnotationRepository, 'findById', {
      get() {
        throw other;
      }
    });
    assert.throws(
      () => f.lifecycle.onNoteContentChanged(...args(f)),
      e => e === f.sentinel
    );
  });
  check('custom version filter and direct evidence map preserve receivers and identities', () => {
    const f = fixture(),
      old = ['old', 'old'];
    const view = {
      filter(callback) {
        assert.equal(this, view);
        assert.equal(callback('new'), false);
        return old;
      }
    };
    const mapped = {
      map(callback) {
        assert.equal(this, mapped);
        return [callback({ id: 'direct-custom' })];
      }
    };
    f.deps.noteVersionService.listVersionIds = () => view;
    f.data.direct = mapped;
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.equal(f.trace.find(row => row[0] === 'knowledgeItemService.markEvidenceByNoteVersionIds')[1], old);
    assert.equal(f.trace.at(-2)[2], old);
    assert.deepEqual(f.trace.at(-3)[2], ['direct-custom']);
  });
  check('deleted version custom map and sparse map output preserve holes', () => {
    const f = fixture();
    const view = {
      map(callback) {
        assert.equal(this, view);
        const result = [];
        result[2] = callback({ id: 'last' });
        return result;
      }
    };
    f.data.versions = view;
    f.lifecycle.onNoteDeleted('n');
    const ids = f.trace.at(-1)[2];
    assert.equal(ids.length, 3);
    assert.equal(0 in ids, false);
    assert.equal(1 in ids, false);
    assert.equal(ids[2], 'last');
  });
  check('annotation and old-version duplicates survive without deduplication', () => {
    const f = fixture();
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.deepEqual(f.trace.find(row => row[0] === 'knowledgeItemService.markEvidenceByNoteVersionIds')[1], [
      'old',
      'old'
    ]);
    assert.deepEqual(f.trace.find(row => row[0] === 'questionService.markSourcesStale')[2], [
      'e-missing',
      'e-ok',
      'e-missing'
    ]);
  });
  check('question callee read precedes deleted version list argument evaluation', () => {
    const f = fixture(),
      order = [],
      notify = f.deps.questionService.markSourcesStale,
      list = f.deps.noteVersionService.listVersions;
    Object.defineProperty(f.deps.questionService, 'markSourcesStale', {
      get() {
        order.push('notify');
        return notify;
      }
    });
    Object.defineProperty(f.deps.noteVersionService, 'listVersions', {
      get() {
        order.push('versions');
        return list;
      }
    });
    f.lifecycle.onNoteDeleted('n');
    assert.deepEqual(order, ['notify', 'notify', 'versions']);
  });
  check('empty deletion still emits both empty question notifications', () => {
    const f = fixture({ deleted: [], versions: [] });
    f.lifecycle.onNoteDeleted('n');
    assert.deepEqual(
      f.trace.filter(row => row[0] === 'questionService.markSourcesStale').map(row => row.slice(1)),
      [
        ['knowledgeEvidence', []],
        ['noteVersion', []]
      ]
    );
  });
  for (const length of [-1, 'not-a-number', '0', 0, null, undefined])
    check(`formal evidence original greater-than coercion ${String(length)}`, () => {
      const f = fixture({ evidence: { length } });
      assert.equal(f.lifecycle.onBeforePermanentDelete('n'), undefined);
      assert.deepEqual(
        f.trace.map(row => row[0]),
        permanentNames
      );
    });
  check('source type strict equality and short circuit retain unread sourceId getter', () => {
    const f = fixture({
      sources: [
        {
          sourceType: new String('noteVersion'),
          get sourceId() {
            throw new Error('must not read');
          }
        }
      ]
    });
    assert.equal(f.lifecycle.onBeforePermanentDelete('n'), undefined);
  });
  check('scope note identity uses strict equality without String coercion', () => {
    const f = fixture({ versions: [], scopes: [{ noteVersions: [{ noteId: 1 }] }] });
    assert.equal(f.lifecycle.onBeforePermanentDelete('1'), undefined);
  });
  check('source and nested scope some preserve receiver, truthy result and short circuit', () => {
    const sourceView = {
      some(callback) {
        assert.equal(this, sourceView);
        assert.equal(callback({ sourceType: 'other' }), false);
        return '';
      }
    };
    const scopeView = {
      some(callback) {
        assert.equal(this, scopeView);
        return callback({ noteVersions: nested });
      }
    };
    const nested = {
      some(callback) {
        assert.equal(this, nested);
        assert.equal(callback({ noteId: 'n' }), true);
        return 'yes';
      }
    };
    const f = fixture({ sources: sourceView, scopes: scopeView });
    assert.throws(
      () => f.lifecycle.onBeforePermanentDelete('n'),
      e => e.code === 'NOTE_HAS_ANALYSIS_SCOPE'
    );
  });
  check('Set object and Symbol identity stays distinct from lookalike and string keys', () => {
    const first = {},
      other = {},
      symbol = Symbol('x');
    for (const sourceId of [other, '[object Object]', 'Symbol(x)']) {
      const f = fixture({
        versions: [{ id: first }, { id: symbol }],
        sources: [{ sourceType: 'noteVersion', sourceId }]
      });
      assert.equal(f.lifecycle.onBeforePermanentDelete('n'), undefined);
    }
    for (const sourceId of [first, symbol]) {
      const f = fixture({
        versions: [{ id: first }, { id: symbol }],
        sources: [{ sourceType: 'noteVersion', sourceId }]
      });
      assert.throws(
        () => f.lifecycle.onBeforePermanentDelete('n'),
        e => e.code === 'NOTE_HAS_QUESTION_SOURCE'
      );
    }
  });
  for (const [data, code, message] of [
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
  ])
    check(`exact AppError name status code and message ${code}`, () => {
      const f = fixture(data);
      assert.throws(
        () => f.lifecycle.onBeforePermanentDelete('n'),
        error => {
          assert.equal(error.name, 'AppError');
          assert.equal(error.code, code);
          assert.equal(error.statusCode, 409);
          assert.equal(error.message, message);
          return true;
        }
      );
    });
  for (const [hook, data] of [
    ['onNoteContentChanged', { ids: null }],
    ['onNoteContentChanged', { direct: null }],
    ['onNoteDeleted', { deleted: null }],
    ['onBeforePermanentDelete', { versions: [null] }],
    ['onBeforePermanentDelete', { sources: [null] }],
    ['onBeforePermanentDelete', { scopes: [{ noteVersions: [null] }] }]
  ])
    check(`malformed read remains lazy synchronous TypeError ${hook} ${Object.keys(data)[0]}`, () => {
      const f = fixture(data);
      assert.throws(() => f.lifecycle[hook](...(hook === 'onNoteContentChanged' ? args(f) : ['n'])), TypeError);
      assert.equal(
        f.trace.some(row => row[0] === 'coalescePreviousVersion'),
        false
      );
    });

  check('strict inequality retains NaN even when the current version ID is NaN', () => {
    const f = fixture({ versions: [{ id: NaN }, { id: NaN }, { id: 0 }] });
    f.version.id = NaN;
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.deepEqual(f.trace.find(row => row[0] === 'knowledgeItemService.markEvidenceByNoteVersionIds')[1], [
      NaN,
      NaN,
      0
    ]);
  });
  check('complete independently fixed ordered body arguments preserve every type status ID and original object', () => {
    const f = fixture();
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.deepEqual(f.trace, [
      ['contentAnnotationService.reconcileForNote', 'n', 'hash', f.change],
      ['annotationIdentityShadow.observe', f.note, f.change],
      ['contentAnnotationRepository.findById', 'missing'],
      ['knowledgeItemService.markEvidenceByAnnotationId', 'missing', 'insufficient'],
      ['contentAnnotationRepository.findById', 'ok'],
      ['knowledgeItemService.markEvidenceByAnnotationId', 'ok', 'stale'],
      ['contentAnnotationRepository.findById', 'missing'],
      ['knowledgeItemService.markEvidenceByAnnotationId', 'missing', 'insufficient'],
      ['questionService.markSourcesStale', 'knowledgeEvidence', ['e-missing', 'e-ok', 'e-missing']],
      ['noteVersionService.listVersionIds', { noteId: 'n' }],
      ['knowledgeItemService.markEvidenceByNoteVersionIds', ['old', 'old'], 'stale', 'noteVersion'],
      ['questionService.markSourcesStale', 'knowledgeEvidence', ['direct']],
      ['questionService.markSourcesStale', 'noteVersion', ['old', 'old']],
      ['coalescePreviousVersion', f.note, f.version, f.change]
    ]);
  });
  check('complete independently fixed deletion and guard argument sequences', () => {
    const f = fixture();
    f.lifecycle.onNoteDeleted('n');
    assert.deepEqual(f.trace, [
      ['knowledgeItemService.markEvidenceByNoteId', 'n', 'invalid'],
      ['questionService.markSourcesStale', 'knowledgeEvidence', ['deleted']],
      ['noteVersionService.listVersions', { noteId: 'n' }],
      ['questionService.markSourcesStale', 'noteVersion', ['old', 'new', 'old']]
    ]);
    f.trace.length = 0;
    f.lifecycle.onBeforePermanentDelete('n');
    assert.deepEqual(f.trace, [
      ['knowledgeEvidenceRepository.list', { noteId: 'n' }],
      ['noteVersionRepository.list', { noteId: 'n' }],
      ['questionSourceRepository.list'],
      ['analysisScopeRepository.list']
    ]);
  });
  check('asymmetric annotation evidence order is not reversed or sorted', () => {
    const f = fixture({ ids: ['z', 'b', 'a'] });
    f.lifecycle.onNoteContentChanged(...args(f));
    assert.deepEqual(f.trace.find(row => row[0] === 'questionService.markSourcesStale')[2], ['e-z', 'e-b', 'e-a']);
  });
  return results;
}

// 每次调用重新建立输入，记录所有实际 getter、方法、receiver、ID 别名和同步结果。
export function observeLifecycle(subject, seed) {
  const variant = Math.floor(seed / 3),
    operation = ['content', 'deleted', 'before'][seed % 3];
  const trace = [],
    marker = { synthetic: true },
    opaque = {},
    other = {},
    symbol = Symbol('id');
  const ids = ['old', 'v', 1, '1', NaN, 0, -0, false, '', null, undefined, opaque, other, symbol];
  const id = ids[Math.floor(variant / 3) % ids.length];
  const stages = [
    'none',
    'reconcile',
    'shadow',
    'find',
    'markAnnotation',
    'markVersions',
    'markNote',
    'stale',
    'ids',
    'versions',
    'evidence',
    'sources',
    'scopes',
    'coalesce'
  ];
  const failStage = stages[Math.floor(variant / 7) % stages.length],
    failKind = Math.floor(variant / 98) % 2 ? 'call' : 'get';
  let noteReads = 0,
    versionReads = 0,
    oldAlias;
  const note = {
    get id() {
      trace.push(['note.id', ++noteReads]);
      return variant % 9 === 0 && noteReads > 1 ? other : id;
    }
  };
  const version = {
    get contentHash() {
      trace.push('version.hash');
      return symbol;
    },
    get id() {
      trace.push(['version.id', ++versionReads]);
      return variant % 8 === 0 && versionReads > 1 ? id : 'v';
    }
  };
  const encode = value =>
    value === note
      ? 'note:original'
      : value === version
        ? 'version:original'
        : value === marker
          ? 'change:original'
          : value === opaque
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
  const record = value => ({
    get id() {
      trace.push(['record.id', encode(value)]);
      return value;
    }
  });
  const ownMap = items => {
    const view = {
      map(callback) {
        trace.push(['custom.map', this === view]);
        return items.map(callback);
      }
    };
    return view;
  };
  const values = [id, 'a', id];
  if (variant % 17 === 0) delete values[1];
  let annotationIds =
    variant % 19 === 0 ? null : variant % 31 === 0 ? new Set(values) : variant % 13 === 0 ? [] : values;
  if (variant % 11 === 0) {
    const view = {
      flatMap(callback) {
        trace.push(['custom.flatMap', this === view]);
        const mapped = values.flatMap(callback);
        return ownMap(mapped);
      }
    };
    annotationIds = view;
  }
  const sparseAnnotationEvidence = () => {
    const sparse = new Array(3);
    sparse[1] = record(id);
    return sparse;
  };
  const annotationEvidence = () =>
    variant % 37 === 0
      ? null
      : variant % 29 === 0
        ? undefined
        : variant % 23 === 0
          ? record(id)
          : variant % 7 === 0
            ? [[record(id)]]
            : variant % 5 === 0
              ? sparseAnnotationEvidence()
              : [record(id), record('e')];
  const versions = [record(id), record('v'), record(id)];
  const resultFor = stage => {
    if (stage === 'reconcile')
      return {
        get contentChangedAnnotationIds() {
          trace.push('annotationIds:get');
          return annotationIds;
        }
      };
    if (stage === 'shadow' || stage === 'stale' || stage === 'coalesce')
      return {
        get then() {
          trace.push([stage, 'then:get']);
          throw marker;
        }
      };
    if (stage === 'find')
      return variant % 5 === 0
        ? null
        : {
            get anchorStatus() {
              trace.push('anchorStatus:get');
              return ['missing', 'resolved', 'MISSING', undefined][variant % 4];
            }
          };
    if (stage === 'markAnnotation') return annotationEvidence();
    if (stage === 'markVersions' || stage === 'markNote') {
      const items = variant % 43 === 0 ? null : variant % 23 === 0 ? new Array(2) : [record(id), record(id)];
      return variant % 7 === 0 && items ? ownMap(items) : items;
    }
    if (stage === 'ids') {
      const values = [id, 'v', id];
      if (variant % 17 === 0) delete values[1];
      if (variant % 5 === 0) {
        const view = {
          filter(callback) {
            trace.push(['custom.filter', this === view]);
            return values.filter(callback);
          }
        };
        return view;
      }
      return values;
    }
    if (stage === 'versions') return variant % 37 === 0 ? [null] : variant % 11 === 0 ? ownMap(versions) : versions;
    if (stage === 'evidence')
      return {
        get length() {
          trace.push('evidence.length');
          return variant % 4 === 0 ? '1' : variant % 17 === 0 ? -1 : 0;
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
    if (stage === 'scopes')
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
    throw new Error('Unknown stage ' + stage);
  };
  const install = (target, name, stage, bare = false) =>
    Object.defineProperty(target, name, {
      configurable: true,
      get() {
        trace.push([stage, 'get']);
        if (stage === failStage && failKind === 'get') throw marker;
        return function (...args) {
          trace.push([stage, 'call', bare ? this === undefined : this === target, encode(args)]);
          if (stage === failStage && failKind === 'call') throw marker;
          if (stage === 'markVersions') {
            oldAlias = args[0];
            if (variant % 4 === 0) {
              args[0].push('mutated');
              trace.push('oldIds:mutated');
            }
          }
          if (stage === 'stale' && args[0] === 'noteVersion' && operation === 'content')
            trace.push(['oldIds:same', args[1] === oldAlias]);
          return resultFor(stage);
        };
      }
    });
  const dependencies = {};
  for (const [port, methods] of [
    ['contentAnnotationService', [['reconcileForNote', 'reconcile']]],
    ['annotationIdentityShadow', [['observe', 'shadow']]],
    ['contentAnnotationRepository', [['findById', 'find']]],
    [
      'noteVersionService',
      [
        ['listVersionIds', 'ids'],
        ['listVersions', 'versions']
      ]
    ],
    ['noteVersionRepository', [['list', 'versions']]],
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
  install(dependencies, 'coalescePreviousVersion', 'coalesce', true);
  let outcome;
  try {
    const lifecycle = subject.createNoteDependencyLifecycle(dependencies);
    trace.push('factory:returned');
    const returned =
      operation === 'content'
        ? lifecycle.onNoteContentChanged(note, version, marker)
        : operation === 'deleted'
          ? lifecycle.onNoteDeleted(id)
          : lifecycle.onBeforePermanentDelete(id);
    trace.push(['returned-synchronously', returned === undefined]);
    outcome = { kind: 'returned', value: encode(returned) };
  } catch (error) {
    outcome =
      error === marker
        ? { kind: 'marker' }
        : { kind: error.name, code: error.code, message: error.message, status: error.statusCode };
  }
  return { operation, trace, outcome };
}

// 真正调用同步服务、内存仓库、处理器和路由；没有 socket、文件存储或真实数据库。
async function runLifecycleRoute(knowledgeModule, method, path, body) {
  const knowledge = createKnowledgeHttpHandlers({ knowledgeModule });
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
export function lifecycleConsumerCases(subject) {
  const rows = [],
    check = (name, run) => rows.push({ name, run });
  function serviceFixture() {
    const calls = [],
      evidence = [],
      repository = createInMemoryNoteRepository();
    let transactions = 0;
    const deps = {
      contentAnnotationService: {
        reconcileForNote: (...args) => {
          calls.push(['reconcile', ...args]);
          return { contentChangedAnnotationIds: [] };
        }
      },
      contentAnnotationRepository: { findById: () => null },
      annotationIdentityShadow: { observe: (...args) => calls.push(['shadow', ...args]) },
      noteVersionService: { listVersionIds: () => [], listVersions: () => [] },
      noteVersionRepository: { list: () => [] },
      knowledgeEvidenceRepository: { list: () => evidence },
      questionSourceRepository: { list: () => [] },
      analysisScopeRepository: { list: () => [] },
      knowledgeItemService: {
        markEvidenceByAnnotationId: () => [],
        markEvidenceByNoteVersionIds: () => [],
        markEvidenceByNoteId: (id, status) => {
          calls.push(['markNote', id, status]);
          return [];
        }
      },
      questionService: { markSourcesStale: (...args) => calls.push(['stale', ...args]) },
      coalescePreviousVersion: (...args) => calls.push(['coalesce', ...args])
    };
    const service = createNoteService({
      repository,
      noteVersionService: { ensureForNote: () => ({ id: 'v', contentHash: 'hash' }) },
      ...subject.createNoteDependencyLifecycle(deps),
      runTransaction: operation => {
        transactions++;
        return operation();
      }
    });
    return { service, repository, calls, evidence, transactions: () => transactions };
  }
  check('real synchronous note service preserves original repository identities and one transaction per entry', () => {
    const f = serviceFixture();
    const created = f.service.createNote({ id: 'n', spaceId: 's', title: '同步合成', rawMarkdown: 'before' });
    assert.equal(f.repository.findById('n'), created);
    assert.equal(f.calls.filter(c => c[0] === 'reconcile').length, 1);
    const updated = f.service.updateNote('n', { rawMarkdown: 'after' });
    assert.equal(updated.rawMarkdown, 'after');
    assert.equal(f.repository.findById('n'), updated);
    assert.equal(f.calls.filter(c => c[0] === 'coalesce').length, 2);
    const deleted = f.service.deleteNote('n');
    assert.equal(deleted.deleted, true);
    assert.deepEqual(
      f.calls.find(c => c[0] === 'markNote'),
      ['markNote', 'n', 'invalid']
    );
    f.evidence.push({ id: 'formal' });
    const before = f.repository.findById('n');
    assert.throws(
      () => f.service.permanentlyDeleteNote('n'),
      e => e.code === 'NOTE_HAS_KNOWLEDGE_EVIDENCE'
    );
    assert.equal(f.repository.findById('n'), before);
    f.evidence.length = 0;
    assert.equal(f.service.permanentlyDeleteNote('n'), before);
    assert.equal(f.repository.findById('n'), null);
    assert.equal(f.transactions(), 5);
  });
  check(
    'real synchronous service and HTTP route reach create update deletion and blocked permanent deletion without sockets',
    async () => {
      const f = serviceFixture(),
        module = { noteService: f.service },
        path = '/api/knowledge/notes/note%20with%20space';
      const created = await runLifecycleRoute(module, 'POST', '/api/knowledge/notes', {
        id: 'note with space',
        spaceId: 's',
        title: '合成路由',
        rawMarkdown: 'before'
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.data.id, 'note with space');
      await assert.rejects(
        runLifecycleRoute(module, 'PATCH', path, { rawMarkdown: 'rejected' }),
        e => e.code === 'NOTE_VERSION_REQUIRED' && e.statusCode === 428
      );
      assert.equal(f.transactions(), 1);
      const updated = await runLifecycleRoute(module, 'PATCH', path, {
        rawMarkdown: 'after',
        expectedUpdatedAt: f.repository.findById('note with space').updatedAt
      });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.data.rawMarkdown, 'after');
      assert.equal(f.calls.filter(row => row[0] === 'shadow').length, 2);
      assert.equal(f.calls.filter(row => row[0] === 'coalesce').length, 2);
      const deleted = await runLifecycleRoute(module, 'DELETE', path);
      assert.equal(deleted.body.data.deleted, true);
      f.evidence.push({ id: 'formal' });
      const before = f.repository.findById('note with space');
      await assert.rejects(
        runLifecycleRoute(module, 'DELETE', path + '/permanent'),
        e => e.code === 'NOTE_HAS_KNOWLEDGE_EVIDENCE'
      );
      assert.equal(f.repository.findById('note with space'), before);
      f.evidence.length = 0;
      const removed = await runLifecycleRoute(module, 'DELETE', path + '/permanent');
      assert.equal(removed.body.data.id, 'note with space');
      assert.equal(f.repository.findById('note with space'), null);
      assert.equal(f.transactions(), 5);
    }
  );
  check(
    'real synchronous decorators order marks-only full-content shadow coalescing identity and inline refresh',
    () => {
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
      const deps = {
        contentAnnotationService: {
          reconcileForNote: () => {
            calls.push('reconcile');
            return { contentChangedAnnotationIds: [] };
          }
        },
        contentAnnotationRepository: repository,
        annotationIdentityShadow: { observe: () => calls.push('shadow') },
        coalescePreviousVersion: () => calls.push('coalesce'),
        noteVersionService: {
          listVersionIds: () => {
            calls.push('versions');
            return ['old'];
          },
          listVersions: () => []
        },
        noteVersionRepository: { list: () => [] },
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
        questionService: { markSourcesStale: type => calls.push(type) }
      };
      const lifecycle = dependencies => subject.createNoteDependencyLifecycle(dependencies);
      const decorated = withInlineAnnotations(lifecycle(deps), {
        repository,
        revisionRepository: { save: value => value },
        marksOnlyLifecycle: lifecycle(marksOnlyDependencies(deps))
      });
      const result = decorated.onNoteContentChanged(
        { id: 'n', spaceId: 's', rawMarkdown: '<mark data-k="m">before</mark>' },
        { id: 'new', contentHash: 'h' },
        { before: 'before' }
      );
      assert.equal(result instanceof Promise, false);
      assert.deepEqual(calls, [
        'reconcile',
        'shadow',
        'knowledgeEvidence',
        'versions',
        'knowledgeEvidence',
        'coalesce',
        'annotations.list',
        'annotation.save'
      ]);
      assert.equal(annotations.length, 1);
      calls.length = 0;
      decorated.onNoteContentChanged(
        { id: 'n', spaceId: 's', rawMarkdown: 'after' },
        { id: 'new', contentHash: 'h' },
        { before: 'before' }
      );
      assert.deepEqual(calls, [
        'reconcile',
        'shadow',
        'knowledgeEvidence',
        'versions',
        'direct-evidence',
        'knowledgeEvidence',
        'noteVersion',
        'coalesce',
        'annotations.list'
      ]);
    }
  );
  check('real local module route preserves marks-only evidence then invalidates real content references', async () => {
    const module = createKnowledgeModule(),
      calls = [];
    const note = module.noteService.createNote({
      id: 'route-module-note',
      spaceId: 's',
      title: '模块路由',
      rawMarkdown: 'before'
    });
    const originalEvidence = module.knowledgeItemService.markEvidenceByNoteVersionIds,
      originalQuestions = module.questionService.markSourcesStale;
    module.knowledgeItemService.markEvidenceByNoteVersionIds = function (...args) {
      calls.push(['evidence', ...args]);
      return originalEvidence.apply(this, args);
    };
    module.questionService.markSourcesStale = function (...args) {
      calls.push(['question', ...args]);
      return originalQuestions.apply(this, args);
    };
    const path = '/api/knowledge/notes/' + note.id;
    const marked = await runLifecycleRoute(module, 'PATCH', path, {
      rawMarkdown: '<mark data-k="route-mark">before</mark>',
      expectedUpdatedAt: note.updatedAt
    });
    assert.equal(
      calls.some(row => row[0] === 'evidence'),
      false
    );
    assert.equal(
      calls.some(row => row[1] === 'noteVersion'),
      false
    );
    assert.ok(
      module.repositories.contentAnnotationRepository.list({ noteId: note.id }).some(row => row.schemaVersion === 3)
    );
    calls.length = 0;
    const full = await runLifecycleRoute(module, 'PATCH', path, {
      rawMarkdown: 'after',
      expectedUpdatedAt: marked.body.data.updatedAt
    });
    assert.equal(full.body.data.rawMarkdown, 'after');
    assert.ok(calls.some(row => row[0] === 'evidence'));
    assert.ok(calls.some(row => row[0] === 'question' && row[1] === 'noteVersion'));
  });
  return rows;
}
