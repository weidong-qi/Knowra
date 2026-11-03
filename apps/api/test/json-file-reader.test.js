import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readJsonFileSync } from '../src/infrastructure/json-file-reader.ts';
import { readAttachmentInspectionSource } from '../src/infrastructure/attachment-inspection-source.ts';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import {
  assertPersistedLocalState,
  createEmptyLocalState,
  validatePersistedLocalState
} from '../src/infrastructure/local-data-schema.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const fixture = run => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-stream-json-'));
  try {
    return run(path.join(root, 'data.json'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};
function document() {
  const data = { schemaVersion: 7, ...createEmptyLocalState() };
  data.spaces.push({ id: 's', userId: 'demo', name: '空间' });
  data.notes.push({ id: 'n', spaceId: 's', title: '中文😀', rawMarkdown: '正文', tagIds: [] });
  data.noteVersions.push({ id: 'v', noteId: 'n', content: '正文', contentHash: sha('正文'), createdBy: 'demo' });
  data.contentAnnotations.push({ id: 'a', noteId: 'n', spaceId: 's', quoteText: '正文' });
  data.annotationRevisions.push({ id: 'r', annotationId: 'a', operation: 'sourceReconciled', revision: 1 });
  return data;
}

export const jsonFileReaderTests = [
  {
    name: '分块 JSON 读取与原解析保持 Unicode、特殊属性、重复键和数字语义',
    run() {
      fixture(file => {
        const values = [
          'null',
          'true',
          'false',
          '-0',
          '1e400',
          '-1.23e-4',
          '"😀中文\\n\\ud800\\udc00\\ud800"',
          '{"__proto__":{"safe":true},"constructor":1,"x":1,"x":2}',
          '[null,false,1,{"nested":["中文😀",{"long":"' + '历史正文😀'.repeat(20000) + '"}]}]'
        ];
        for (const raw of values) {
          fs.writeFileSync(file, raw);
          for (const chunkSize of [1, 7, 65536])
            assert.deepEqual(readJsonFileSync(file, { chunkSize }), JSON.parse(raw));
        }
        assert.equal({}.safe, undefined);
      });
    }
  },
  {
    name: '分块读取拒绝截断、尾随内容与非法 JSON，只有空白文件允许空初始化',
    run() {
      fixture(file => {
        for (const raw of [
          '"',
          'tru',
          '[',
          '{"x":',
          '[1,]',
          '{"x":1,}',
          '{}{}',
          'null false',
          '01',
          '1.',
          '1e',
          '\ufeff{}',
          '{"x":NaN}',
          '{/*注释*/}',
          '"未转义\n换行"',
          '{"ignored":[1,]}'
        ]) {
          fs.writeFileSync(file, raw);
          assert.throws(() => readJsonFileSync(file, { allowEmpty: true, chunkSize: 1 }), undefined, raw);
          assert.throws(() => createFileDataStore(file));
          assert.equal(fs.readFileSync(file, 'utf8'), raw);
        }
        for (const raw of ['', ' \t\r\n']) {
          fs.writeFileSync(file, raw);
          assert.equal(readJsonFileSync(file, { allowEmpty: true }), undefined);
          assert.throws(() => readJsonFileSync(file));
          assert.equal(createFileDataStore(file).state.notes.length, 0);
        }
        fs.writeFileSync(file, 'null');
        assert.throws(() => createFileDataStore(file), { code: 'STORAGE_SNAPSHOT_INVALID' });
      });
    }
  },
  {
    name: '附件投影读取保留当前归属和旧快照包装，跳过所有历史正文',
    run() {
      fixture(file => {
        const data = document();
        data.attachments.push({
          id: 'f',
          noteId: 'n',
          fileName: '附件.txt',
          storagePath: 'storage/uploads/f-附件.txt'
        });
        const expected = validatePersistedLocalState({
          ...data,
          noteVersions: [],
          contentAnnotations: [],
          annotationRevisions: []
        });
        for (const value of [data, { data }, { ...data, data: null }]) {
          fs.writeFileSync(file, JSON.stringify(value));
          assert.deepEqual(readAttachmentInspectionSource(file), expected);
        }
        fs.writeFileSync(file, JSON.stringify(data));
        assert.equal(createFileDataStore(file).state.noteVersions.length, 1);
      });
    }
  },
  {
    name: '附件投影拒绝无效集合结构、当前归属、版本和跳过区域的语法错误',
    run() {
      fixture(file => {
        const data = document();
        for (const value of [
          [],
          null,
          { ...data, schemaVersion: 999 },
          { ...data, noteVersions: {} },
          { data: { ...data, annotationRevisions: null } },
          { ...data, data: [] },
          { ...data, attachments: [{ id: 'f', noteId: 'missing', fileName: 'f' }] }
        ]) {
          fs.writeFileSync(file, JSON.stringify(value));
          assert.throws(() => readAttachmentInspectionSource(file));
        }
        const raw = JSON.stringify(data).slice(0, -1) + ',"skipped":[1,]}';
        fs.writeFileSync(file, raw);
        assert.throws(() => readAttachmentInspectionSource(file));
        const malformedHistory = { ...data, noteVersions: [{ id: 'bad' }] };
        fs.writeFileSync(file, JSON.stringify(malformedHistory));
        assert.equal(readAttachmentInspectionSource(file).attachments.length, 0);
        assert.throws(() => createFileDataStore(file), { code: 'STORAGE_SNAPSHOT_INVALID' });
      });
    }
  },
  {
    name: '投影遵循重复键最后值，重复 data 不残留前一包装对象的字段',
    run() {
      fixture(file => {
        const raw = JSON.stringify(document());
        const tail = raw.slice(1, -1);
        fs.writeFileSync(file, `{"noteVersions":{},${tail}}`);
        assert.equal(readAttachmentInspectionSource(file).notes.length, 1);
        fs.writeFileSync(file, `{${tail},"annotationRevisions":{}}`);
        assert.throws(() => readAttachmentInspectionSource(file));
        fs.writeFileSync(file, `{"data":${raw},"data":{"spaces":[],"folders":[],"tags":[],"notes":[]}}`);
        assert.equal(readAttachmentInspectionSource(file).notes.length, 0);
        fs.writeFileSync(file, `{"data":${raw},"data":{"schemaVersion":7}}`);
        assert.throws(() => readAttachmentInspectionSource(file));
      });
    }
  },
  {
    name: '写盘断言只读不可变历史且保留哈希、字段和跨引用校验，公开校验仍隔离副本',
    run() {
      const data = document(),
        before = structuredClone(data);
      for (const key of ['noteVersions', 'annotationRevisions']) {
        data[key].forEach(Object.freeze);
        Object.freeze(data[key]);
      }
      assertPersistedLocalState(data);
      assert.deepEqual(data, before);
      const copy = validatePersistedLocalState(data);
      assert.notEqual(copy.noteVersions[0], data.noteVersions[0]);
      assert.notEqual(copy.annotationRevisions[0], data.annotationRevisions[0]);
      copy.noteVersions[0].content = '独立副本';
      assert.equal(data.noteVersions[0].content, '正文');
      for (const change of [{ contentHash: '0'.repeat(64) }, { noteId: 'missing' }, { createdBy: '' }]) {
        const invalid = document();
        Object.assign(invalid.noteVersions[0], change);
        assert.throws(() => assertPersistedLocalState(invalid));
      }
      const invalid = document();
      invalid.annotationRevisions[0].annotationId = 'missing';
      assert.throws(() => assertPersistedLocalState(invalid));
    }
  },
  {
    name: '低堆限制进程可以只读检查大历史文件，内存无需容纳整个资料库',
    run() {
      fixture(file => {
        const data = document();
        delete data.noteVersions;
        const fd = fs.openSync(file, 'w');
        try {
          fs.writeSync(fd, JSON.stringify(data).slice(0, -1) + ',"noteVersions":[');
          const content = '历史正文😀'.repeat(2500);
          for (let i = 0; i < 3000; i++)
            fs.writeSync(fd, (i ? ',' : '') + JSON.stringify({ id: `large-${i}`, content }));
          fs.writeSync(fd, ']}');
        } finally {
          fs.closeSync(fd);
        }
        assert(fs.statSync(file).size > 100 * 1024 * 1024);
        const moduleUrl = new URL('../src/infrastructure/attachment-inspection-source.ts', import.meta.url).href;
        const result = spawnSync(
          process.execPath,
          [
            '--max-old-space-size=64',
            '--input-type=module',
            '-e',
            `import { readAttachmentInspectionSource } from ${JSON.stringify(moduleUrl)}; const state = readAttachmentInspectionSource(process.argv[1]); if(state.notes.length !== 1 || state.noteVersions.length !== 0) process.exit(2);`,
            file
          ],
          { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 }
        );
        assert.equal(result.status, 0, result.stderr || result.error?.message);
      });
    }
  }
];
