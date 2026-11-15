import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergePdfNoteActivity } from '../src/pdf-note-activity.mjs';

const previous = {
  id: 'pdf',
  contentKind: 'pdf',
  spaceId: 'space',
  title: '原文件名',
  rawMarkdown: '',
  tagIds: [],
  pdfSource: { attachmentId: 'file', sha256: 'a'.repeat(64) },
  deleted: false,
  aiVisibility: 'normal',
  updatedAt: '2026-11-15T00:00:00.000Z'
};
const remote = { ...previous, updatedAt: '2026-11-15T00:02:00.000Z' };
const local = { ...previous, title: '离线重命名', updatedAt: '2026-11-15T00:01:00.000Z' };

test('PDF 远端仅活动时间变化时保留离线修改，合并日期不倒退且不改写输入', () => {
  assert.deepEqual(mergePdfNoteActivity(previous, remote, local, { sameEpoch: true }), {
    ...local,
    updatedAt: remote.updatedAt
  });
  const newer = { ...local, updatedAt: '2026-11-15T00:03:00.000Z' };
  assert.deepEqual(mergePdfNoteActivity(previous, remote, newer, { sameEpoch: true }), newer);
  assert.equal(local.updatedAt, '2026-11-15T00:01:00.000Z');
  assert.equal(remote.title, '原文件名');
});

test('远端业务内容、来源身份和隐私变化仍需核对', () => {
  for (const change of [
    { title: '远端重命名' },
    { tagIds: ['tag'] },
    { deleted: true },
    { aiVisibility: 'private' },
    { pdfSource: { ...previous.pdfSource, sha256: 'b'.repeat(64) } }
  ])
    assert.equal(mergePdfNoteActivity(previous, { ...remote, ...change }, local, { sameEpoch: true }), null);
});

test('新资料库、永久删除、缺失基线和普通笔记不能使用 PDF 活动自动合并', () => {
  assert.equal(mergePdfNoteActivity(previous, remote, local, { sameEpoch: false }), null);
  for (const [base, incoming, pending] of [
    [null, remote, local],
    [previous, null, local],
    [previous, remote, null],
    [previous, { ...remote, id: 'other' }, local],
    [
      { ...previous, contentKind: 'markdown' },
      { ...remote, contentKind: 'markdown' },
      { ...local, contentKind: 'markdown' }
    ]
  ])
    assert.equal(mergePdfNoteActivity(base, incoming, pending, { sameEpoch: true }), null);
});
