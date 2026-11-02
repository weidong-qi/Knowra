import assert from 'node:assert/strict';
import {
  selectVersionsToPrune,
  NOTE_VERSION_RETENTION
} from '../src/modules/knowledge/domain/note-version-retention.ts';
import { pruneTouchedNoteVersions } from '../src/modules/sync/version-retention.ts';
import { calculateContentHash } from '../src/modules/knowledge/domain/note-version.ts';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 5, 30, 12);
const version = (id, ageMs, noteId = 'n1', content = id) => ({
  id,
  noteId,
  content,
  contentHash: calculateContentHash(content),
  createdAt: new Date(now - ageMs).toISOString(),
  createdBy: 'user'
});

export const noteVersionRetentionTests = [
  {
    name: '保留策略：24 小时内按十分钟采样，之后按天采样，三十天前过期',
    run() {
      const versions = [
        version('r1', HOUR + 500),
        version('r1-duplicate', HOUR + 1000),
        version('r2', 2 * HOUR),
        version('r3', 3 * HOUR),
        version('d-new', 2 * DAY + HOUR),
        version('d-old', 2 * DAY + 2 * HOUR),
        version('w-new', 60 * DAY + HOUR),
        version('w-old', 60 * DAY + 2 * HOUR)
      ];
      assert.deepEqual(selectVersionsToPrune({ versions, now }).sort(), ['d-old', 'r1-duplicate', 'w-new', 'w-old']);
    }
  },
  {
    name: '保留策略：每篇上限从最旧的未受保护版本开始删，受保护版本永不删除',
    run() {
      const versions = Array.from({ length: 150 }, (_, index) =>
        version(`v${index}`, index * 20 * 60 * 1000 + HOUR / 2)
      );
      const removed = selectVersionsToPrune({
        versions,
        now: now - 2 * DAY + 0,
        policy: { ...NOTE_VERSION_RETENTION, recentMs: 365 * DAY }
      });
      assert.equal(removed.length, 130);
      assert.ok(
        removed.every(id => Number(id.slice(1)) >= 20),
        '删除的是最旧的 130 个'
      );
      const protectedId = 'v149';
      const withProtected = selectVersionsToPrune({
        versions,
        now,
        policy: { ...NOTE_VERSION_RETENTION, recentMs: 365 * DAY },
        protectedIds: new Set([protectedId])
      });
      assert.ok(!withProtected.includes(protectedId));
    }
  },
  {
    name: '云端批次清理：只清理被触及笔记中未被引用、非当前、非本批提交的旧版本',
    run() {
      const current = version('cur', HOUR, 'n1', '最新正文');
      const old = ['a', 'b', 'c'].map((suffix, index) => version(`old-${suffix}`, 40 * DAY + index * HOUR, 'n1'));
      const cited = old[1];
      const otherNote = version('other-old', 40 * DAY, 'n2');
      const otherNoteB = version('other-old-b', 40 * DAY + HOUR, 'n2');
      const state = {
        notes: [
          { id: 'n1', rawMarkdown: '最新正文' },
          { id: 'n2', rawMarkdown: 'x' }
        ],
        noteVersions: [current, ...old, otherNote, otherNoteB],
        contentAnnotations: [{ id: 'a1', noteId: 'n1', noteVersionId: cited.id }],
        annotationRevisions: [],
        annotationExclusions: [],
        knowledgeEvidence: [],
        knowledgeArtifactProvenance: [],
        questionSources: [],
        analysisScopeSnapshots: []
      };
      const result = pruneTouchedNoteVersions(state, [{ collection: 'notes', id: 'n1', value: state.notes[0] }], now);
      const ids = result.noteVersions.map(item => item.id).sort();
      assert.ok(ids.includes('cur') && ids.includes(cited.id), '当前版本与被引用版本保留');
      assert.equal(ids.filter(id => id.startsWith('old-')).length, 1, '三十天前只保留被引用的版本');
      assert.ok(ids.includes('other-old') && ids.includes('other-old-b'), '未触及的笔记不动');
      const submitted = pruneTouchedNoteVersions(
        state,
        [{ collection: 'noteVersions', id: 'old-c', value: old[2] }],
        now
      );
      assert.ok(
        submitted.noteVersions.some(item => item.id === 'old-c'),
        '本批提交的版本不会被删除'
      );
    }
  }
];
