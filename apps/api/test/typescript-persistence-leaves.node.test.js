import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPostgresCoreOperationStore } from '../src/infrastructure/postgres-core-operation-store.js';
import { createPostgresKnowledgeExtractionCommitStore } from '../src/modules/ai/postgres-knowledge-extraction-commit-store.js';
import { createPostgresSyncRuntime } from '../src/modules/sync/postgres-provider.js';

// 普通模式只读当前检出；显式旧 JS 对照才读取固定主线，缺失历史时不回退。
const baseline = process.env.KNOWRA_PERSISTENCE_LEAVES_BASELINE === '1';
const parent = '686c1862f2e35962efb284e9c8703890965728ed';
const infrastructure = new URL('../src/infrastructure/', import.meta.url);
const load = name => {
  if (!baseline) return import(new URL(`${name}.js`, infrastructure));
  const source = execFileSync('git', ['show', `${parent}:apps/api/src/infrastructure/${name}.js`], {
    cwd: new URL('../../../', import.meta.url),
    encoding: 'utf8'
  });
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
};
const { createJsonlShadowSink: createSink } = await load('annotation-shadow-log');
const { PERSISTENCE_TRANSACTION_ACTIVE: token } = await load('transaction-context');
const target = path.join(path.sep, 'shadow-test-no-real-io', 'nested', 'shadow.jsonl');
const methods = ['mkdirSync', 'existsSync', 'statSync', 'renameSync', 'appendFileSync'];

// 所有 fs 替换只在同步回调中生效，并由 finally 还原；真实 IO 仅在合成临时目录。
function fake(options, operation) {
  const original = Object.fromEntries(methods.map(name => [name, fs[name]]));
  const events = [],
    counts = {};
  const files = new Map(options.absent ? [] : [[target, options.initial ?? 'OLD']]);
  for (const name of methods)
    fs[name] = (...args) => {
      const n = (counts[name] = (counts[name] ?? 0) + 1);
      events.push([name, ...args]);
      if (options.fail === name && (!options.once || n === 1))
        throw Object.hasOwn(options, 'error') ? options.error : new Error(name);
      if (name === 'existsSync') return files.has(args[0]);
      if (name === 'statSync')
        return options.stat ? options.stat(events) : { size: options.size ?? Buffer.byteLength(files.get(args[0])) };
      if (name === 'renameSync') {
        files.set(args[1], files.get(args[0]));
        files.delete(args[0]);
      }
      if (name === 'appendFileSync') files.set(args[0], (files.get(args[0]) ?? '') + args[1]);
      return undefined;
    };
  try {
    return operation({ events, counts, files, names: () => events.map(e => e[0]) });
  } finally {
    for (const name of methods) fs[name] = original[name];
  }
}
const io = ['mkdirSync', 'existsSync', 'statSync'];
const sameError = (operation, error) => assert.throws(operation, observed => Object.is(observed, error));

test('both JS bridges expose exactly their identical TS export', { skip: baseline }, async () => {
  for (const [name, key] of [
    ['annotation-shadow-log', 'createJsonlShadowSink'],
    ['transaction-context', 'PERSISTENCE_TRANSACTION_ACTIVE']
  ]) {
    const js = await import(new URL(`${name}.js`, infrastructure));
    const ts = await import(new URL(`${name}.ts`, infrastructure));
    assert.deepEqual(Object.keys(js), [key]);
    assert.deepEqual(Object.keys(ts), [key]);
    assert.equal(js[key], ts[key]);
  }
});
test('sink creation is lazy, arity and exact append order stay unchanged', () =>
  fake({}, f => {
    const sink = createSink(target);
    assert.equal(createSink.length, 1);
    assert.equal(sink.length, 1);
    assert.deepEqual(f.events, []);
    assert.equal(sink({ id: 'x' }), undefined);
    assert.deepEqual(f.events, [
      ['mkdirSync', path.dirname(target), { recursive: true }],
      ['existsSync', target],
      ['statSync', target],
      ['appendFileSync', target, '{"id":"x"}\n']
    ]);
  }));
for (const [name, value, line] of [
  ['undefined', undefined, 'undefined\n'],
  ['null', null, 'null\n'],
  ['string', 'a\nb', '"a\\nb"\n'],
  ['number', 13, '13\n'],
  ['NaN', NaN, 'null\n'],
  ['Infinity', Infinity, 'null\n'],
  ['boolean', false, 'false\n'],
  ['symbol', Symbol('x'), 'undefined\n'],
  ['function', () => 1, 'undefined\n'],
  ['sparse array', Array(2).concat([undefined, () => 1, Symbol()]), '[null,null,null,null,null]\n'],
  ['array object', [{ x: 1 }, null], '[{"x":1},null]\n'],
  ['date', new Date('2020-01-02T00:00:00Z'), '"2020-01-02T00:00:00.000Z"\n']
])
  test(`serialization preserves ${name}`, () =>
    fake({}, f => {
      assert.equal(createSink(target)(value), undefined);
      assert.deepEqual(f.names(), [...io, 'appendFileSync']);
      assert.equal(f.events.at(-1)[2], line);
    }));
for (const [name, maxBytes, size, rotates] of [
  ['equal default', undefined, 5 * 1024 * 1024, false],
  ['above default', undefined, 5 * 1024 * 1024 + 1, true],
  ['equal zero', 0, 0, false],
  ['above zero', 0, 1, true],
  ['negative', -1, 0, true],
  ['NaN', NaN, 10, false],
  ['Infinity', Infinity, 10, false],
  ['negative Infinity', -Infinity, 0, true],
  ['equal custom', 3, 3, false],
  ['above custom', 3, 4, true],
  ['null coercion', null, 1, true],
  ['string coercion', '1', 2, true],
  ['BigInt coercion', 1n, 2, true]
])
  test(`rotation threshold: ${name}`, () =>
    fake({ size }, f => {
      assert.equal(createSink(target, { maxBytes })({ x: 1 }), undefined);
      assert.deepEqual(f.names(), [...io, ...(rotates ? ['renameSync'] : []), 'appendFileSync']);
      assert.equal(f.files.get(target), `${rotates ? '' : 'OLD'}{"x":1}\n`);
      assert.equal(f.files.get(`${target}.1`), rotates ? 'OLD' : undefined);
    }));
for (const [name, options] of [
  ['omitted', undefined],
  ['empty', {}],
  ['explicit undefined', { maxBytes: undefined }],
  ['number', 1],
  ['boolean', false],
  ['string', 'options'],
  ['BigInt', 1n],
  ['symbol', Symbol()]
]) {
  test(`options default/boxing: ${name}`, () =>
    fake({ size: 5 * 1024 * 1024 + 1 }, f => {
      createSink(target, options)(null);
      assert.deepEqual(f.names(), [...io, 'renameSync', 'appendFileSync']);
      assert.equal(f.files.get(target), 'null\n');
    }));
}
test('null options throw at construction before any IO', () =>
  fake({}, f => {
    assert.throws(() => createSink(target, null), TypeError);
    assert.deepEqual(f.events, []);
  }));
for (const inherited of [false, true])
  test(`options getter runs once at creation, inherited=${inherited}`, () =>
    fake({ size: 2 }, f => {
      let reads = 0;
      const options = {
        get maxBytes() {
          reads++;
          f.events.push(['option']);
          return 1;
        }
      };
      const sink = createSink(target, inherited ? Object.create(options) : options);
      assert.deepEqual(f.names(), ['option']);
      sink(1);
      sink(2);
      assert.equal(reads, 1);
      assert.deepEqual(f.names(), [
        'option',
        ...io,
        'renameSync',
        'appendFileSync',
        ...io,
        'renameSync',
        'appendFileSync'
      ]);
    }));
for (const error of [new Error('option'), null, Symbol('option')])
  test(`option getter thrown value escapes unchanged: ${String(error)}`, () =>
    fake({}, f => {
      sameError(
        () =>
          createSink(target, {
            get maxBytes() {
              throw error;
            }
          }),
        error
      );
      assert.deepEqual(f.events, []);
    }));
test('threshold conversion occurs at each comparison, not at creation', () =>
  fake({ size: 2 }, f => {
    let conversions = 0;
    const sink = createSink(target, {
      maxBytes: {
        valueOf() {
          f.events.push(['valueOf']);
          return ++conversions === 1 ? 1 : 3;
        }
      }
    });
    assert.equal(conversions, 0);
    sink(1);
    sink(2);
    assert.deepEqual(f.names(), [...io, 'valueOf', 'renameSync', 'appendFileSync', ...io, 'valueOf', 'appendFileSync']);
    assert.equal(f.files.get(target), '1\n2\n');
  }));
for (const maxBytes of [
  Symbol(),
  {
    valueOf() {
      throw new Error('threshold');
    }
  }
]) {
  test('threshold comparison failure is swallowed before serialize/append', () =>
    fake({}, f => {
      createSink(target, { maxBytes })({
        get x() {
          return assert.fail('must not serialize');
        }
      });
      assert.deepEqual(f.names(), io);
    }));
  test('absent file skips stat and threshold comparison', () =>
    fake({ absent: true }, f => {
      createSink(target, { maxBytes })(1);
      assert.deepEqual(f.names(), ['mkdirSync', 'existsSync', 'appendFileSync']);
      assert.equal(f.files.get(target), '1\n');
    }));
}
for (const [name, file] of [
  ['undefined', undefined],
  ['null', null],
  ['number', 1],
  ['buffer', Buffer.from('/tmp/x')],
  ['URL', new URL('file:///tmp/x')],
  ['symbol', Symbol()],
  [
    'coercible',
    {
      toString() {
        assert.fail('no coercion');
      }
    }
  ]
]) {
  test(`invalid path is swallowed on invocation: ${name}`, () =>
    fake({}, f => {
      const sink = createSink(file);
      assert.equal(
        sink({
          get x() {
            return assert.fail('no serialization');
          }
        }),
        undefined
      );
      assert.deepEqual(f.events, []);
    }));
}
for (const [name, make] of [
  ['BigInt', () => 1n],
  [
    'cycle',
    () => {
      const x = {};
      x.self = x;
      return x;
    }
  ],
  [
    'getter',
    () => ({
      get x() {
        throw new Error('getter');
      }
    })
  ],
  [
    'toJSON',
    () => ({
      toJSON() {
        throw new Error('toJSON');
      }
    })
  ]
])
  test(`serialization ${name} failure still follows rotation and next call recovers`, () =>
    fake({ size: 9 }, f => {
      const sink = createSink(target, { maxBytes: 1 });
      assert.equal(sink(make()), undefined);
      assert.deepEqual(f.names(), [...io, 'renameSync']);
      assert.equal(f.files.has(target), false);
      assert.equal(f.files.get(`${target}.1`), 'OLD');
      sink({ recovered: true });
      assert.deepEqual(f.names(), [...io, 'renameSync', 'mkdirSync', 'existsSync', 'appendFileSync']);
      assert.equal(f.files.get(target), '{"recovered":true}\n');
    }));
for (const [name, result, line] of [
  ['undefined', undefined, 'undefined\n'],
  ['function', () => 1, 'undefined\n'],
  ['symbol', Symbol(), 'undefined\n'],
  ['object', { nested: true }, '{"nested":true}\n']
]) {
  test(`inherited toJSON receiver/key and ${name} result`, () =>
    fake({ size: 9 }, f => {
      const value = Object.create({
        toJSON(key) {
          assert.equal(this, value);
          assert.equal(key, '');
          f.events.push(['toJSON']);
          return result;
        }
      });
      createSink(target, { maxBytes: 1 })(value);
      assert.deepEqual(f.names(), [...io, 'renameSync', 'toJSON', 'appendFileSync']);
      assert.equal(f.files.get(target), line);
    }));
}
test('getter is serialized after IO and no diagnostic field filtering occurs', () =>
  fake({}, f => {
    createSink(target)({
      get body() {
        f.events.push(['getter']);
        return 'not filtered';
      }
    });
    assert.deepEqual(f.names(), [...io, 'getter', 'appendFileSync']);
    assert.equal(f.events.at(-1)[2], '{"body":"not filtered"}\n');
  }));
for (const name of methods)
  for (const error of [new Error('IO'), null, Symbol('IO')]) {
    test(`IO ${name} swallows ${String(error)} and later calls recover`, () =>
      fake({ fail: name, once: true, error, size: 9 }, f => {
        const sink = createSink(target, { maxBytes: 1 });
        assert.equal(sink({ x: 1 }), undefined);
        const order = [...io, 'renameSync', 'appendFileSync'];
        assert.deepEqual(f.names(), order.slice(0, order.indexOf(name) + 1));
        assert.equal(sink({ x: 2 }), undefined);
        assert.equal(f.files.get(target), '{"x":2}\n');
      }));
  }
test('stat size getter failure is swallowed', () =>
  fake(
    {
      stat: events => ({
        get size() {
          events.push(['size']);
          throw new Error('size');
        }
      })
    },
    f => {
      createSink(target)(1);
      assert.deepEqual(f.names(), [...io, 'size']);
    }
  ));
test('append exceeding threshold rotates only on the next invocation', () =>
  fake({ initial: '' }, f => {
    const sink = createSink(target, { maxBytes: 1 });
    sink(12);
    assert.equal(f.files.get(target), '12\n');
    assert.equal(f.files.has(`${target}.1`), false);
    sink(3);
    assert.equal(f.files.get(`${target}.1`), '12\n');
    assert.equal(f.files.get(target), '3\n');
  }));
function temporary(operation) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-shadow-test-'));
  try {
    return operation(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test('real filesystem appends, rotates and replaces only the .1 backup', () =>
  temporary(root => {
    const file = path.join(root, 'nested', 'shadow.jsonl');
    const sink = createSink(file, { maxBytes: 7 });
    sink({ x: 1 });
    assert.equal(fs.readFileSync(file, 'utf8'), '{"x":1}\n');
    sink(undefined);
    assert.equal(fs.readFileSync(`${file}.1`, 'utf8'), '{"x":1}\n');
    assert.equal(fs.readFileSync(file, 'utf8'), 'undefined\n');
    sink(1n);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.readFileSync(`${file}.1`, 'utf8'), 'undefined\n');
    sink({ x: 2 });
    assert.equal(fs.readFileSync(file, 'utf8'), '{"x":2}\n');
    assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), ['shadow.jsonl', 'shadow.jsonl.1']);
  }));
test('real filesystem makes parent before a first serialization failure', () =>
  temporary(root => {
    const file = path.join(root, 'nested', 'shadow.jsonl');
    createSink(file)(1n);
    assert.equal(fs.existsSync(path.dirname(file)), true);
    assert.equal(fs.existsSync(file), false);
  }));
test('transaction token remains in the global registry across reevaluation', async () => {
  assert.equal(typeof token, 'symbol');
  assert.equal(token, Symbol.for('knowra.persistence-transaction-active'));
  assert.equal(Symbol.keyFor(token), 'knowra.persistence-transaction-active');
  const source = fs.readFileSync(
    new URL(baseline ? 'transaction-context.js' : 'transaction-context.ts', infrastructure),
    'utf8'
  );
  if (!baseline)
    assert.equal(
      (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`))
        .PERSISTENCE_TRANSACTION_ACTIVE,
      token
    );
  assert.notEqual(token, Symbol('knowra.persistence-transaction-active'));
});
const input = {
  ownerId: 'o',
  datasetId: 'd',
  datasetEpoch: 'e',
  actorId: 'a',
  spaceId: 's',
  requestId: 'r',
  operationId: 'operation',
  kind: 'notes_create',
  planHash: '0'.repeat(64)
};
for (const active of [true, 1, {}, 'active'])
  test(`both actual stores reject truthy token before transaction: ${String(active)}`, () => {
    let reads = 0;
    const client = {
      get [token]() {
        reads++;
        return active;
      },
      $transaction() {
        assert.fail('must not start nested transaction');
      }
    };
    assert.throws(
      () => createPostgresCoreOperationStore({ client, ownerId: 'o' }).commit(input, () => assert.fail('no operation')),
      /最外层事务/
    );
    assert.throws(
      () =>
        createPostgresKnowledgeExtractionCommitStore({ client, ownerId: 'o' }).runTransaction(
          () => assert.fail('no operation'),
          { jobId: 'j' }
        ),
      /最外层事务/
    );
    assert.equal(reads, 2);
  });
for (const active of [false, undefined, null, 0])
  test(`both stores enter transaction for falsy token: ${String(active)}`, () => {
    const stopped = new Error('transaction entered');
    let calls = 0;
    const client = {
      [token]: active,
      $transaction() {
        calls++;
        throw stopped;
      }
    };
    sameError(() => createPostgresCoreOperationStore({ client, ownerId: 'o' }).commit(input, () => {}), stopped);
    sameError(
      () =>
        createPostgresKnowledgeExtractionCommitStore({ client, ownerId: 'o' }).runTransaction(() => {}, { jobId: 'j' }),
      stopped
    );
    assert.equal(calls, 2);
  });
function fakeRuntime() {
  const calls = { transactions: 0, queries: 0, writes: 0 };
  const tx = {
    $queryRawUnsafe: async () => {
      calls.queries++;
      return [];
    },
    $executeRawUnsafe: async () => {
      calls.writes++;
      return 1;
    },
    syncJournal: { findUnique: async () => null }
  };
  for (const name of [
    'knowledgeSpace',
    'folder',
    'tag',
    'tagGroup',
    'note',
    'noteVersion',
    'attachment',
    'contentAnnotation',
    'knowledgeItem',
    'knowledgeEvidence',
    'learningObjective',
    'examProfile',
    'examFocus',
    'question',
    'questionObjective',
    'questionSource',
    'annotationExclusion',
    'annotationRevision',
    'analysisScopeSnapshot',
    'knowledgeArtifactProvenance'
  ])
    tx[name] = { findMany: async () => [] };
  const client = {
    ...tx,
    $transaction: async operation => {
      calls.transactions++;
      return operation(tx);
    }
  };
  return { proxy: createPostgresSyncRuntime(client, 'o').client, calls };
}
test('actual sync proxy preserves async transaction scope and rejects both nested commit stores', async () => {
  const { proxy, calls } = fakeRuntime();
  assert.equal(proxy[token], false);
  const result = await proxy.$transaction(async inside => {
    assert.equal(inside, proxy);
    assert.equal(inside[token], true);
    await Promise.resolve();
    assert.equal(inside[token], true);
    assert.throws(
      () =>
        createPostgresCoreOperationStore({ client: inside, ownerId: 'o' }).commit(input, () => assert.fail('nested')),
      /最外层事务/
    );
    assert.throws(
      () =>
        createPostgresKnowledgeExtractionCommitStore({ client: inside, ownerId: 'o' }).runTransaction(
          () => assert.fail('nested'),
          { jobId: 'j' }
        ),
      /最外层事务/
    );
    return inside.$transaction(nested => {
      assert.equal(nested[token], true);
      return 'result';
    });
  });
  assert.equal(result, 'result');
  assert.equal(proxy[token], false);
  assert.deepEqual(calls, { transactions: 1, queries: 1, writes: 1 });
});
test('actual sync proxy restores scope after failure and isolates concurrent callers', async () => {
  const { proxy, calls } = fakeRuntime();
  let release, entered;
  const ready = new Promise(resolve => {
    entered = resolve;
  });
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const error = new Error('rollback');
  const pending = proxy.$transaction(async inside => {
    assert.equal(inside[token], true);
    entered();
    await gate;
    assert.equal(inside[token], true);
    throw error;
  });
  await ready;
  assert.equal(proxy[token], false);
  assert.equal(await proxy.$transaction(inside => inside[token]), true);
  assert.equal(proxy[token], false);
  release();
  await assert.rejects(pending, observed => observed === error);
  assert.equal(proxy[token], false);
  assert.deepEqual(calls, { transactions: 2, queries: 2, writes: 1 });
});
