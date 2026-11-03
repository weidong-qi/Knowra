import assert from 'node:assert/strict';
import { buildNoteVersionPrunePreview } from '../src/modules/knowledge/application/note-version-prune-preview.js';
import { calculateContentHash } from '../src/modules/knowledge/domain/note-version.ts';
import { resolveAnalysisScopeNoteVersion } from '../src/modules/knowledge/domain/analysis-scope-version-alias.ts';

export const noteVersionPreviewIndexesTests = [
  {
    name: '版本引用预览按请求复用来源扫描与完整范围绑定验证',
    run() {
      const input = fixture(12);
      const counts = { content: 0, source: 0, provenance: 0, annotation: 0, exclusion: 0 };
      const version = input.versions[0];
      const content = version.content;
      Object.defineProperty(version, 'content', {
        get() {
          counts.content += 1;
          return content;
        }
      });
      const source = input.questionSources[0];
      Object.defineProperty(source, 'sourceType', {
        get() {
          counts.source += 1;
          return 'noteVersion';
        }
      });
      Object.defineProperty(input.provenance[0].sources[0], 'noteId', {
        get() {
          counts.provenance += 1;
          return 'n';
        }
      });
      Object.defineProperty(input.annotations[0], 'noteVersionId', {
        get() {
          counts.annotation += 1;
          return 'v0';
        }
      });
      Object.defineProperty(input.exclusions[0], 'noteVersionId', {
        get() {
          counts.exclusion += 1;
          return 'v0';
        }
      });
      const result = buildNoteVersionPrunePreview(input);
      assert.equal(result.versions.length, 12);
      assert.ok(counts.content <= 3, `单绑定正文读取不应乘版本数: ${JSON.stringify(counts)}`);
      for (const key of ['source', 'provenance', 'annotation', 'exclusion'])
        assert.ok(counts[key] <= 2, `${key}不应逐版本读取: ${JSON.stringify(counts)}`);
      input.versions[0].contentHash = '0'.repeat(64);
      assert.throws(
        () => buildNoteVersionPrunePreview(input),
        { code: 'ANALYSIS_SCOPE_VERSION_MISMATCH' },
        '不得跨请求保留成功验证'
      );
    }
  },
  {
    name: '版本引用预览与旧实现随机差分保留顺序重复跨笔记和缺失引用',
    run() {
      for (let seed = 1; seed <= 35; seed += 1) {
        const input = fixture(8);
        let state = seed;
        const random = size => {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          return state % size;
        };
        input.evidence = Array.from({ length: 20 }, (_, i) => ({
          id: `e${i % 9}`,
          noteVersionId: random(5) ? `v${random(10)}` : null
        }));
        input.provenance = Array.from({ length: 10 }, (_, i) => ({
          id: `p${i % 3}`,
          sources: Array.from({ length: 5 }, () => ({
            noteId: random(4) ? 'n' : 'other',
            originNoteVersionId: `v${random(10)}`,
            evidenceId: `e${random(12)}`
          }))
        }));
        input.questionSources = Array.from({ length: 20 }, (_, i) => ({
          id: `s${i % 7}`,
          sourceType: ['noteVersion', 'knowledgeEvidence', 'note'][random(3)],
          sourceId: random(2) ? `v${random(10)}` : `e${random(12)}`
        }));
        input.annotations = Array.from({ length: 14 }, (_, i) => ({
          id: `a${i % 5}`,
          noteVersionId: `v${random(10)}`
        }));
        input.exclusions = Array.from({ length: 10 }, (_, i) => ({ id: `x${i % 4}`, noteVersionId: `v${random(10)}` }));
        input.analysisScopes = Array.from({ length: 5 }, (_, i) => ({
          id: `scope${i % 3}`,
          noteVersions: Array.from({ length: 4 }, () => binding(input.versions[random(8)]))
        }));
        input.analysisScopes.push({ id: 'foreign', noteVersions: [{ noteId: 'other', noteVersionId: 'missing' }] });
        const before = structuredClone(input);
        deepFreeze(input);
        assert.deepEqual(buildNoteVersionPrunePreview(input), legacyPreview(input), `seed=${seed}`);
        assert.deepEqual(input, before);
      }
    }
  },
  {
    name: '版本引用预览保留同内容别名和完整绑定身份的失败关闭',
    run() {
      const variants = [
        input => {
          input.analysisScopes[0].noteVersions[0].noteVersionId = 'retired';
        },
        input => {
          input.analysisScopes[0].noteVersions.push({ ...binding(input.versions[0]), contentHash: '0'.repeat(64) });
        },
        input => {
          input.analysisScopes.push({
            id: 'same',
            noteVersions: [binding(input.versions[0])],
            segments: [{ noteId: 'n', noteVersionId: 'v0', start: 0, end: 2, markdown: '篡改' }]
          });
        },
        input => {
          input.analysisScopes.push({
            id: 'shared-binding',
            noteVersions: input.analysisScopes[0].noteVersions,
            segments: [{ noteId: 'n', noteVersionId: 'v0', start: 0, end: 2, markdown: '篡改' }]
          });
        },
        input => {
          input.versions[0].content = '篡改';
        },
        input => {
          input.analysisScopes[0].noteVersions[0].contentHash = 'bad';
        },
        input => {
          input.analysisScopes[0].noteVersions[0].noteVersionId = 'missing';
          input.analysisScopes[0].noteVersions[0].contentHash = '0'.repeat(64);
        },
        input => {
          input.versions[0].noteId = 'other';
        },
        input => {
          input.analysisScopes[0].segments = [
            { noteId: 'other', noteVersionId: 'v0', start: 0, end: 1, markdown: '正' }
          ];
        },
        input => {
          input.analysisScopes[0].contextSegments = [
            { noteId: 'n', noteVersionId: 'v0', start: 0, end: 999, markdown: '正文' }
          ];
        }
      ];
      for (const change of variants) {
        const input = fixture(3);
        change(input);
        assert.deepEqual(
          outcome(() => buildNoteVersionPrunePreview(input)),
          outcome(() => legacyPreview(input))
        );
      }
    }
  },
  {
    name: '版本引用预览保留空版本无相关范围和短路尾项的验证时机',
    run() {
      const empty = fixture(0);
      empty.analysisScopes = [{ noteVersions: null }, { noteVersions: [null] }];
      empty.provenance = [{ sources: [null] }];
      assert.deepEqual(buildNoteVersionPrunePreview(empty), legacyPreview(empty));
      const single = fixture(1);
      single.provenance[0].sources.push(null);
      single.analysisScopes[0].noteVersions.push(null);
      assert.deepEqual(buildNoteVersionPrunePreview(single), legacyPreview(single), '首项命中时不得读取损坏尾项');
      single.versions.push(fixture(2).versions[1]);
      assert.deepEqual(
        outcome(() => buildNoteVersionPrunePreview(single)),
        outcome(() => legacyPreview(single)),
        '后续版本需要尾项时才失败'
      );
      const unrelated = fixture(2);
      unrelated.analysisScopes = [{ noteVersions: [{ noteId: 'other', noteVersionId: null, contentHash: 'invalid' }] }];
      assert.deepEqual(buildNoteVersionPrunePreview(unrelated), legacyPreview(unrelated));
      const invalid = fixture(2);
      invalid.analysisScopes[0].noteVersions.push({ ...binding(invalid.versions[0]), contentHash: 'bad' });
      invalid.analysisScopes.push({ noteVersions: [null] });
      assert.deepEqual(
        outcome(() => buildNoteVersionPrunePreview(invalid)),
        outcome(() => legacyPreview(invalid)),
        '必须先触发首版后续scope错误，而非提前验证第一scope的尾项'
      );
    }
  },
  {
    name: '版本引用预览输出独立且永久保留只读裁剪标志',
    run() {
      const input = fixture(3);
      const before = structuredClone(input);
      const result = buildNoteVersionPrunePreview(input);
      assert.equal(result.mode, 'preview-only');
      assert.equal(result.retentionPointMetadataAvailable, false);
      for (const row of result.versions) assert.equal(row.canPruneNow, false);
      result.versions[0].references[0].id = '外部改写';
      assert.deepEqual(input, before);
      assert.deepEqual(buildNoteVersionPrunePreview(input), legacyPreview(input));
    }
  }
];

function fixture(count) {
  const versions = Array.from({ length: count }, (_, i) => ({
    id: `v${i}`,
    noteId: 'n',
    content: `正文${i}`,
    contentHash: calculateContentHash(`正文${i}`),
    createdAt: `2026-10-${String(i + 1).padStart(2, '0')}`,
    createdBy: 'user'
  }));
  return {
    note: { id: 'n', rawMarkdown: '正文0' },
    versions,
    evidence: [{ id: 'e0', noteVersionId: 'v0' }],
    provenance: [{ id: 'p0', sources: [{ noteId: 'n', originNoteVersionId: 'v0', evidenceId: 'e0' }] }],
    questionSources: [{ id: 's0', sourceType: 'noteVersion', sourceId: 'v0' }],
    annotations: [{ id: 'a0', noteVersionId: 'v0' }],
    exclusions: [{ id: 'x0', noteVersionId: 'v0' }],
    analysisScopes: versions.length ? [{ id: 'scope0', noteVersions: [binding(versions[0])] }] : []
  };
}
function binding(version) {
  return { noteId: version.noteId, noteVersionId: version.id, contentHash: version.contentHash };
}
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
}
function outcome(run) {
  try {
    return { result: run() };
  } catch (error) {
    return { error: { name: error.name, code: error.code, message: error.message, statusCode: error.statusCode } };
  }
}

// 重构前算法的冻结参考，仅使用合成数据验证输出和错误契约。
function legacyPreview({
  note,
  versions,
  evidence,
  provenance = [],
  questionSources,
  annotations,
  exclusions,
  analysisScopes
}) {
  const currentHash = calculateContentHash(note.rawMarkdown);
  const evidenceByVersion = new Map();
  for (const record of evidence) {
    if (!record.noteVersionId) continue;
    const values = evidenceByVersion.get(record.noteVersionId) ?? [];
    values.push(record.id);
    evidenceByVersion.set(record.noteVersionId, values);
  }
  return {
    noteId: note.id,
    mode: 'preview-only',
    retentionPointMetadataAvailable: false,
    versions: versions.map(version => {
      const references = [];
      if (version.contentHash === currentHash) references.push({ type: 'current-content', id: note.id });
      for (const id of evidenceByVersion.get(version.id) ?? []) references.push({ type: 'knowledgeEvidence', id });
      for (const record of provenance) {
        if (
          record.sources?.some(
            source =>
              source.noteId === note.id &&
              (source.originNoteVersionId === version.id ||
                (evidenceByVersion.get(version.id) ?? []).includes(source.evidenceId))
          )
        )
          references.push({ type: 'knowledgeArtifactProvenance', id: record.id });
      }
      for (const source of questionSources) {
        if (
          (source.sourceType === 'noteVersion' && source.sourceId === version.id) ||
          (source.sourceType === 'knowledgeEvidence' &&
            (evidenceByVersion.get(version.id) ?? []).includes(source.sourceId))
        ) {
          references.push({ type: 'questionSource', id: source.id });
        }
      }
      for (const annotation of annotations)
        if (annotation.noteVersionId === version.id) references.push({ type: 'contentAnnotation', id: annotation.id });
      for (const exclusion of exclusions)
        if (exclusion.noteVersionId === version.id) references.push({ type: 'annotationExclusion', id: exclusion.id });
      for (const scope of analysisScopes)
        if (
          scope.noteVersions?.some(
            binding =>
              binding.noteId === note.id && resolveAnalysisScopeNoteVersion(scope, binding, versions).id === version.id
          )
        )
          references.push({ type: 'analysisScopeSnapshot', id: scope.id });
      return {
        id: version.id,
        createdAt: version.createdAt,
        createdBy: version.createdBy,
        references,
        candidateAfterRetentionReview: references.length === 0,
        canPruneNow: false,
        reason: references.length ? 'retained-reference' : 'retention-point-not-modeled'
      };
    })
  };
}
