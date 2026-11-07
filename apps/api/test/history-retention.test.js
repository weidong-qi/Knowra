import assert from 'node:assert/strict';
import {
  planHistoryRetention,
  applyHistoryRetentionPlan,
  selectAnnotationRevisionsToPrune,
  ANNOTATION_REVISION_RETENTION
} from '../src/modules/knowledge/domain/history-retention.ts';
import { createEmptyLocalState } from '../src/infrastructure/local-data-schema.js';
import { calculateContentHash } from '../src/modules/knowledge/domain/note-version.ts';
import {
  selectVersionsToPrune,
  NOTE_VERSION_RETENTION
} from '../src/modules/knowledge/domain/note-version-retention.ts';

const DAY = 86400000,
  now = Date.UTC(2026, 9, 9, 12);
const revision = (number, age = DAY, extra = {}) => ({
  id: `annotation-revision-${number}`,
  annotationId: 'a',
  revision: number,
  operation: 'sourceReconciled',
  createdAt: new Date(now - age).toISOString(),
  oldAnchor: { noteVersionId: `v${number - 1}` },
  newAnchor: { noteVersionId: `v${number}` },
  rangeSummary: { quoteText: `正文${number}` },
  ...extra
});
const version = (number, age = 40 * DAY) => ({
  id: `v${number}`,
  noteId: 'n',
  content: `正文${number}`,
  contentHash: calculateContentHash(`正文${number}`),
  createdAt: new Date(now - age).toISOString()
});

const deletedAnnotation = (id, age, extra = {}) => ({
  id,
  noteId: 'n',
  revision: 2,
  lifecycleStatus: 'deleted',
  deletedAt: new Date(now - age).toISOString(),
  updatedAt: new Date(now - age).toISOString(),
  quoteText: id,
  ...extra
});

export const historyRetentionTests = [
  {
    name: '留存到期不授权自动删除：v1/v2 旧重点、修订、排除及引用的正文默认保全',
    run() {
      for (const schemaVersion of [undefined, 1, 2]) {
        const state = createEmptyLocalState();
        state.notes = [{ id: 'n', rawMarkdown: '正文9' }];
        state.noteVersions = [version(0), version(1), version(9)];
        state.contentAnnotations = [
          deletedAnnotation('legacy', 8 * DAY, { schemaVersion, revision: 2, noteVersionId: 'v0' })
        ];
        state.annotationExclusions = [{ id: 'exclusion', parentAnnotationId: 'legacy' }];
        state.annotationRevisions = [
          revision(1, 40 * DAY, { annotationId: 'legacy', newAnchor: { noteVersionId: 'v1' }, oldAnchor: null }),
          revision(2, 8 * DAY, { annotationId: 'legacy', newAnchor: null, oldAnchor: null })
        ];
        const before = structuredClone(state);
        for (const at of [now - DAY - 1, now - DAY, now - DAY + 1, now + 30 * DAY]) {
          const plan = planHistoryRetention(state, { now: at });
          assert.equal(plan.removedAnnotations.size, 0);
          assert.equal(plan.removedExclusions.size, 0);
          assert.equal(plan.removedRevisions.size, 0);
          assert.equal(plan.removedVersions.size, 0);
          assert.deepEqual(applyHistoryRetentionPlan(state, plan), before);
          assert.deepEqual(state, before, '预演不修改原状态');
        }
      }
    }
  },
  {
    name: '显式维护预演才规划旧重点回收；未满 7 天、仍活跃或被引用的保留',
    run() {
      const state = createEmptyLocalState();
      state.notes = [{ id: 'n', rawMarkdown: '正文' }];
      state.contentAnnotations = [
        deletedAnnotation('annotation-old', 8 * DAY),
        deletedAnnotation('annotation-recent', 6 * DAY),
        deletedAnnotation('annotation-evidence', 30 * DAY),
        deletedAnnotation('annotation-scope', 30 * DAY),
        deletedAnnotation('annotation-private', 30 * DAY),
        deletedAnnotation('annotation-undated', 30 * DAY, { deletedAt: null, updatedAt: null }),
        {
          id: 'annotation-active',
          noteId: 'n',
          revision: 1,
          lifecycleStatus: 'active',
          updatedAt: new Date(now - 90 * DAY).toISOString()
        }
      ];
      state.annotationExclusions = [{ id: 'exclusion-old', parentAnnotationId: 'annotation-old', anchor: {} }];
      state.annotationRevisions = [
        revision(1, 9 * DAY, { id: 'annotation-revision-old-1', annotationId: 'annotation-old', operation: 'created' }),
        revision(2, 8 * DAY, { id: 'annotation-revision-old-2', annotationId: 'annotation-old', operation: 'deleted' })
      ];
      state.knowledgeEvidence = [
        { id: 'e', sourceType: 'annotation', annotationId: 'annotation-evidence', noteId: 'n' }
      ];
      state.analysisScopeSnapshots = [{ id: 's', selections: [{ annotationId: 'annotation-scope' }] }];
      const plan = planHistoryRetention(state, {
        now,
        allowDeletedAnnotationPrune: true,
        externalReferences: [JSON.stringify({ annotationId: 'annotation-private' })]
      });
      assert.deepEqual([...plan.removedAnnotations], ['annotation-old']);
      assert.deepEqual([...plan.removedExclusions], ['exclusion-old']);
      const result = applyHistoryRetentionPlan(state, plan);
      assert.deepEqual(result.contentAnnotations.map(item => item.id).sort(), [
        'annotation-active',
        'annotation-evidence',
        'annotation-private',
        'annotation-recent',
        'annotation-scope',
        'annotation-undated'
      ]);
      assert.deepEqual(result.annotationExclusions, []);
      assert.deepEqual(result.annotationRevisions, []);
      assert.equal(plan.summary.contentAnnotations.removed, 1);
    }
  },
  {
    name: '重点的排除区间或修订不能回收（被引用或未同步门禁）时整条保留',
    run() {
      const state = createEmptyLocalState();
      state.notes = [{ id: 'n', rawMarkdown: '正文' }];
      state.contentAnnotations = [
        deletedAnnotation('annotation-a', 30 * DAY),
        deletedAnnotation('annotation-b', 30 * DAY)
      ];
      state.annotationExclusions = [{ id: 'exclusion-a', parentAnnotationId: 'annotation-a', anchor: {} }];
      state.annotationRevisions = [
        revision(1, 30 * DAY, { id: 'annotation-revision-b-1', annotationId: 'annotation-b' })
      ];
      state.knowledgeArtifactProvenance = [
        { sources: [{ annotationRevisions: [{ annotationId: 'annotation-b', revision: 1 }] }] }
      ];
      const plan = planHistoryRetention(state, {
        now,
        allowDeletedAnnotationPrune: true,
        canDiscard: collection => collection !== 'annotationExclusions'
      });
      assert.equal(plan.removedAnnotations.size, 0);
      assert.equal(plan.removedExclusions.size, 0);
      const synced = planHistoryRetention(
        { ...state, annotationExclusions: [], knowledgeArtifactProvenance: [] },
        { now, allowDeletedAnnotationPrune: true, canDiscard: collection => collection !== 'contentAnnotations' }
      );
      assert.equal(synced.removedAnnotations.size, 0, '已同步的重点只由云端回收');
    }
  },

  {
    name: '标注恢复点同时受时间采样、数量、年龄及字节限制，来源引用例外保留',
    run() {
      const records = Array.from({ length: 35 }, (_, i) => revision(i + 1, i * 11 * 60000));
      records.push(revision(100, 8 * DAY), revision(101, 9 * DAY));
      const removed = selectAnnotationRevisionsToPrune({
        revisions: records,
        now,
        protectedIds: new Set(['annotation-revision-101'])
      });
      assert.equal(records.length - removed.length, 11);
      assert.ok(removed.includes('annotation-revision-100'));
      assert.ok(!removed.includes('annotation-revision-101'));
      const sameWindow = [revision(1, 1000), revision(2, 500)];
      assert.deepEqual(selectAnnotationRevisionsToPrune({ revisions: sameWindow, now }), ['annotation-revision-1']);
      const giant = revision(10, DAY, { rangeSummary: { quoteText: 'x'.repeat(1024) } });
      assert.deepEqual(
        selectAnnotationRevisionsToPrune({
          revisions: [giant],
          now,
          policy: { ...ANNOTATION_REVISION_RETENTION, maxBytesPerAnnotation: 512 }
        }),
        [giant.id]
      );
      assert.deepEqual(
        selectAnnotationRevisionsToPrune({
          revisions: [giant],
          now,
          protectedIds: new Set([giant.id]),
          policy: { ...ANNOTATION_REVISION_RETENTION, maxBytesPerAnnotation: 512 }
        }),
        []
      );
    }
  },
  {
    name: '先清标注过程再清正文；确切来源、旧 Evidence 见证和私有任务引用都保留',
    run() {
      const state = createEmptyLocalState();
      state.notes = [{ id: 'n', rawMarkdown: '正文9' }];
      state.noteVersions = Array.from({ length: 10 }, (_, i) => version(i));
      state.contentAnnotations = [{ id: 'a', noteId: 'n', noteVersionId: 'v9', revision: 9, quoteText: '正文9' }];
      state.annotationRevisions = Array.from({ length: 9 }, (_, i) => revision(i + 1, 40 * DAY));
      state.knowledgeArtifactProvenance = [
        { sources: [{ annotationRevisions: [{ annotationId: 'a', revision: 2 }] }] }
      ];
      state.analysisScopeSnapshots = [{ annotationRevisions: [{ annotationId: 'a', revision: 4 }] }];
      state.knowledgeEvidence = [
        { sourceType: 'annotation', annotationId: 'a', noteId: 'n', noteVersionId: 'v6', quoteText: '正文6' }
      ];
      const before = structuredClone(state);
      const plan = planHistoryRetention(state, {
        now,
        externalReferences: [JSON.stringify({ annotationRevisions: [{ annotationId: 'a', revision: 8 }] })]
      });
      const result = applyHistoryRetentionPlan(state, plan);
      assert.deepEqual(state, before, '预览不改写任何输入');
      assert.deepEqual(
        result.annotationRevisions.map(record => record.revision),
        [2, 4, 6, 8, 9]
      );
      assert.deepEqual(
        result.noteVersions.map(record => record.id),
        ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9']
      );
      assert.deepEqual(result.knowledgeEvidence, before.knowledgeEvidence);
      assert.deepEqual(result.knowledgeArtifactProvenance, before.knowledgeArtifactProvenance);
    }
  },
  {
    name: '私有直接修订 ID 和不可删除门禁不会在清理正文时丢失依赖',
    run() {
      const state = createEmptyLocalState();
      state.notes = [{ id: 'n', rawMarkdown: '正文3' }];
      state.contentAnnotations = [{ id: 'a', noteId: 'n', revision: 3 }];
      state.noteVersions = [version(0), version(1), version(2), version(3)];
      state.annotationRevisions = [revision(1, 40 * DAY), revision(2, 40 * DAY), revision(3, 40 * DAY)];
      const plan = planHistoryRetention(state, {
        now,
        externalReferences: ['任务需要 annotation-revision-1'],
        canDiscard: (collection, record) => collection !== 'annotationRevisions' || record.revision !== 2
      });
      assert.equal(plan.removedRevisions.size, 0);
      assert.equal(plan.removedVersions.size, 0);
    }
  },
  {
    name: '正文恢复点的字节预算不能靠大版本或来源引用绕过删除保护',
    run() {
      const small = version(1, DAY),
        large = { ...version(2, DAY + 1000), content: 'x'.repeat(2048) };
      assert.deepEqual(
        selectVersionsToPrune({
          versions: [small, large],
          now,
          policy: { ...NOTE_VERSION_RETENTION, maxBytesPerNote: 512 }
        }),
        [large.id]
      );
      assert.deepEqual(
        selectVersionsToPrune({
          versions: [small, large],
          now,
          protectedIds: new Set([large.id]),
          policy: { ...NOTE_VERSION_RETENTION, maxBytesPerNote: 512 }
        }),
        []
      );
    }
  }
];
