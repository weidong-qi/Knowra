import assert from 'node:assert/strict';
import { createNoteWritePlan, NOTE_WRITE_TOOLS } from '../src/modules/ai/note-plan.js';
import { calculateContentHash } from '../src/modules/knowledge/domain/note-version.ts';

const base = {
  actorId: 'demo',
  ownerId: 'demo',
  datasetId: 'dataset',
  datasetEpoch: 'epoch',
  spaceId: 'space',
  requestId: 'user-request',
  operationId: 'operation-fixed',
  targetNoteId: 'note-fixed',
  allowedFolderIds: ['folder-safe'],
  allowedTagIds: ['tag-safe']
};
const note = {
  id: 'note-fixed',
  spaceId: 'space',
  title: '真实目标',
  folderId: null,
  tagIds: [],
  rawMarkdown: '重复\n重复😀\n结尾',
  updatedAt: '2026-10-01T00:00:00.000Z',
  deleted: false
};
const make = (toolName, args, trusted = { ...base, note }) =>
  createNoteWritePlan({ toolName, arguments: args, trusted });
const rejects = (run, code) => assert.throws(run, error => error.code === code);

export const aiNotePlanTests = [
  {
    name: 'P2 新建计划只使用宿主固定目标/请求，重复模型输出不生成新 ID 或授权',
    run() {
      const args = { title: ' 合成新笔记 ', rawMarkdown: '# 正文', folderId: 'folder-safe', tagIds: ['tag-safe'] };
      const first = make('notes_create', args, base),
        again = make('notes_create', structuredClone(args), base);
      assert.deepEqual(first, again);
      assert.equal(first.after.id, 'note-fixed');
      assert.equal(first.after.title, '合成新笔记');
      assert.equal(first.status, 'planned');
      assert.equal(first.approvalMode, 'requestBound');
      assert.equal(first.before, null);
      assert.equal(first.baseline.exists, false);
      assert(Object.isFrozen(first.after));
      assert.equal(args.title, ' 合成新笔记 ');
      assert.notEqual(make('notes_create', { ...args, rawMarkdown: '另一个迟到答案' }, base).planHash, first.planHash);
      rejects(() => make('notes_create', args), 'AI_NOTE_TARGET_CONFLICT');
    }
  },
  {
    name: 'P2 模型工具拒绝伪造授权/目标/基线/回执与未注册或原型名称',
    run() {
      assert.deepEqual(
        NOTE_WRITE_TOOLS.map(tool => tool.name),
        ['notes_create', 'notes_append', 'notes_propose_patch']
      );
      for (const field of [
        'authorized',
        'status',
        'operationId',
        'id',
        'expectedUpdatedAt',
        'grantId',
        'receiptHash'
      ]) {
        rejects(
          () => make('notes_create', { title: '标题', rawMarkdown: '', [field]: 'model-forged' }, base),
          'AI_NOTE_TOOL_INVALID'
        );
      }
      for (const name of ['constructor', '__proto__', 'toString', 'notes_delete', 'actions_approve']) {
        rejects(() => make(name, {}), 'AI_NOTE_TOOL_INVALID');
      }
      rejects(
        () =>
          make('notes_propose_patch', {
            noteId: note.id,
            replacements: [{ start: 0, end: 2, quote: '重复', replacement: '新', authorized: true }]
          }),
        'AI_NOTE_TOOL_INVALID'
      );
      assert(Object.isFrozen(NOTE_WRITE_TOOLS[0].parameters.properties));
    }
  },
  {
    name: 'P2 追加保持正文基线/哈希和宿主位置，不能换目标或伪造锚点',
    run() {
      const args = { noteId: note.id, rawMarkdown: '\n追加资料' };
      const plan = make('notes_append', args);
      assert.equal(plan.after.rawMarkdown, `${note.rawMarkdown}\n追加资料`);
      assert.equal(plan.baseline.contentHash, calculateContentHash(note.rawMarkdown));
      assert.equal(plan.baseline.expectedUpdatedAt, note.updatedAt);
      assert.equal(plan.edits[0].start, note.rawMarkdown.length);
      assert.equal(
        make('notes_append', args, { ...base, note, appendOffset: 2 }).after.rawMarkdown,
        '重复\n追加资料\n重复😀\n结尾'
      );
      rejects(() => make('notes_append', { ...args, noteId: 'different' }), 'AI_NOTE_TARGET_INVALID');
      rejects(() => make('notes_append', { ...args, anchor: 0 }), 'AI_NOTE_TOOL_INVALID');
      const emoji = note.rawMarkdown.indexOf('😀');
      rejects(() => make('notes_append', args, { ...base, note, appendOffset: emoji + 1 }), 'AI_NOTE_ANCHOR_INVALID');
      const newer = { ...note, updatedAt: '2026-10-01T00:00:01.000Z' };
      assert.notEqual(make('notes_append', args, { ...base, note: newer }).planHash, plan.planHash);
      assert.equal(note.rawMarkdown, '重复\n重复😀\n结尾');
    }
  },
  {
    name: 'P2 精确局部计划消歧重复片段，保留相邻正文并绑定预览',
    run() {
      const args = { noteId: note.id, replacements: [{ start: 3, end: 5, quote: '重复', replacement: '第二处' }] };
      const plan = make('notes_propose_patch', args);
      assert.equal(plan.after.rawMarkdown, '重复\n第二处😀\n结尾');
      assert.equal(plan.before.rawMarkdown, note.rawMarkdown);
      assert.equal(plan.approvalMode, 'previewRequired');
      rejects(
        () =>
          make('notes_propose_patch', {
            ...args,
            replacements: [{ start: 3, end: 5, quote: '伪造', replacement: '新' }]
          }),
        'AI_NOTE_PATCH_INVALID'
      );
      rejects(
        () =>
          make('notes_propose_patch', {
            ...args,
            replacements: [{ start: 5, end: 6, quote: note.rawMarkdown.slice(5, 6), replacement: '新' }]
          }),
        'AI_NOTE_PATCH_INVALID'
      );
      rejects(
        () =>
          make('notes_propose_patch', {
            ...args,
            replacements: [{ start: 3, end: 5, quote: '重复', replacement: '重复' }]
          }),
        'AI_NOTE_NO_CHANGE'
      );
    }
  },
  {
    name: 'P2 多片段按基线一次规划，拒绝重叠/越界，顺序规范化与哈希稳定',
    run() {
      const edits = [
        { start: 3, end: 5, quote: '重复', replacement: '第二' },
        { start: 0, end: 2, quote: '重复', replacement: '第一' }
      ];
      const plan = make('notes_propose_patch', { noteId: note.id, replacements: edits });
      assert.equal(plan.after.rawMarkdown, '第一\n第二😀\n结尾');
      assert.equal(
        make('notes_propose_patch', { noteId: note.id, replacements: [...edits].reverse() }).planHash,
        plan.planHash
      );
      assert.equal(edits[0].start, 3);
      rejects(
        () => make('notes_propose_patch', { noteId: note.id, replacements: [edits[0], edits[0]] }),
        'AI_NOTE_PATCH_INVALID'
      );
      rejects(
        () =>
          make('notes_propose_patch', {
            noteId: note.id,
            replacements: [{ start: 0, end: 1000, quote: '重复', replacement: '' }]
          }),
        'AI_NOTE_PATCH_INVALID'
      );
    }
  },
  {
    name: 'P2 计划沿用领域内容策略且拒绝目录/标签越权及失效目标',
    run() {
      for (const refs of [{ folderId: 'outside' }, { tagIds: ['outside'] }]) {
        rejects(
          () => make('notes_create', { title: '标题', rawMarkdown: '', ...refs }, base),
          'AI_NOTE_REFERENCE_DENIED'
        );
      }
      assert.throws(() =>
        make('notes_create', { title: '标题', rawMarkdown: '![外部](http://example.test/p.png)' }, base)
      );
      for (const changed of [
        { ...note, deleted: true },
        { ...note, spaceId: 'outside' },
        { ...note, id: 'outside' }
      ]) {
        rejects(
          () => make('notes_append', { noteId: note.id, rawMarkdown: '新' }, { ...base, note: changed }),
          'AI_NOTE_TARGET_INVALID'
        );
      }
      rejects(
        () =>
          make(
            'notes_append',
            { noteId: note.id, rawMarkdown: '新' },
            { ...base, note: { ...note, updatedAt: 'invalid' } }
          ),
        'AI_NOTE_BASELINE_INVALID'
      );
      rejects(() => make('notes_create', { title: '  ', rawMarkdown: '' }, base), 'AI_NOTE_TOOL_INVALID');
    }
  }
];
