import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createDraftStore } from '../src/draft-store.cjs';

test('恢复草稿原子落盘、重建实例可回读；失败不破坏旧文件', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-drafts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = 'knowra:note-draft:v1:["space","note"]';
  const draft = { markdown: '未保存的中文', baseMarkdown: '原文', baseUpdatedAt: 'v1' };
  createDraftStore(dir).write(key, draft);
  assert.deepEqual(createDraftStore(dir).read()[key], draft);
  assert.throws(() => createDraftStore(dir).write('../file', draft));
  assert.deepEqual(createDraftStore(dir).read()[key], draft);
  createDraftStore(dir).write(key, null);
  assert.deepEqual(createDraftStore(dir).read(), {});
  fs.writeFileSync(path.join(dir, 'recovery-drafts.json'), 'broken');
  assert.throws(() => createDraftStore(dir).write(key, draft));
  assert.equal(fs.readFileSync(path.join(dir, 'recovery-drafts.json'), 'utf8'), 'broken');
});

test('原生知识草稿保留来源与 CAS，兼容正文草稿，拒绝失去基线的记录', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-knowledge-drafts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = 'knowra:knowledge-draft:v1:["dataset-a","k1"]';
  const value = { title: '知识', canonicalStatement: '陈述', userExplanation: '', knowledgeType: 'concept' };
  const draft = {
    version: 1,
    kind: 'create',
    candidateId: 'k1',
    value,
    initialValue: value,
    source: {
      annotationId: 'a1',
      noteVersionId: 'v1',
      expectedAnnotationRevision: 3,
      quoteText: '原文',
      headingPath: ['标题']
    }
  };
  const store = createDraftStore(dir);
  store.write('knowra:note-draft:v1:["space","note"]', { markdown: '正文草稿', baseMarkdown: '原文' });
  store.write(key, draft);
  assert.deepEqual(createDraftStore(dir).read()[key], draft);
  assert.throws(() => store.write(key, { ...draft, kind: 'edit', source: undefined }));
  assert.throws(() => store.write(key, { ...draft, candidateId: 'other' }));
  store.write(key, { ...draft, kind: 'edit', source: undefined, expectedUpdatedAt: 'old-version' });
  assert.equal(createDraftStore(dir).read()[key].expectedUpdatedAt, 'old-version');
  store.write(key, null);
  assert.equal(Object.keys(createDraftStore(dir).read()).length, 1);
});

test('原生定义草稿重建后保留目标概念，拒绝无效目标且不覆盖原草稿', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-definition-drafts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = 'knowra:knowledge-draft:v1:["dataset-a","definition-1"]';
  const value = { title: '数学的定义', canonicalStatement: '定义正文', userExplanation: '', knowledgeType: 'concept' };
  const draft = {
    version: 1,
    kind: 'create',
    candidateId: 'definition-1',
    value,
    initialValue: value,
    definitionTarget: { conceptId: 'math', conceptName: '数学' }
  };
  const store = createDraftStore(dir);
  store.write(key, draft);
  assert.deepEqual(createDraftStore(dir).read()[key], draft);
  assert.throws(() => store.write(key, { ...draft, definitionTarget: { conceptId: '', conceptName: '数学' } }));
  assert.throws(() => store.write(key, { ...draft, value: { ...value, knowledgeType: 'fact' } }));
  assert.deepEqual(createDraftStore(dir).read()[key], draft);
});
