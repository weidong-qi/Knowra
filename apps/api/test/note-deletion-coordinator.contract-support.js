import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAppContext } from '../src/app.factory.js';
import { createInMemoryNoteRepository } from '../src/modules/knowledge/infrastructure/note-repository.js';
import { handleNoteRoute } from '../src/modules/knowledge/http/note-routes.js';
import { noteDeletionCoordinatorTests } from './note-deletion-coordinator.test.js';

// 准确实际父正文与固定独立预期；普通测试不依赖 Git，也不从候选生成预期。
export const deletionParent = 'e598512343ecc4fa662ce84c7d95f6e8b65a24b9';
export const deletionFrozenSource =
  "export function createNoteDeletionCoordinator({\n  noteService,\n  noteRepository,\n  noteVersionRepository,\n  contentAnnotationRepository,\n  annotationExclusionRepository,\n  annotationRevisionRepository,\n  attachmentStore,\n  runTransaction = (operation) => operation()\n}) {\n  function removeDependents(noteIds) {\n    const annotationIds = typeof contentAnnotationRepository?.list === 'function'\n      ? contentAnnotationRepository.list({ includeDeleted: true })\n        .filter((annotation) => noteIds.includes(annotation.noteId))\n        .map((annotation) => annotation.id)\n      : [];\n    annotationExclusionRepository?.deleteByAnnotationIds?.(annotationIds);\n    annotationRevisionRepository?.deleteByAnnotationIds?.(annotationIds);\n    contentAnnotationRepository?.deleteByNoteIds?.(noteIds);\n    noteVersionRepository?.deleteByNoteIds?.(noteIds);\n    return attachmentStore?.detachAttachmentsForNotes?.(noteIds) ?? [];\n  }\n\n  function finishAttachmentCleanup(attachments) {\n    return attachmentStore?.removeDetachedAttachmentFiles?.(attachments) ?? [];\n  }\n\n  function permanentlyDeleteNote(noteId) {\n    let detachedAttachments = [];\n    const deletedNote = runTransaction(() => {\n      const result = noteService.permanentlyDeleteNote(noteId);\n      detachedAttachments = removeDependents([noteId]);\n      return result;\n    });\n\n    const attachmentCleanup = finishAttachmentCleanup(detachedAttachments);\n    return attachmentCleanup.length ? { ...deletedNote, attachmentCleanup } : deletedNote;\n  }\n\n  function emptyRecycleBin(spaceId = null) {\n    const noteIds = noteRepository\n      .list({ includeDeleted: true, spaceId })\n      .filter((note) => note.deleted)\n      .map((note) => note.id);\n    let detachedAttachments = [];\n    const result = runTransaction(() => {\n      const deletion = noteService.emptyRecycleBin(spaceId);\n      detachedAttachments = removeDependents(noteIds);\n      return deletion;\n    });\n\n    const attachmentCleanup = finishAttachmentCleanup(detachedAttachments);\n    return attachmentCleanup.length ? { ...result, attachmentCleanup } : result;\n  }\n\n  return {\n    permanentlyDeleteNote,\n    emptyRecycleBin\n  };\n}\n";
export const deletionSourceSha = 'cc41fd88ebd74dd11ec2dddb5efdde893b969d650a06a9505a8210052bb74b8b';
export const hash = value => createHash('sha256').update(value).digest('hex');
export function deletionContractCases(subject) {
  const create = subject.createNoteDeletionCoordinator;
  const results = [];
  const check = (name, run) => results.push({ name, run });
  const names = events => events.map(event => event[0]);
  function fixture({
    notes = [{ id: 'n', deleted: true }],
    annotations = [{ id: 'a', noteId: 'n' }],
    noteResult = { id: 'n' },
    recycleResult = { deletedCount: 1 },
    detached = [{ id: 'file' }],
    cleanup = []
  } = {}) {
    const events = [];
    const record = (name, self, ...args) => {
      events.push([name, self, ...args]);
    };
    const options = {
      noteService: {
        permanentlyDeleteNote(id) {
          record('delete', this, id);
          return noteResult;
        },
        emptyRecycleBin(space) {
          record('empty', this, space);
          return recycleResult;
        }
      },
      noteRepository: {
        list(input) {
          record('notes', this, input);
          return notes;
        }
      },
      contentAnnotationRepository: {
        list(input) {
          record('annotations:list', this, input);
          return annotations;
        },
        deleteByNoteIds(ids) {
          record('annotations:delete', this, ids);
        }
      },
      annotationExclusionRepository: {
        deleteByAnnotationIds(ids) {
          record('exclusions', this, ids);
        }
      },
      annotationRevisionRepository: {
        deleteByAnnotationIds(ids) {
          record('revisions', this, ids);
        }
      },
      noteVersionRepository: {
        deleteByNoteIds(ids) {
          record('versions', this, ids);
        }
      },
      attachmentStore: {
        detachAttachmentsForNotes(ids) {
          record('detach', this, ids);
          return detached;
        },
        removeDetachedAttachmentFiles(items) {
          record('cleanup', this, items);
          return cleanup;
        }
      },
      runTransaction(operation) {
        record('begin', this);
        const result = operation();
        record('commit', this);
        return result;
      }
    };
    const coordinator = create(options);
    return { options, coordinator, events, noteResult, recycleResult, detached, cleanup };
  }
  const full = [
    'begin',
    'delete',
    'annotations:list',
    'exclusions',
    'revisions',
    'annotations:delete',
    'versions',
    'detach',
    'commit',
    'cleanup'
  ];
  check('factory and hook shape/arity stay synchronous', () => {
    assert.equal(create.length, 1);
    const f = fixture();
    assert.deepEqual(Object.keys(f.coordinator), ['permanentlyDeleteNote', 'emptyRecycleBin']);
    assert.equal(f.coordinator.permanentlyDeleteNote.length, 1);
    assert.equal(f.coordinator.emptyRecycleBin.length, 0);
    assert.equal(f.coordinator.permanentlyDeleteNote.constructor.name, 'Function');
    assert.equal(f.coordinator.emptyRecycleBin.constructor.name, 'Function');
  });
  for (const value of [undefined, null])
    check('missing options throws synchronously ' + value, () => assert.throws(() => create(value), TypeError));
  check('missing collaborators remain lazy', () => {
    const c = create({});
    assert.throws(() => c.permanentlyDeleteNote('x'), TypeError);
    assert.throws(() => c.emptyRecycleBin(), TypeError);
  });
  check('single deletion exact order/arguments/receiver and no-cleanup identity', () => {
    const f = fixture();
    assert.equal(f.coordinator.permanentlyDeleteNote('n'), f.noteResult);
    assert.deepEqual(names(f.events), full);
    for (const name of [
      'delete',
      'annotations:list',
      'exclusions',
      'revisions',
      'annotations:delete',
      'versions',
      'detach',
      'cleanup'
    ]) {
      const e = f.events.find(x => x[0] === name);
      assert.notEqual(e[1], undefined);
    }
    assert.equal(f.events[0][1], undefined);
    assert.deepEqual(f.events.find(x => x[0] === 'annotations:list')[2], { includeDeleted: true });
    assert.equal(f.events.at(-1)[2], f.detached);
  });
  check('recycle scan precedes transaction and all downstream order preserved', () => {
    const f = fixture();
    assert.equal(f.coordinator.emptyRecycleBin('s'), f.recycleResult);
    assert.deepEqual(names(f.events), ['notes', ...full.map(n => (n === 'delete' ? 'empty' : n))]);
    assert.deepEqual(f.events[0][2], { includeDeleted: true, spaceId: 's' });
  });
  for (const value of [undefined, null, 0, false, '', Symbol('s'), { id: 's' }])
    check('space argument exact default/preservation ' + typeof value + String(value), () => {
      const f = fixture();
      f.coordinator.emptyRecycleBin(value);
      const expected = value === undefined ? null : value;
      assert.equal(f.events[0][2].spaceId, expected);
      assert.equal(f.events.find(x => x[0] === 'empty')[2], expected);
    });
  for (const missing of [undefined, null])
    check('optional ports nullish ' + missing, () => {
      const result = {};
      const c = create({
        noteService: { permanentlyDeleteNote: () => result, emptyRecycleBin: () => result },
        noteRepository: { list: () => [] },
        noteVersionRepository: missing,
        contentAnnotationRepository: missing,
        annotationExclusionRepository: missing,
        annotationRevisionRepository: missing,
        attachmentStore: missing
      });
      assert.equal(c.permanentlyDeleteNote(Symbol()), result);
      assert.equal(c.emptyRecycleBin(), result);
    });
  for (const list of [undefined, null, false, 0, 'ignored', {}])
    check('non-callable annotation list is ignored ' + typeof list + String(list), () => {
      const f = fixture();
      f.options.contentAnnotationRepository.list = list;
      f.coordinator.permanentlyDeleteNote('n');
      assert.deepEqual(f.events.find(x => x[0] === 'exclusions')[2], []);
      assert.ok(!names(f.events).includes('annotations:list'));
    });
  check('annotation list getter is read twice and called with repository receiver', () => {
    const f = fixture();
    let read = 0;
    Object.defineProperty(f.options.contentAnnotationRepository, 'list', {
      get() {
        read++;
        return function () {
          assert.equal(this, f.options.contentAnnotationRepository);
          return [];
        };
      }
    });
    f.coordinator.permanentlyDeleteNote('n');
    assert.equal(read, 2);
  });
  check('second annotation list getter failure happens after transaction/service and before exclusions', () => {
    const f = fixture();
    let read = 0;
    Object.defineProperty(f.options.contentAnnotationRepository, 'list', {
      get() {
        return ++read === 1 ? () => [] : undefined;
      }
    });
    assert.throws(() => f.coordinator.permanentlyDeleteNote('n'), TypeError);
    assert.deepEqual(names(f.events), ['begin', 'delete']);
  });
  check('captured options objects but late-bound port methods', () => {
    const f = fixture();
    f.options.noteService = {
      permanentlyDeleteNote() {
        throw Error('replacement object must not be used');
      }
    };
    const old = f.events;
    f.coordinator.permanentlyDeleteNote('n');
    assert.ok(names(old).includes('delete'));
    const g = fixture();
    g.options.noteService.permanentlyDeleteNote = function () {
      return { late: true };
    };
    assert.deepEqual(g.coordinator.permanentlyDeleteNote('n'), { late: true });
  });
  check('annotation and note IDs preserve identity duplicates and SameValueZero', () => {
    const id = {},
      sym = Symbol();
    const f = fixture({
      notes: [
        { id, deleted: true },
        { id, deleted: 1 },
        { id: sym, deleted: 'yes' },
        { id: NaN, deleted: true },
        { id: '0', deleted: true },
        { id: 0, deleted: true },
        { id: 'live', deleted: false }
      ],
      annotations: [
        { id: 1, noteId: id },
        { id: 1, noteId: id },
        { id: 2, noteId: sym },
        { id: 3, noteId: NaN },
        { id: 4, noteId: 'other' }
      ]
    });
    f.coordinator.emptyRecycleBin();
    assert.deepEqual(f.events.find(x => x[0] === 'exclusions')[2], [1, 1, 2, 3]);
    assert.deepEqual(f.events.find(x => x[0] === 'versions')[2], [id, id, sym, NaN, '0', 0]);
  });
  check('filter/map skip sparse holes without densifying', () => {
    const notes = Array(4);
    notes[2] = { id: 'n', deleted: true };
    const annotations = Array(4);
    annotations[3] = { id: 'a', noteId: 'n' };
    const f = fixture({ notes, annotations });
    f.coordinator.emptyRecycleBin();
    assert.deepEqual(f.events.find(x => x[0] === 'versions')[2], ['n']);
    assert.deepEqual(f.events.find(x => x[0] === 'exclusions')[2], ['a']);
  });
  check('custom filter/map receivers and exact callbacks are honored', () => {
    const log = [];
    const note = { id: 'n', deleted: 1 },
      annotation = { id: 'a', noteId: 'n' };
    function collection(item) {
      const mapped = {
        map(callback) {
          log.push(['map', this]);
          return [callback(item)];
        }
      };
      return {
        filter(callback) {
          log.push(['filter', this]);
          assert.ok(callback(item));
          return mapped;
        }
      };
    }
    const notes = collection(note),
      annotations = collection(annotation),
      f = fixture({ notes, annotations });
    f.coordinator.emptyRecycleBin();
    assert.equal(log.length, 4);
    assert.equal(log[0][1], notes);
    assert.equal(log[2][1], annotations);
  });
  check('annotation ID array shared and mutable across exclusion then revision', () => {
    const f = fixture();
    let shared;
    f.options.annotationExclusionRepository.deleteByAnnotationIds = ids => {
      shared = ids;
      ids.push('injected');
    };
    f.options.annotationRevisionRepository.deleteByAnnotationIds = ids => {
      assert.equal(ids, shared);
      assert.deepEqual(ids, ['a', 'injected']);
    };
    f.coordinator.permanentlyDeleteNote('n');
  });
  check('note ID array shared and mutable across delete/version/detach', () => {
    const f = fixture();
    let shared;
    f.options.contentAnnotationRepository.deleteByNoteIds = ids => {
      shared = ids;
      ids.push('extra');
    };
    f.coordinator.permanentlyDeleteNote('n');
    assert.equal(f.events.find(x => x[0] === 'versions')[2], shared);
    assert.equal(f.events.find(x => x[0] === 'detach')[2], shared);
    assert.deepEqual(shared, ['n', 'extra']);
  });
  check('custom map result with custom includes remains unchanged at runtime', () => {
    const ids = {
        includes(id) {
          assert.equal(this, ids);
          return id === 'n' ? 'truthy' : false;
        }
      },
      f = fixture({
        notes: {
          filter() {
            return {
              map() {
                return ids;
              }
            };
          }
        }
      });
    f.coordinator.emptyRecycleBin();
    assert.equal(f.events.find(x => x[0] === 'versions')[2], ids);
    assert.deepEqual(f.events.find(x => x[0] === 'exclusions')[2], ['a']);
  });
  for (const value of [undefined, null])
    check('nullish detached payload falls back to fresh empty array ' + value, () => {
      const f = fixture({ detached: value });
      f.options.attachmentStore.detachAttachmentsForNotes = () => value;
      f.coordinator.permanentlyDeleteNote('n');
      assert.deepEqual(f.events.at(-1)[2], []);
    });
  for (const value of [false, 0, 'payload', { custom: true }])
    check('non-nullish detached payload forwarded unchanged ' + typeof value, () => {
      const f = fixture({ detached: value });
      f.coordinator.permanentlyDeleteNote('n');
      assert.equal(f.events.at(-1)[2], value);
    });
  for (const value of [undefined, null, false, 0, [], { length: 0 }, { length: '' }])
    check('false cleanup length or nullish cleanup preserves result ' + typeof value + String(value), () => {
      const f = fixture();
      f.options.attachmentStore.removeDetachedAttachmentFiles = () => value;
      assert.equal(f.coordinator.permanentlyDeleteNote('n'), f.noteResult);
    });
  for (const value of ['cleanup', { length: '0' }, { length: [] }, [{ ok: true }]])
    check('truthy cleanup length creates shallow object ' + String(value), () => {
      const f = fixture({ cleanup: value });
      const result = f.coordinator.permanentlyDeleteNote('n');
      assert.notEqual(result, f.noteResult);
      assert.deepEqual(result, { id: 'n', attachmentCleanup: value });
      assert.equal(result.attachmentCleanup, value);
    });
  check('cleanup length getter runs before result own getters and exactly once', () => {
    const order = [],
      result = {
        get id() {
          order.push('id');
          return 1;
        }
      },
      cleanup = {
        get length() {
          order.push('length');
          return true;
        }
      },
      f = fixture({ noteResult: result, cleanup });
    const answer = f.coordinator.permanentlyDeleteNote('n');
    assert.deepEqual(order, ['length', 'id']);
    assert.equal(answer.attachmentCleanup, cleanup);
  });
  check('spread loses prototype/nonenumerables, preserves enumerable symbols and overrides prior cleanup', () => {
    const sym = Symbol(),
      proto = { inherited: 1 },
      result = Object.assign(Object.create(proto), { id: 'n', attachmentCleanup: 'old', [sym]: 2 });
    Object.defineProperty(result, 'hidden', { value: 3 });
    const f = fixture({ noteResult: result, cleanup: [1] });
    const value = f.coordinator.permanentlyDeleteNote('n');
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
    assert.equal(value.inherited, undefined);
    assert.equal(value.hidden, undefined);
    assert.equal(value[sym], 2);
    assert.equal(value.attachmentCleanup, f.cleanup);
  });
  for (const result of [null, undefined, 0, false, 'abc'])
    check('legacy primitive result spread behavior is not guarded ' + String(result), () => {
      const f = fixture({ cleanup: [1] });
      f.options.noteService.permanentlyDeleteNote = () => result;
      const value = f.coordinator.permanentlyDeleteNote('n');
      assert.deepEqual(value, { ...result, attachmentCleanup: f.cleanup });
    });
  check('service and ignored cleanup-stage thenables are not assimilated', () => {
    const poison = Object.defineProperty({}, 'then', {
        get() {
          throw Error('then read');
        }
      }),
      f = fixture({ noteResult: poison });
    for (const [object, key] of [
      [f.options.annotationExclusionRepository, 'deleteByAnnotationIds'],
      [f.options.annotationRevisionRepository, 'deleteByAnnotationIds'],
      [f.options.contentAnnotationRepository, 'deleteByNoteIds'],
      [f.options.noteVersionRepository, 'deleteByNoteIds']
    ])
      object[key] = () => poison;
    assert.equal(f.coordinator.permanentlyDeleteNote('n'), poison);
  });
  check('Promise service result preserves identity and cleanup happens synchronously', () => {
    const promise = Promise.resolve('result'),
      f = fixture({ noteResult: promise });
    assert.equal(f.coordinator.permanentlyDeleteNote('n'), promise);
    assert.equal(f.events.at(-1)[0], 'cleanup');
  });
  check('legacy async transaction is not awaited or repaired', () => {
    const f = fixture();
    let callback;
    const promise = Promise.resolve('transaction');
    const c = create({
      ...f.options,
      runTransaction(op) {
        callback = op;
        return promise;
      }
    });
    assert.equal(c.permanentlyDeleteNote('n'), promise);
    assert.deepEqual(names(f.events), ['cleanup']);
    assert.deepEqual(f.events[0][2], []);
    callback();
    assert.deepEqual(names(f.events), [
      'cleanup',
      'delete',
      'annotations:list',
      'exclusions',
      'revisions',
      'annotations:delete',
      'versions',
      'detach'
    ]);
  });
  check('transaction return, not service return, controls returned identity', () => {
    const f = fixture(),
      replacement = { runner: true },
      c = create({
        ...f.options,
        runTransaction(operation) {
          operation();
          return replacement;
        }
      });
    assert.equal(c.permanentlyDeleteNote('n'), replacement);
  });
  check('transaction invokes callback twice, last detached payload wins', () => {
    const f = fixture();
    let count = 0;
    f.options.attachmentStore.detachAttachmentsForNotes = () => ++count;
    const c = create({
      ...f.options,
      runTransaction(operation) {
        operation();
        return operation();
      }
    });
    c.permanentlyDeleteNote('n');
    assert.equal(f.events.at(-1)[2], 2);
  });
  for (const method of ['permanentlyDeleteNote', 'emptyRecycleBin'])
    for (const stage of ['service', 'list', 'exclusions', 'revisions', 'annotations', 'versions', 'detach', 'cleanup'])
      check('sentinel error exact and short-circuits ' + method + '/' + stage, () => {
        const f = fixture(),
          sentinel = { stage };
        const targets = {
          service: [f.options.noteService, method],
          list: [f.options.contentAnnotationRepository, 'list'],
          exclusions: [f.options.annotationExclusionRepository, 'deleteByAnnotationIds'],
          revisions: [f.options.annotationRevisionRepository, 'deleteByAnnotationIds'],
          annotations: [f.options.contentAnnotationRepository, 'deleteByNoteIds'],
          versions: [f.options.noteVersionRepository, 'deleteByNoteIds'],
          detach: [f.options.attachmentStore, 'detachAttachmentsForNotes'],
          cleanup: [f.options.attachmentStore, 'removeDetachedAttachmentFiles']
        };
        const [target, key] = targets[stage];
        target[key] = () => {
          f.events.push(['throw:' + stage]);
          throw sentinel;
        };
        assert.throws(
          () => f.coordinator[method]('n'),
          error => error === sentinel
        );
        assert.equal(f.events.at(-1)[0], 'throw:' + stage);
        assert.equal(names(f.events).includes('commit'), stage === 'cleanup');
      });
  check('recycle snapshot failure happens before transaction', () => {
    const f = fixture(),
      sentinel = {};
    f.options.noteRepository.list = () => {
      throw sentinel;
    };
    assert.throws(
      () => f.coordinator.emptyRecycleBin(),
      e => e === sentinel
    );
    assert.deepEqual(f.events, []);
  });
  check('cleanup length throw follows commit without undoing service or detach', () => {
    const sentinel = {},
      f = fixture({
        cleanup: {
          get length() {
            throw sentinel;
          }
        }
      });
    assert.throws(
      () => f.coordinator.permanentlyDeleteNote('n'),
      e => e === sentinel
    );
    assert.deepEqual(names(f.events), full);
  });
  check('result spread getter failure follows cleanup and is unchanged', () => {
    const sentinel = {},
      f = fixture({
        noteResult: {
          get id() {
            throw sentinel;
          }
        },
        cleanup: [1]
      });
    assert.throws(
      () => f.coordinator.permanentlyDeleteNote('n'),
      e => e === sentinel
    );
    assert.deepEqual(names(f.events), full);
  });
  for (const method of ['permanentlyDeleteNote', 'emptyRecycleBin']) {
    check('exact collaborator receivers ' + method, () => {
      const f = fixture();
      f.coordinator[method]('n');
      const map = {
        delete: 'noteService',
        empty: 'noteService',
        notes: 'noteRepository',
        'annotations:list': 'contentAnnotationRepository',
        'annotations:delete': 'contentAnnotationRepository',
        exclusions: 'annotationExclusionRepository',
        revisions: 'annotationRevisionRepository',
        versions: 'noteVersionRepository',
        detach: 'attachmentStore',
        cleanup: 'attachmentStore'
      };
      for (const [name, self] of f.events) {
        assert.equal(self, map[name] ? f.options[map[name]] : undefined, name);
      }
    });
    check('both empty ID notifications survive ' + method, () => {
      const f = fixture({ notes: [], annotations: [] });
      f.coordinator[method]('n');
      assert.deepEqual(f.events.find(x => x[0] === 'exclusions')[2], []);
      assert.deepEqual(f.events.find(x => x[0] === 'revisions')[2], []);
      assert.deepEqual(
        names(f.events),
        method === 'emptyRecycleBin' ? ['notes', ...full.map(x => (x === 'delete' ? 'empty' : x))] : full
      );
    });
    check('non-string annotation IDs remain identities ' + method, () => {
      const id = {},
        sym = Symbol();
      const f = fixture({
        annotations: [
          { id, noteId: 'n' },
          { id: sym, noteId: 'n' },
          { id: undefined, noteId: 'n' },
          { id: null, noteId: 'n' }
        ]
      });
      f.coordinator[method]('n');
      assert.deepEqual(f.events.find(x => x[0] === 'exclusions')[2], [id, sym, undefined, null]);
    });
    check('ID arrays remain shared under upstream mutation ' + method, () => {
      const f = fixture();
      let annotations, notes;
      f.options.annotationExclusionRepository.deleteByAnnotationIds = ids => {
        annotations = ids;
        ids.push('mutable');
      };
      f.options.annotationRevisionRepository.deleteByAnnotationIds = ids => {
        assert.equal(ids, annotations);
        assert.equal(ids.at(-1), 'mutable');
      };
      f.options.contentAnnotationRepository.deleteByNoteIds = ids => {
        notes = ids;
        ids.push('mutable-note');
      };
      f.coordinator[method]('n');
      assert.equal(f.events.find(x => x[0] === 'versions')[2], notes);
      assert.equal(f.events.find(x => x[0] === 'detach')[2], notes);
    });
    check('null service result no-cleanup identity and nonempty spread ' + method, () => {
      for (const value of [null, undefined, false, 0, 'xy']) {
        const f = fixture();
        f.options.noteService[method] = () => value;
        assert.equal(f.coordinator[method]('n'), value);
        f.options.attachmentStore.removeDetachedAttachmentFiles = () => [1];
        assert.deepEqual(f.coordinator[method]('n'), { ...value, attachmentCleanup: [1] });
      }
    });
    check('cleanup occurs outside and after returned synchronous transaction ' + method, () => {
      const f = fixture();
      let active = false,
        returned = false;
      const c = create({
        ...f.options,
        runTransaction(operation) {
          active = true;
          const value = operation();
          active = false;
          returned = true;
          return value;
        }
      });
      f.options.attachmentStore.removeDetachedAttachmentFiles = () => {
        assert.equal(active, false);
        assert.equal(returned, true);
        return [];
      };
      c[method]('n');
    });
    check('optional methods remain callable or nullish not truthy guards ' + method, () => {
      for (const [port, key] of [
        ['noteVersionRepository', 'deleteByNoteIds'],
        ['annotationExclusionRepository', 'deleteByAnnotationIds'],
        ['annotationRevisionRepository', 'deleteByAnnotationIds'],
        ['contentAnnotationRepository', 'deleteByNoteIds'],
        ['attachmentStore', 'detachAttachmentsForNotes'],
        ['attachmentStore', 'removeDetachedAttachmentFiles']
      ])
        for (const value of [null, undefined]) {
          const f = fixture();
          f.options[port][key] = value;
          f.coordinator[method]('n');
        }
    });
    check('synchronous runner never reads ignored then getter ' + method, () => {
      const poison = Object.defineProperty({}, 'then', {
          get() {
            return assert.fail('then must not be read');
          }
        }),
        f = fixture();
      f.options.noteService[method] = () => poison;
      assert.equal(f.coordinator[method]('n'), poison);
    });
  }
  check('recycle uses the snapshot before transaction and never relists', () => {
    const first = { id: 'before', deleted: true },
      records = [first],
      f = fixture({ notes: records });
    let lists = 0;
    f.options.noteRepository.list = () => {
      lists++;
      return records;
    };
    const c = create({
      ...f.options,
      runTransaction(op) {
        records.splice(0, 1, { id: 'during', deleted: true });
        return op();
      }
    });
    c.emptyRecycleBin();
    assert.equal(lists, 1);
    assert.deepEqual(f.events.find(x => x[0] === 'versions')[2], ['before']);
  });
  check('deleted truthiness includes nonboolean values but excludes all falsy values', () => {
    const values = [false, 0, '', null, undefined, NaN, true, 1, 'yes', [], {}];
    const f = fixture({ notes: values.map((deleted, id) => ({ id, deleted })) });
    f.coordinator.emptyRecycleBin();
    assert.deepEqual(f.events.find(x => x[0] === 'versions')[2], [6, 7, 8, 9, 10]);
  });
  check('permanent input ID is never normalized', () => {
    for (const id of [0, '0', NaN, {}, Symbol(), null, undefined]) {
      const f = fixture({ annotations: [{ id: 'match', noteId: id }] });
      f.coordinator.permanentlyDeleteNote(id);
      assert.equal(f.events.find(x => x[0] === 'delete')[2], id);
      assert.deepEqual(f.events.find(x => x[0] === 'exclusions')[2], ['match']);
      assert.equal(f.events.find(x => x[0] === 'versions')[2][0], id);
    }
  });
  check('cleanup getter late-binding after detach and transaction', () => {
    const f = fixture();
    const replacement = [];
    f.options.attachmentStore.detachAttachmentsForNotes = () => {
      f.options.attachmentStore.removeDetachedAttachmentFiles = () => replacement;
      return 'detached';
    };
    assert.equal(f.coordinator.permanentlyDeleteNote('n'), f.noteResult);
  });
  check('explicit null transaction is not defaulted and fails before service', () => {
    const f = fixture();
    const c = create({ ...f.options, runTransaction: null });
    assert.throws(() => c.permanentlyDeleteNote('n'), TypeError);
    assert.deepEqual(f.events, []);
  });

  check('default identity transaction invokes operation and preserves result', () => {
    const result = { ok: true };
    const c = create({
      noteService: { permanentlyDeleteNote: () => result, emptyRecycleBin: () => result },
      noteRepository: { list: () => [] }
    });
    assert.equal(c.permanentlyDeleteNote('n'), result);
    assert.equal(c.emptyRecycleBin(), result);
  });

  for (const method of ['permanentlyDeleteNote', 'emptyRecycleBin']) {
    check('cleanup with length never assimilates then getter ' + method, () => {
      const cleanup = {
        length: 'truthy',
        get then() {
          return assert.fail('cleanup then getter');
        }
      };
      const f = fixture({ cleanup });
      const result = f.coordinator[method]('n');
      assert.equal(result.attachmentCleanup, cleanup);
      assert.equal(f.events.at(-1)[0], 'cleanup');
    });
    check('out-of-domain Promise cleanup retains synchronous original result ' + method, () => {
      const f = fixture({ cleanup: Promise.resolve('ignored cleanup promise') });
      assert.equal(f.coordinator[method]('n'), method === 'permanentlyDeleteNote' ? f.noteResult : f.recycleResult);
      assert.equal(f.events.at(-1)[0], 'cleanup');
    });
  }
  return results;
}
export function deletionConsumerCases() {
  const results = [];
  const check = (name, run) => results.push({ name, run });
  function make(records, cleanup = []) {
    const events = [],
      files = [{ id: 'file', noteId: 'n' }];
    const repo = createInMemoryNoteRepository({ records, onChange: () => events.push('notes:changed') });
    let app;
    const attachmentStore = {
      detachAttachmentsForNotes(ids) {
        events.push('detach');
        assert.ok(ids.every(id => repo.findById(id) === null));
        for (const id of ids) {
          assert.equal(
            app.modules.knowledge.repositories.contentAnnotationRepository.list({ noteId: id, includeDeleted: true })
              .length,
            0
          );
          assert.equal(app.modules.knowledge.repositories.noteVersionRepository.list({ noteId: id }).length, 0);
        }
        return files;
      },
      removeDetachedAttachmentFiles(given) {
        events.push('cleanup');
        assert.equal(given, files);
        return cleanup;
      }
    };
    app = createAppContext({ noteRepository: repo, attachmentStore, ownerId: 'demo', annotationShadowSink: null });
    return { app, repo, events, files };
  }
  const note = (id = 'n', spaceId = 's', deleted = true) => ({
    id,
    title: 'Synthetic',
    rawMarkdown: 'synthetic only',
    spaceId,
    deleted,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  });
  check('real app factory/HTTP handler/module/service/memory repo: deletion identity and dependencies', () => {
    const record = note(),
      f = make([record]),
      r = f.app.modules.knowledge.repositories;
    r.contentAnnotationRepository.save({ id: 'a', noteId: 'n', lifecycleStatus: 'active' });
    r.annotationExclusionRepository.save({ id: 'e', parentAnnotationId: 'a' });
    r.annotationRevisionRepository.save({ id: 'r', annotationId: 'a' });
    r.noteVersionRepository.save({ id: 'v', noteId: 'n', contentHash: 'hash' });
    const returned = f.app.http.knowledge.permanentlyDeleteNote({ id: 'n' });
    assert.equal(returned, record);
    assert.equal(r.annotationExclusionRepository.findById('e'), null);
    assert.equal(r.annotationRevisionRepository.findById('r'), null);
    assert.deepEqual(f.events, ['notes:changed', 'detach', 'cleanup']);
  });
  check('real app cleanup payload clones deleted result only when nonempty', () => {
    const record = note(),
      cleanup = [{ id: 'file', cleanup: 'done' }],
      f = make([record], cleanup);
    const returned = f.app.http.knowledge.permanentlyDeleteNote({ id: 'n' });
    assert.notEqual(returned, record);
    assert.equal(returned.id, record.id);
    assert.equal(returned.attachmentCleanup, cleanup);
  });
  check('real app rejects active note before dependencies/files', () => {
    const record = note('n', 's', false),
      f = make([record]);
    assert.throws(
      () => f.app.http.knowledge.permanentlyDeleteNote({ id: 'n' }),
      e => e.code === 'NOTE_NOT_IN_RECYCLE_BIN' && e.statusCode === 409
    );
    assert.equal(f.repo.findById('n'), record);
    assert.deepEqual(f.events, []);
  });
  check('real app formal evidence blocks deletion before dependencies/files', () => {
    const record = note(),
      f = make([record]);
    f.app.modules.knowledge.repositories.knowledgeEvidenceRepository.save({ id: 'ev', noteId: 'n' });
    assert.throws(
      () => f.app.http.knowledge.permanentlyDeleteNote({ id: 'n' }),
      e => e.code === 'NOTE_HAS_KNOWLEDGE_EVIDENCE' && e.statusCode === 409
    );
    assert.equal(f.repo.findById('n'), record);
    assert.deepEqual(f.events, []);
  });
  check('real app empty recycle scope retains live and other-space notes', () => {
    const records = [note('n'), note('live', 's', false), note('other', 'other')],
      f = make(records);
    const result = f.app.http.knowledge.emptyRecycleBin({ spaceId: 's' });
    assert.deepEqual(result, { deletedCount: 1, noteIds: ['n'] });
    assert.equal(f.repo.findById('n'), null);
    assert.ok(f.repo.findById('live'));
    assert.ok(f.repo.findById('other'));
    assert.deepEqual(f.events, ['notes:changed', 'detach', 'cleanup']);
  });
  check('real app late-bound service method is used by captured coordinator', () => {
    const f = make([]);
    const returned = { custom: true };
    f.app.modules.knowledge.noteService.permanentlyDeleteNote = () => returned;
    assert.equal(f.app.http.knowledge.permanentlyDeleteNote({ id: 'n' }), returned);
    assert.deepEqual(f.events, ['detach', 'cleanup']);
  });
  for (const [pathname, records, expected] of [
    ['/api/knowledge/notes/n/permanent', [note()], { id: 'n' }],
    ['/api/knowledge/notes/recycle-bin?spaceId=s', [note()], { deletedCount: 1 }]
  ])
    check('real route to actual app handler without HTTP/socket ' + pathname, async () => {
      const f = make(records),
        writes = [];
      const response = {
        writeHead(status, headers) {
          writes.push({ status, headers });
        },
        end(body) {
          writes.push({ body });
        }
      };
      const handled = await handleNoteRoute({
        request: { method: 'DELETE' },
        response,
        url: new URL('http://synthetic.invalid' + pathname),
        knowledge: f.app.http.knowledge
      });
      assert.equal(handled, true);
      assert.equal(writes[0].status, 200);
      const body = JSON.parse(writes[1].body);
      for (const [key, value] of Object.entries(expected)) assert.equal(body.data[key], value);
      assert.equal(f.events.at(-1), 'cleanup');
    });
  for (const test of noteDeletionCoordinatorTests) check('existing .run: ' + test.name, () => test.run());

  return results;
}

// 每次调用重建所有输入、getter、集合及失败对象；完整有序轨迹包含读取、接收者、别名和即时数组内容。
export function observeDeletion(subject, seed) {
  const events = [],
    identities = new Map(),
    sentinel = { failure: seed };
  let serial = 0,
    calls = 0;
  const remember = (value, label) => {
    identities.set(value, label);
    return value;
  };
  const objectId = remember({}, 'object-id'),
    symbolId = Symbol('symbol-id');
  identities.set(symbolId, 'symbol-id');
  const ids = ['n', 0, '0', NaN, objectId, symbolId, null, undefined];
  const id = ids[(seed >>> 1) % ids.length],
    mode = (seed >>> 4) % 8;
  const operation = seed % 2 ? 'emptyRecycleBin' : 'permanentlyDeleteNote';
  const failure = (seed >>> 7) % 16;
  const encode = value => {
    if (value === undefined) return { primitive: 'undefined' };
    if (typeof value === 'number' && Number.isNaN(value)) return { primitive: 'NaN' };
    if (value === null || (typeof value !== 'object' && typeof value !== 'function' && typeof value !== 'symbol'))
      return value;
    if (!identities.has(value)) identities.set(value, 'anonymous-' + ++serial);
    const identity = identities.get(value);
    return Array.isArray(value) ? { identity, values: value.map(encode), length: value.length } : { identity };
  };
  const event = (name, ...args) => {
    events.push([name, ...args.map(encode)]);
  };
  const record = (label, values) => {
    const value = remember({}, label);
    for (const [key, content] of Object.entries(values))
      Object.defineProperty(value, key, {
        enumerable: true,
        get() {
          event('read:' + label + '.' + key);
          return content;
        }
      });
    return value;
  };
  const note = record('note', { id, deleted: mode === 3 ? 0 : mode === 4 ? '' : 'truthy' });
  const other = record('other-note', { id: 'other', deleted: true });
  const annotation = record('annotation', { id: symbolId, noteId: id });
  const irrelevant = record('irrelevant', { id: objectId, noteId: 'other' });
  const notes = remember(mode === 1 ? [] : [note, note, other], 'notes');
  const annotations = remember(mode === 2 ? [] : [annotation, annotation, irrelevant], 'annotations');
  if (mode === 5) {
    notes.length = 5;
    annotations.length = 5;
  }
  const collection = (label, rows) =>
    mode === 6
      ? remember(
          {
            filter(callback) {
              event(label + ':filter', this);
              const filtered = rows.filter(callback);
              return remember(
                {
                  map(fn) {
                    event(label + ':map', this);
                    return filtered.map(fn);
                  }
                },
                label + ':mapped'
              );
            }
          },
          label + ':collection'
        )
      : rows;
  const result = record('service-result', { id, attachmentCleanup: 'old' });
  Object.defineProperty(result, symbolId, { enumerable: true, value: 'symbol-value' });
  const detached = remember([objectId], 'detached'),
    cleanup = remember({}, 'cleanup');
  Object.defineProperty(cleanup, 'length', {
    get() {
      event('read:cleanup.length');
      return mode % 3 === 0 ? 0 : mode % 3 === 1 ? 'truthy' : [];
    }
  });
  const poison = Object.defineProperty({}, 'then', {
    get() {
      return assert.fail('ignored then getter');
    }
  });
  const options = {},
    makePort = (name, methods) => {
      const port = remember({}, name);
      options[name] = port;
      for (const [key, body] of Object.entries(methods))
        Object.defineProperty(port, key, {
          configurable: true,
          get() {
            event('get:' + name + '.' + key);
            return function (...args) {
              event('call:' + name + '.' + key, this, ...args);
              if (++calls === failure) {
                event('throw:sentinel');
                throw sentinel;
              }
              return body(...args);
            };
          }
        });
      return port;
    };
  makePort('noteService', { permanentlyDeleteNote: () => result, emptyRecycleBin: () => result });
  makePort('noteRepository', {
    list(input) {
      event('note-options', input.includeDeleted, input.spaceId);
      return collection('notes', notes);
    }
  });
  makePort('contentAnnotationRepository', {
    list(input) {
      event('annotation-options', input.includeDeleted);
      return collection('annotations', annotations);
    },
    deleteByNoteIds(values) {
      if (mode === 7) values.push('mutated-note');
      return poison;
    }
  });
  makePort('annotationExclusionRepository', {
    deleteByAnnotationIds(values) {
      if (mode === 7) values.push('mutated-annotation');
      return poison;
    }
  });
  makePort('annotationRevisionRepository', { deleteByAnnotationIds: () => poison });
  makePort('noteVersionRepository', { deleteByNoteIds: () => poison });
  makePort('attachmentStore', {
    detachAttachmentsForNotes: () => (mode === 4 ? null : mode === 5 ? false : detached),
    removeDetachedAttachmentFiles: () => cleanup
  });
  options.runTransaction = function (callback) {
    event('begin', this);
    if (++calls === failure) {
      event('throw:sentinel');
      throw sentinel;
    }
    const value = callback();
    event('commit', value);
    return value;
  };
  const captured = {};
  for (const [key, value] of Object.entries(options))
    Object.defineProperty(captured, key, {
      get() {
        event('get:options.' + key);
        return value;
      }
    });
  let outcome;
  try {
    const value = subject.createNoteDeletionCoordinator(captured)[operation](id);
    outcome =
      value === result
        ? { kind: 'identity' }
        : {
            kind: 'spread',
            keys: Reflect.ownKeys(value).map(encode),
            values: Reflect.ownKeys(value).map(key => encode(value[key])),
            plainPrototype: Object.getPrototypeOf(value) === Object.prototype
          };
  } catch (error) {
    outcome =
      error === sentinel ? { kind: 'sentinel' } : { kind: 'unexpected', name: error?.name, message: error?.message };
  }
  return { operation, mode, failure, events, outcome };
}
