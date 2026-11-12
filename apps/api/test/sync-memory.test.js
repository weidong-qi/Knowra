import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jsonChunks } from '../src/infrastructure/json-chunks.ts';
import { cloneJsonData } from '../src/infrastructure/json-clone.ts';
import { writeJsonFileAtomically } from '../src/infrastructure/atomic-json-file.ts';
import {
  appendChanges,
  cloneJournalForChanges,
  createJournal,
  createSyncBaseline
} from '../src/modules/sync/journal.ts';
import { createEmptyLocalState } from '../src/infrastructure/local-data-schema.ts';

export const syncMemoryTests = [
  {
    name: 'JSON 容器复制保持嵌套隔离、共享引用和空洞，安全保留特殊属性',
    run() {
      const holes = new Array(2);
      holes[1] = 1;
      const child = { nested: ['不可变正文'] },
        value = { a: child, b: child, holes, date: new Date(0) };
      Object.defineProperty(value, '__proto__', { value: { safe: true }, enumerable: true });
      const copy = cloneJsonData(value);
      assert.deepEqual(copy, structuredClone(value));
      assert.equal(copy.a, copy.b);
      assert.notEqual(copy.a, value.a);
      copy.a.nested.push('新记录');
      assert.deepEqual(value.a.nested, ['不可变正文']);
      assert.equal(Object.getPrototypeOf(copy), Object.prototype);
      const cycle = {};
      cycle.self = cycle;
      const copiedCycle = cloneJsonData(cycle);
      assert.equal(copiedCycle.self, copiedCycle);
      assert.throws(() => cloneJsonData({ invalid: () => {} }), { name: 'DataCloneError' });
    }
  },
  {
    name: '分块 JSON 与原序列化逐字节一致，保留 JSON 边界语义',
    run() {
      const shared = { value: '共同引用' };
      const holes = new Array(5);
      holes[0] = undefined;
      holes[1] = () => {};
      holes[2] = Symbol();
      holes[4] = null;
      const values = [
        null,
        3,
        '换行\n中文😀',
        {},
        [],
        { undefined, fn() {}, symbol: Symbol(), nan: NaN, inf: Infinity },
        holes,
        { a: shared, b: shared, date: new Date('2026-10-06T00:00:00Z') },
        {
          value: {
            toJSON(key) {
              return { key, value: new Number(3) };
            }
          }
        },
        { 2: '数字属性', a: new String('文本'), flag: new Boolean(false) },
        { values: Array.from({ length: 1000 }, (_, i) => ({ id: i, text: '历史正文'.repeat(70) })) }
      ];
      for (const value of values) assert.equal([...jsonChunks(value)].join(''), JSON.stringify(value, null, 2));
      const cycle = {};
      cycle.self = cycle;
      assert.throws(() => [...jsonChunks(cycle)], /circular/);
      assert.throws(() => [...jsonChunks({ value: 1n })], TypeError);
    }
  },
  {
    name: '分块写入保持文件原子性，后续块写失败与循环引用均保留旧文件',
    run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-json-chunks-'));
      const file = path.join(root, 'data.json');
      const value = { rows: Array.from({ length: 300 }, (_, id) => ({ id, content: '正文😀'.repeat(400) })) };
      try {
        let chunks = 0;
        writeJsonFileAtomically(file, value, {
          fileSystem: {
            ...fs,
            writeFileSync(fd, content, encoding) {
              chunks++;
              assert(content.length <= 64 * 1024);
              fs.writeFileSync(fd, content, encoding);
            }
          }
        });
        assert(chunks > 2);
        const original = fs.readFileSync(file, 'utf8');
        assert.equal(original, JSON.stringify(value, null, 2));
        chunks = 0;
        assert.throws(
          () =>
            writeJsonFileAtomically(file, value, {
              fileSystem: {
                ...fs,
                writeFileSync(...args) {
                  if (++chunks === 2) throw new Error('第二块磁盘故障');
                  fs.writeFileSync(...args);
                }
              }
            }),
          /磁盘故障/
        );
        const cycle = {};
        cycle.self = cycle;
        assert.throws(() => writeJsonFileAtomically(file, cycle), /circular/);
        assert.equal(fs.readFileSync(file, 'utf8'), original);
        assert.deepEqual(fs.readdirSync(root), ['data.json']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: '摘要基线与完整前像产生相同修订和删除事实，日志预览不修改原日志',
    run() {
      const state = createEmptyLocalState();
      state.notes.push({
        id: 'n',
        rawMarkdown: '长正文'.repeat(10000),
        updatedAt: '2026-10-06T00:00:00Z',
        spaceId: 's'
      });
      state.tags.push({ id: 'deleted', spaceId: 's', updatedAt: '2026-10-05T00:00:00Z' });
      const before = structuredClone(state),
        baseline = createSyncBaseline(state),
        journal = createJournal(state);
      assert.equal(baseline.notes[0].rawMarkdown, undefined);
      state.notes[0].rawMarkdown = '原地修改后的正文';
      state.tags.length = 0;
      state.folders.push({ id: 'added', spaceId: 's' });
      const original = structuredClone(journal);
      const expected = appendChanges(structuredClone(journal), before, state);
      const actual = appendChanges(cloneJournalForChanges(journal), baseline, state);
      assert.deepEqual(actual.changes, expected.changes);
      assert.deepEqual(actual.revisions, expected.revisions);
      assert.equal(actual.floor, expected.floor);
      for (const tombstone of Object.values(actual.tombstones)) {
        const counterpart = expected.tombstones[JSON.stringify([tombstone.collection, tombstone.id])];
        assert.deepEqual(
          { ...tombstone, eventId: null, deletedAt: null },
          { ...counterpart, eventId: null, deletedAt: null }
        );
      }
      assert.deepEqual(journal, original);
      assert.equal(appendChanges(cloneJournalForChanges(actual), createSyncBaseline(state), state).head, actual.head);
    }
  }
];
