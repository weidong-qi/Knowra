import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectEntityBatch } from '../src/entity-batches.mjs';
import { referencesFor, syncReferencesFor } from '../../api/src/modules/sync/entity-contract.ts';
import {
  applyConceptCommand,
  emptyConceptState,
  mergeConceptChanges,
  assertConceptState
} from '../../../packages/web-core/src/knowledge-concepts/index.ts';

const now = '2026-11-12T08:00:00.000Z';
const syncState = concepts => ({
  knowledgeConcepts: concepts,
  knowledgeConceptLinks: [],
  knowledgeConceptRelations: [],
  contentAnnotations: [],
  noteVersions: [],
  personalTodos: []
});

test('合并后连续编辑与链式合并跨过 250 实体软上限，仍按有效领域状态原子同步', () => {
  let state = emptyConceptState();
  let sequence = 0;
  const execute = command => {
    state = mergeConceptChanges(
      state,
      applyConceptCommand(
        state,
        [],
        { ...command, operationId: `op${++sequence}` },
        { now, requestHash: sequence.toString(16).padStart(64, '0') }
      )
    );
  };
  for (const id of ['source', 'middle', 'target'])
    execute({ type: 'createConcept', id, name: id, expectedRevision: 0 });
  const before = structuredClone(state);
  execute({ type: 'mergeConcept', id: 'source', expectedRevision: 1, targetId: 'middle', expectedTargetRevision: 1 });
  execute({ type: 'updateConcept', id: 'middle', expectedRevision: 2, patch: { focus: 'muted' } });
  execute({ type: 'mergeConcept', id: 'middle', expectedRevision: 3, targetId: 'target', expectedTargetRevision: 1 });
  execute({ type: 'updateConcept', id: 'target', expectedRevision: 2, patch: { focus: 'muted' } });
  const base = new Map(
    before.concepts.map(value => [
      JSON.stringify(['knowledgeConcepts', value.id]),
      { collection: 'knowledgeConcepts', id: value.id, value }
    ])
  );
  const fillers = Array.from({ length: 249 }, (_, index) => ({
    collection: 'attachments',
    id: `filler${index}`,
    value: { id: `filler${index}` }
  }));
  // target 最先排队，旧实现会发送带 source 别名的 target，却留下仍有效的 source。
  const concepts = [...state.concepts]
    .reverse()
    .map(value => ({ collection: 'knowledgeConcepts', id: value.id, value }));
  const changes = [...fillers, ...concepts];
  const after = { ...syncState(state.concepts), attachments: fillers.map(entry => entry.value) };
  const first = selectEntityBatch(changes, after, base);
  assert.equal(first.length, 249);
  const second = selectEntityBatch(concepts, after, base);
  assert.equal(second.length, 3);
  const applied = mergeConceptChanges(before, { concepts: second.map(entry => entry.value), links: [], relations: [] });
  assert.doesNotThrow(() => assertConceptState(applied, []));
  assert.deepEqual(referencesFor('knowledgeConcepts', state.concepts[0]), [
    { collection: 'knowledgeConcepts', id: 'middle' }
  ]);
  assert.throws(() => selectEntityBatch(concepts, after, base, { maxEntries: 2 }), {
    code: 'SYNC_ATOMIC_GROUP_TOO_LARGE'
  });
});

test('未变化的中间合并墓碑仍连接链两端，不依赖最新 operationId', () => {
  const rows = [
    { id: 'source', mergedInto: 'middle', deletedAt: now, operationId: 'first' },
    { id: 'middle', mergedInto: 'target', deletedAt: now, operationId: 'second' },
    { id: 'target', mergedInto: null, deletedAt: null, operationId: 'edit' }
  ];
  const state = syncState(rows);
  const changes = [rows[2], rows[0]].map(value => ({ collection: 'knowledgeConcepts', id: value.id, value }));
  const batch = selectEntityBatch(changes, state, new Map(), { targetEntries: 1 });
  assert.equal(batch.length, 2);
  assert.deepEqual(
    new Set(syncReferencesFor('knowledgeConcepts', rows[2], state).map(ref => ref.id)),
    new Set(['source', 'middle'])
  );
  assert.deepEqual(referencesFor('knowledgeConceptLinks', { id: 'old', conceptId: 'gone', deletedAt: now }), []);
});
