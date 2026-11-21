import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateBackupDrafts } from '../src/backup.mjs';

test('备份草稿保留定义目标与候选 ID，拒绝无效定义上下文', () => {
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
  const record = { version: 1, drafts: { [key]: draft } };
  assert.deepEqual(JSON.parse(JSON.stringify(validateBackupDrafts(record))), record);
  for (const invalid of [
    { ...draft, definitionTarget: null },
    { ...draft, definitionTarget: { conceptId: '', conceptName: '数学' } },
    { ...draft, value: { ...value, knowledgeType: 'fact' } }
  ])
    assert.throws(() => validateBackupDrafts({ version: 1, drafts: { [key]: invalid } }), /知识恢复草稿格式无效/);
});
