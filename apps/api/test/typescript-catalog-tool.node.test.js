import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { parse } from '@babel/parser';
import * as bridge from '../src/modules/ai/catalog-tool.js';
import * as typed from '../src/modules/ai/catalog-tool.ts';
import { parentSource } from './catalog-tool.parent-source.js';

const exactParent = '18b0fabc91f681770f275fa92f6952c023e37586';
const baseline = process.env.KNOWRA_CATALOG_TOOL_BASELINE === '1';
const source = baseline
  ? execFileSync('git', ['show', `${exactParent}:apps/api/src/modules/ai/catalog-tool.js`], {
      cwd: new URL('../../../', import.meta.url),
      encoding: 'utf8'
    })
  : parentSource;
const load = text => import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
const original = await load(source);
const subject = baseline ? original : bridge;
const invalidError = { message: '目录工具参数无效。', code: 'AI_TOOL_ARGUMENTS_INVALID' };

function contract(api) {
  const rows = [];
  const add = (name, run) => rows.push({ name, run });
  add('constants and shallow frozen schemas', () => {
    assert.equal(api.FOLDER_LIMIT, 30);
    assert.equal(api.NOTE_LIMIT, 20);
    assert.equal(api.MAX_CATALOG_SPECS, 3);
    assert.deepEqual(api.CATALOG_TOOL_NAMES, ['folders_list', 'notes_list']);
    for (const item of [api.CATALOG_TOOL_NAMES, api.FOLDERS_LIST_TOOL, api.NOTES_LIST_TOOL])
      assert.ok(Object.isFrozen(item));
    assert.equal(Object.isFrozen(api.NOTES_LIST_TOOL.parameters), false);
    assert.equal(api.FOLDERS_LIST_TOOL.parameters.properties.limit.maximum, 30);
    assert.equal(api.NOTES_LIST_TOOL.parameters.properties.limit.maximum, 20);
    assert.equal(api.NOTES_LIST_TOOL.parameters.additionalProperties, false);
  });
  add('folder IDs retain whitespace', () => {
    assert.equal(api.normalizeCatalogSpec('folders_list', { parentId: ' f ' }).parentId, ' f ');
  });
  add('folder defaults and nullish pagination', () => {
    assert.deepEqual(api.normalizeCatalogSpec('folders_list', { limit: null, offset: null }), {
      kind: 'folders',
      parentId: null,
      offset: 0,
      limit: 30
    });
  });
  add('note defaults', () => {
    assert.deepEqual(api.normalizeCatalogSpec('notes_list', {}), {
      kind: 'notes',
      folderId: null,
      titleQuery: null,
      recursive: false,
      sortBy: 'updated',
      offset: 0,
      limit: 20
    });
  });
  add('note fields, untrimmed IDs and trimmed title', () => {
    assert.deepEqual(
      api.normalizeCatalogSpec('notes_list', {
        folderId: ' folder ',
        titleQuery: ' 标题 ',
        recursive: true,
        sortBy: 'annotations',
        limit: 1,
        offset: Number.MAX_SAFE_INTEGER
      }),
      {
        kind: 'notes',
        folderId: ' folder ',
        titleQuery: '标题',
        recursive: true,
        sortBy: 'annotations',
        limit: 1,
        offset: Number.MAX_SAFE_INTEGER
      }
    );
  });
  add('exact maximum boundaries and negative zero', () => {
    assert.equal(
      api.normalizeCatalogSpec('folders_list', { parentId: 'x'.repeat(128), limit: 30 }).parentId.length,
      128
    );
    assert.equal(
      api.normalizeCatalogSpec('notes_list', { titleQuery: 'x'.repeat(100), limit: 20 }).titleQuery.length,
      100
    );
    assert.ok(Object.is(api.normalizeCatalogSpec('notes_list', { offset: -0 }).offset, -0));
  });
  const invalidRows = [
    ['unknown tool', 'unknown', {}],
    ['null tool', null, {}],
    ...[undefined, null, false, 1, '', [], () => {}].map((args, i) => ['invalid container ' + i, 'folders_list', args]),
    ...[0, -1, 1.5, NaN, Infinity, '1', true, 31].map((limit, i) => ['invalid limit ' + i, 'folders_list', { limit }]),
    ...[-1, 0.5, NaN, Infinity, '0', Number.MAX_SAFE_INTEGER + 1].map((offset, i) => [
      'invalid offset ' + i,
      'notes_list',
      { offset }
    ]),
    ...['', null, 1, 'x'.repeat(129)].map((parentId, i) => ['invalid id ' + i, 'folders_list', { parentId }]),
    ...['', '  ', null, 1, 'x'.repeat(101)].map((titleQuery, i) => [
      'invalid title ' + i,
      'notes_list',
      { titleQuery }
    ]),
    ['unknown own key', 'notes_list', { extra: 1 }],
    ['wrong branch key', 'folders_list', { folderId: 'x' }],
    ['note limit overflow', 'notes_list', { limit: 21 }],
    ['recursive null', 'notes_list', { recursive: null }],
    ['recursive number', 'notes_list', { recursive: 1 }],
    ['sort null', 'notes_list', { sortBy: null }],
    ['sort unknown', 'notes_list', { sortBy: 'title' }]
  ];
  for (const [label, name, args] of invalidRows)
    add(label, () => assert.throws(() => api.normalizeCatalogSpec(name, args), invalidError));
  add('only enumerable own string keys are checked', () => {
    const args = Object.create({ parentId: 'inherited', extra: 'ignored' });
    args[Symbol('ignored')] = 1;
    Object.defineProperty(args, 'hidden', { value: 1 });
    assert.equal(api.normalizeCatalogSpec('folders_list', args).parentId, 'inherited');
  });
  add('getter rereads and evaluation order remain observable', () => {
    const seen = [];
    const args = Object.fromEntries(
      ['folderId', 'titleQuery', 'recursive', 'sortBy', 'limit', 'offset'].map(key => [key, undefined])
    );
    for (const [key, value] of Object.entries({
      folderId: 'f',
      titleQuery: ' q ',
      recursive: true,
      sortBy: 'updated',
      limit: 2,
      offset: 3
    })) {
      Object.defineProperty(args, key, {
        enumerable: true,
        get() {
          seen.push(key);
          return value;
        }
      });
    }
    api.normalizeCatalogSpec('notes_list', args);
    assert.deepEqual(seen, [
      'limit',
      'offset',
      'folderId',
      'folderId',
      'titleQuery',
      'titleQuery',
      'titleQuery',
      'titleQuery',
      'recursive',
      'recursive',
      'sortBy',
      'sortBy',
      'folderId',
      'titleQuery',
      'recursive',
      'sortBy'
    ]);
  });
  add('getter failures retain original identity', () => {
    const failure = { synthetic: true };
    assert.throws(
      () =>
        api.normalizeCatalogSpec('notes_list', {
          get limit() {
            throw failure;
          }
        }),
      error => error === failure
    );
  });
  add('call filtering, invalid arguments and duplicate recency', () => {
    const call = (parentId, status = 'succeeded') => ({
      toolName: 'folders_list',
      argumentsJson: { parentId },
      status
    });
    const calls = [
      call('a'),
      call('b'),
      call('c'),
      call('a'),
      call('d'),
      call('ignored', 'failed'),
      { toolName: 'notes_list', status: 'succeeded', argumentsJson: { limit: 0 } },
      { toolName: 'other', status: 'succeeded', argumentsJson: {} }
    ];
    assert.deepEqual(
      api.catalogSpecsFromCalls(calls).map(spec => spec.parentId),
      ['c', 'a', 'd']
    );
    assert.deepEqual(api.catalogSpecsFromCalls([]), []);
  });
  add('normalization deduplicates defaults and trimmed titles', () => {
    assert.equal(
      api.catalogSpecsFromCalls([
        { status: 'succeeded', toolName: 'notes_list', argumentsJson: { titleQuery: ' t ' } },
        {
          status: 'succeeded',
          toolName: 'notes_list',
          argumentsJson: { titleQuery: 't', recursive: false, sortBy: 'updated', limit: 20, offset: 0 }
        }
      ]).length,
      1
    );
  });
  add('one-shot iterable preserves iteration and getter short circuit', () => {
    const calls = (function* () {
      yield {
        status: 'failed',
        get toolName() {
          return assert.fail('failed call tool read');
        }
      };
      yield {
        status: 'succeeded',
        toolName: 'other',
        get argumentsJson() {
          return assert.fail('unknown tool args read');
        }
      };
      yield {
        status: 'succeeded',
        toolName: 'folders_list',
        get argumentsJson() {
          throw new Error('caught normalization getter');
        }
      };
      yield { status: 'succeeded', toolName: 'folders_list', argumentsJson: {} };
    })();
    assert.deepEqual(api.catalogSpecsFromCalls(calls), [{ kind: 'folders', parentId: null, offset: 0, limit: 30 }]);
  });
  return rows;
}
for (const row of contract(subject)) test(row.name, row.run);

test('fixed parent hash and optional exact-parent verification', () => {
  assert.equal(
    createHash('sha256').update(parentSource).digest('hex'),
    'a599bd4baa40fcbd4b6784e3aec62b07be59f197615aae79ee5d1854812d2d61'
  );
  assert.equal(source, parentSource);
});
test('same-identity JS bridge exports only original runtime names', () => {
  assert.deepEqual(Object.keys(bridge), Object.keys(original));
  assert.deepEqual(Object.keys(typed), Object.keys(original));
  for (const key of Object.keys(bridge)) assert.equal(bridge[key], typed[key]);
});
test('official type erasure preserves the full ordered executable AST', () => {
  const normalize = value =>
    Array.isArray(value)
      ? value.map(normalize)
      : value === null || typeof value !== 'object'
        ? value
        : Object.fromEntries(
            Object.entries(value)
              .filter(
                ([key]) =>
                  ![
                    'start',
                    'end',
                    'loc',
                    'extra',
                    'comments',
                    'leadingComments',
                    'trailingComments',
                    'innerComments'
                  ].includes(key)
              )
              .map(([key, nested]) => [key, normalize(nested)])
          );
  const ast = text => normalize(parse(text, { sourceType: 'module' }).program);
  const erased = stripTypeScriptTypes(
    readFileSync(new URL('../src/modules/ai/catalog-tool.ts', import.meta.url), 'utf8')
  );
  assert.deepEqual(ast(erased), ast(parentSource));
});

function outcome(api, name, args) {
  try {
    return { value: api.normalizeCatalogSpec(name, args) };
  } catch (error) {
    return { error: { name: error.name, message: error.message, code: error.code } };
  }
}
test('4096 fresh-input comparisons against frozen parent', () => {
  const values = [undefined, null, 0, -0, 1, 20, 30, 31, -1, 0.5, NaN, Infinity, '', ' x ', true, false];
  for (let index = 0; index < 4096; index++) {
    const name = index % 3 === 0 ? 'folders_list' : 'notes_list';
    const fresh = () => ({
      limit: values[index % 16],
      offset: values[(index >> 4) % 16],
      ...(index % 2 ? { titleQuery: values[(index >> 8) % 16] } : {})
    });
    assert.deepEqual(outcome(subject, name, fresh()), outcome(original, name, fresh()), 'case ' + index);
  }
});
const mutations = [
  ['reject max limit', 'limit > maxLimit', 'limit >= maxLimit'],
  ['allow fractional limits', '!Number.isSafeInteger(limit)', '!Number.isFinite(limit)'],
  ['change nullish default', 'args.limit ?? maxLimit', 'args.limit || maxLimit'],
  ['trim ids', 'parentId: args.parentId ?? null', 'parentId: args.parentId?.trim() ?? null'],
  ['omit title trim', 'args.titleQuery?.trim() ?? null', 'args.titleQuery ?? null'],
  ['change recursive default', 'args.recursive ?? false', 'args.recursive ?? true'],
  ['omit duplicate recency', 'specs.delete(key);', ''],
  ['take oldest specs', '.slice(-MAX_CATALOG_SPECS)', '.slice(0, MAX_CATALOG_SPECS)'],
  ['accept failed calls', "call.status !== 'succeeded'", "call.status === 'succeeded'"],
  ['accept unknown own keys', 'Object.keys(args).some(key => !allowed.includes(key))', 'false']
];
for (const [name, before, after] of mutations)
  test('behavioral mutant rejected: ' + name, async () => {
    assert.equal(parentSource.split(before).length - 1, 1);
    const mutant = await load(parentSource.replace(before, after));
    assert.equal(typeof mutant.normalizeCatalogSpec, 'function');
    let rejected = false;
    for (const row of contract(mutant)) {
      try {
        assert.doesNotThrow(row.run);
      } catch (error) {
        if (error.code !== 'ERR_ASSERTION') throw error;
        rejected = true;
        break;
      }
    }
    assert.ok(rejected, name);
  });
