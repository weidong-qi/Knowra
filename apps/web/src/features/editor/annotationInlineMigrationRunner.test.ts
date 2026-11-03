import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  anchorForBlock,
  anchorForSection,
  anchorFromProjectedRange,
  followAnchorChanges,
  projectMarkdown,
  type ContentAnchor
} from '@study-accelerator/content-anchor';
import { parseKnowraMarks } from '@study-accelerator/shared/knowra-marks';
import type { Annotation, Note } from '@study-accelerator/web-core';
import {
  checkInlineMigration,
  executeInlineMigration,
  summarizeChecks,
  type MigrationApi
} from './annotationInlineMigrationRunner';
import { migrationBaseMarkId, type MigrationExclusion, type MigrationCodec } from './annotationInlineMigration';
import { createMigrationCodec } from './annotationInlineMigration.testing';

let codec: MigrationCodec & { destroy(): Promise<void> };
beforeAll(async () => {
  codec = await createMigrationCodec();
});
afterAll(async () => {
  await codec.destroy();
});

/** 模拟服务端：保存正文时按标记派生 v3 行；旧行可取消、可改备注。 */
function fakeServer(
  notes: Note[],
  annotations: Annotation[],
  options: {
    derive?: boolean;
    conflictOn?: string;
    afterSave?: () => void;
    beforeDelete?: (id: string) => void;
    beforeComment?: (id: string) => void;
    exclusions?: MigrationExclusion[];
  } = {}
) {
  const calls: string[] = [];
  let version = 0;
  const api: MigrationApi & { calls: string[] } = {
    calls,
    async getNote(id) {
      return { ...notes.find(note => note.id === id)! };
    },
    async updateNote(id, input) {
      calls.push(`save:${id}`);
      const note = notes.find(item => item.id === id)!;
      if (options.conflictOn === id || input.expectedUpdatedAt !== note.updatedAt)
        throw new Error('笔记已在其他地方修改');
      const before = note.rawMarkdown;
      Object.assign(note, { rawMarkdown: input.rawMarkdown, updatedAt: `v${(version += 1)}` });
      // 真实服务端保存正文时会跟随旧锚点并推进 revision。
      for (const row of annotations.filter(
        item => item.noteId === id && item.schemaVersion === 2 && item.lifecycleStatus === 'active'
      )) {
        row.revision = (row.revision ?? 1) + 1;
        if (row.anchorStatus !== 'resolved' || !row.anchor) continue;
        const followed = followAnchorChanges(
          before,
          note.rawMarkdown,
          row.anchor as unknown as ContentAnchor,
          input.annotationMapping?.edits
        );
        if (followed.status === 'resolved' && followed.anchor) {
          row.anchor = followed.anchor;
          row.quoteText = followed.anchor.quoteText;
        } else row.anchorStatus = followed.status;
      }
      for (const exclusion of options.exclusions ?? []) {
        const followed = followAnchorChanges(before, note.rawMarkdown, exclusion.anchor);
        if (followed.status === 'resolved' && followed.anchor) exclusion.anchor = followed.anchor;
        else exclusion.anchor = { ...exclusion.anchor, unresolved: true };
      }
      if (options.derive !== false) {
        const parsed = parseKnowraMarks(note.rawMarkdown!);
        for (const markId of new Set([
          ...parsed.inline.map(item => item.id),
          ...parsed.blocks.filter(item => !item.exclude).map(item => item.id)
        ])) {
          if (
            annotations.some(
              item => item.noteId === id && (item.anchor as unknown as { markId?: string })?.markId === markId
            )
          )
            continue;
          annotations.push({
            id: `annotation-k-${markId}`,
            noteId: id,
            schemaVersion: 3,
            lifecycleStatus: 'active',
            revision: 1,
            comment: '',
            anchor: { format: 'knowra-inline', markId }
          } as unknown as Annotation);
        }
      }
      options.afterSave?.();
      return { ...note };
    },
    async listAnnotations(noteId) {
      return annotations
        .filter(item => item.noteId === noteId && item.lifecycleStatus !== 'deleted')
        .map(item => ({ ...item }));
    },
    async deleteAnnotation(id, expectedRevision) {
      calls.push(`delete:${id}`);
      options.beforeDelete?.(id);
      const row = annotations.find(item => item.id === id)!;
      if (expectedRevision !== row.revision) throw new Error('重点已在其他地方修改');
      row.lifecycleStatus = 'deleted';
      row.revision = (row.revision ?? 1) + 1;
      return { ...row };
    },
    async updateAnnotation(id, input) {
      calls.push(`comment:${id}`);
      options.beforeComment?.(id);
      const row = annotations.find(item => item.id === id)!;
      if (input.expectedRevision !== row.revision) throw new Error('重点备注已在其他地方修改');
      row.comment = input.comment;
      row.revision = (row.revision ?? 1) + 1;
      return { ...row };
    },
    async previewAnnotation(id) {
      return {
        annotation: annotations.find(item => item.id === id)!,
        exclusions: (options.exclusions ?? []).filter(item => item.parentAnnotationId === id)
      } as never;
    }
  };
  return api;
}

const legacy = (id: string, noteId: string, anchor: ContentAnchor, extra: Partial<Annotation> = {}) =>
  ({
    id,
    noteId,
    schemaVersion: 2,
    scopeType: anchor.scopeType,
    anchor,
    quoteText: anchor.quoteText,
    kind: 'important',
    importance: 'normal',
    lifecycleStatus: 'active',
    anchorStatus: 'resolved',
    status: 'active',
    revision: 1,
    comment: '',
    ...extra
  }) as unknown as Annotation;

async function fixture(markdownA = '## 第一章\n\n勾股定理指出两边平方和等于斜边平方。\n') {
  const markdown = codec.serialize(codec.parse(markdownA));
  const projection = projectMarkdown(markdown);
  const start = projection.text.indexOf('两边平方和');
  const notes = [
    { id: 'a', title: '甲', spaceId: 's', rawMarkdown: markdown, updatedAt: 'v0' },
    { id: 'b', title: '乙', spaceId: 's', rawMarkdown: '没有重点\n', updatedAt: 'v0' },
    { id: 'c', title: '回收站', spaceId: 's', rawMarkdown: markdown, updatedAt: 'v0', deleted: true }
  ] as unknown as Note[];
  const annotations = [
    legacy('old-sel', 'a', anchorFromProjectedRange(projection, start, start + 5), {
      comment: '考试必考',
      importance: 'core'
    }),
    legacy('old-sec', 'a', anchorForSection(projection, 0)),
    legacy('old-lost', 'a', anchorForSection(projection, 0), { anchorStatus: 'missing' }),
    legacy('old-trash', 'c', anchorForSection(projection, 0))
  ];
  return { notes, annotations };
}
const refs = (notes: Note[]) =>
  notes.map(note => ({ id: note.id, title: note.title, spaceId: note.spaceId!, deleted: note.deleted }));

describe('迁移重点到正文：执行器', () => {
  it('检查只读；执行后正文写入标记、备注转到新重点、旧重点全部取消（含放弃的）', async () => {
    const { notes, annotations } = await fixture();
    const api = fakeServer(notes, annotations);
    const checks = await checkInlineMigration(refs(notes), api, codec);
    expect(api.calls).toEqual([]);
    expect(checks.map(check => check.note.id)).toEqual(['a']);
    expect(summarizeChecks(checks)).toMatchObject({ notes: 1, migratable: 2, abandoned: 1, blockedNotes: 0 });

    const [result] = await executeInlineMigration(checks, api, codec);
    expect(result).toMatchObject({ status: 'migrated', migrated: 2, abandoned: 1, commentsCarried: 1 });
    const saved = notes.find(note => note.id === 'a')!.rawMarkdown!;
    expect(parseKnowraMarks(saved).inline[0].attrs).toMatchObject({ l: 'core' });
    expect(
      annotations
        .filter(item => item.schemaVersion === 2 && item.noteId === 'a')
        .every(item => item.lifecycleStatus === 'deleted')
    ).toBe(true);
    expect(annotations.find(item => item.schemaVersion === 3 && item.comment === '考试必考')).toBeTruthy();
    expect(annotations.find(item => item.id === 'old-trash')!.lifecycleStatus).toBe('active');
  });

  it('保存冲突或没有派生出重点时，这篇失败且旧重点保留；再次执行可以续跑', async () => {
    const conflict = await fixture();
    const conflictApi = fakeServer(conflict.notes, conflict.annotations, { conflictOn: 'a' });
    const [conflicted] = await executeInlineMigration(
      await checkInlineMigration(refs(conflict.notes), conflictApi, codec),
      conflictApi,
      codec
    );
    expect(conflicted.status).toBe('failed');
    expect(conflictApi.calls.some(call => call.startsWith('delete:'))).toBe(false);

    const lost = await fixture();
    const lostApi = fakeServer(lost.notes, lost.annotations, { derive: false });
    const [missing] = await executeInlineMigration(
      await checkInlineMigration(refs(lost.notes), lostApi, codec),
      lostApi,
      codec
    );
    expect(missing).toMatchObject({ status: 'failed' });
    expect(missing.message).toContain('旧重点保留');
    expect(
      lost.annotations
        .filter(item => item.schemaVersion === 2 && item.noteId === 'a')
        .every(item => item.lifecycleStatus === 'active')
    ).toBe(true);

    // 再跑一次：正文已有标记，不重复写入；服务端只在正文变化时派生，所以缺失的重点如实报告失败、旧重点继续保留。
    // （真实服务端里保存与派生同在一个事务，不会出现"有标记、无重点行"；这里只验证不会重复写入或误删。）
    const resumedApi = fakeServer(lost.notes, lost.annotations);
    const before = lost.notes[0].rawMarkdown;
    const [resumed] = await executeInlineMigration(
      await checkInlineMigration(refs(lost.notes), resumedApi, codec),
      resumedApi,
      codec
    );
    expect(resumed.status).toBe('failed');
    expect(lost.notes[0].rawMarkdown).toBe(before);
    expect(resumedApi.calls.some(call => call.startsWith('delete:') || call.startsWith('save:'))).toBe(false);
  });

  it('检查之后正文又被改过：按最新正文重新计算再保存', async () => {
    const { notes, annotations } = await fixture();
    const api = fakeServer(notes, annotations);
    const checks = await checkInlineMigration(refs(notes), api, codec);
    const note = notes.find(item => item.id === 'a')!;
    note.rawMarkdown = `${note.rawMarkdown}\n补充一段。\n`;
    note.updatedAt = 'v-edited';
    const [result] = await executeInlineMigration(checks, api, codec);
    expect(result.status).toBe('migrated');
    expect(note.rawMarkdown).toContain('补充一段。');
    expect(parseKnowraMarks(note.rawMarkdown!).inline).toHaveLength(1);
  });
  it('检查后只改重点备注、重要度或排除也会刷新，不需要正文发生变化', async () => {
    const { notes, annotations } = await fixture();
    const exclusions: MigrationExclusion[] = [];
    const api = fakeServer(notes, annotations, { exclusions });
    const checks = await checkInlineMigration(refs(notes), api, codec);
    const old = annotations.find(item => item.id === 'old-sel')!;
    old.comment = '最新备注';
    old.importance = 'important';
    old.revision! += 1;
    const projection = projectMarkdown(notes[0].rawMarkdown);
    const paragraph = projection.blocks.findIndex(block => block.type === 'paragraph');
    exclusions.push({
      id: 'new-exclusion',
      parentAnnotationId: 'old-sec',
      status: 'active',
      anchor: anchorForBlock(projection, paragraph)
    });
    annotations.find(item => item.id === 'old-sec')!.revision! += 1;

    const [result] = await executeInlineMigration(checks, api, codec);
    expect(result).toMatchObject({ status: 'migrated', commentsCarried: 1 });
    const marks = parseKnowraMarks(notes[0].rawMarkdown);
    expect(marks.inline[0].attrs.l).toBe('important');
    expect(marks.blocks.some(item => item.exclude)).toBe(true);
    expect(annotations.find(item => item.schemaVersion === 3 && item.comment === '最新备注')).toBeTruthy();
    expect(annotations.some(item => item.schemaVersion === 3 && item.comment === '考试必考')).toBe(false);
  });

  it('检查后新增的重点会加入新计划，检查后取消的重点不会再写入', async () => {
    const { notes, annotations } = await fixture();
    const api = fakeServer(notes, annotations);
    const checks = await checkInlineMigration(refs(notes), api, codec);
    annotations.find(item => item.id === 'old-sel')!.lifecycleStatus = 'deleted';
    const projection = projectMarkdown(notes[0].rawMarkdown);
    const start = projection.text.indexOf('斜边平方');
    annotations.push(
      legacy('added-before-run', 'a', anchorFromProjectedRange(projection, start, start + 4), { comment: '新重点备注' })
    );
    const [result] = await executeInlineMigration(checks, api, codec);
    expect(result.status).toBe('migrated');
    const ids = parseKnowraMarks(notes[0].rawMarkdown).inline.map(item => item.id);
    expect(ids).toContain(migrationBaseMarkId('added-before-run'));
    expect(ids).not.toContain(migrationBaseMarkId('old-sel'));
    expect(annotations.find(item => item.schemaVersion === 3 && item.comment === '新重点备注')).toBeTruthy();
  });

  it('保存期间新建的旧重点不属于本次计划，必须保留', async () => {
    const { notes, annotations } = await fixture();
    const api = fakeServer(notes, annotations, {
      afterSave() {
        const projection = projectMarkdown(notes[0].rawMarkdown);
        const start = projection.text.indexOf('斜边平方');
        annotations.push(
          legacy('concurrent-new', 'a', anchorFromProjectedRange(projection, start, start + 4), { comment: '稍后迁移' })
        );
      }
    });
    const [result] = await executeInlineMigration(await checkInlineMigration(refs(notes), api, codec), api, codec);
    expect(result.status).toBe('migrated');
    expect(annotations.find(item => item.id === 'concurrent-new')).toMatchObject({
      lifecycleStatus: 'active',
      comment: '稍后迁移'
    });
    expect(api.calls).not.toContain('delete:concurrent-new');
  });

  it('保存期间更新的备注用最新值转移，而保存期间改过范围或重要度则保留旧行', async () => {
    const fresh = await fixture();
    const freshApi = fakeServer(fresh.notes, fresh.annotations, {
      afterSave() {
        const old = fresh.annotations.find(item => item.id === 'old-sel')!;
        old.comment = '保存时更新的备注';
        old.revision! += 1;
      }
    });
    const [result] = await executeInlineMigration(
      await checkInlineMigration(refs(fresh.notes), freshApi, codec),
      freshApi,
      codec
    );
    expect(result.status).toBe('migrated');
    expect(
      fresh.annotations.find(item => item.schemaVersion === 3 && item.comment === '保存时更新的备注')
    ).toBeTruthy();

    const changed = await fixture();
    const changedApi = fakeServer(changed.notes, changed.annotations, {
      afterSave() {
        const old = changed.annotations.find(item => item.id === 'old-sel')!;
        old.importance = 'important';
        old.revision! += 1;
      }
    });
    const [blocked] = await executeInlineMigration(
      await checkInlineMigration(refs(changed.notes), changedApi, codec),
      changedApi,
      codec
    );
    expect(blocked.status).toBe('failed');
    expect(changedApi.calls.some(call => call.startsWith('delete:'))).toBe(false);
    expect(changed.annotations.find(item => item.id === 'old-sel')!.lifecycleStatus).toBe('active');
  });

  it('取消时使用验证快照的 revision，并发更新冲突不会取消旧行', async () => {
    const { notes, annotations } = await fixture();
    const api = fakeServer(notes, annotations, {
      beforeDelete(id) {
        if (id !== 'old-sel') return;
        const old = annotations.find(item => item.id === id)!;
        old.comment = '取消前最后更新';
        old.revision! += 1;
      }
    });
    const [result] = await executeInlineMigration(await checkInlineMigration(refs(notes), api, codec), api, codec);
    expect(result).toMatchObject({ status: 'failed', migrated: 0 });
    expect(annotations.find(item => item.id === 'old-sel')).toMatchObject({
      lifecycleStatus: 'active',
      comment: '取消前最后更新'
    });
  });

  it('新重点已有不同备注或 API 不能转移时保留两边，备注写入冲突也不会取消来源', async () => {
    for (const mode of ['different', 'unsupported', 'conflict'] as const) {
      const { notes, annotations } = await fixture();
      const api = fakeServer(notes, annotations, {
        afterSave() {
          if (mode === 'different') annotations.find(item => item.schemaVersion === 3)!.comment = '新重点自己的备注';
        },
        beforeComment(id) {
          if (mode !== 'conflict') return;
          const target = annotations.find(item => item.id === id)!;
          target.comment = '并发写入的新备注';
          target.revision! += 1;
        }
      });
      if (mode === 'unsupported') api.updateAnnotation = undefined;
      const [result] = await executeInlineMigration(await checkInlineMigration(refs(notes), api, codec), api, codec);
      expect(result.status).toBe('failed');
      expect(api.calls.some(call => call.startsWith('delete:'))).toBe(false);
      expect(annotations.find(item => item.id === 'old-sel')).toMatchObject({
        lifecycleStatus: 'active',
        comment: '考试必考'
      });
      if (mode === 'different')
        expect(annotations.find(item => item.schemaVersion === 3)!.comment).toBe('新重点自己的备注');
      if (mode === 'conflict')
        expect(annotations.find(item => item.schemaVersion === 3)!.comment).toBe('并发写入的新备注');
    }
  });

  it('部分取消失败后可安全续跑，已经转移的备注不重复覆盖或写入正文', async () => {
    const { notes, annotations } = await fixture();
    const api = fakeServer(notes, annotations, {
      beforeDelete(id) {
        if (id === 'old-sec') throw new Error('模拟暂时离线');
      }
    });
    const [partial] = await executeInlineMigration(await checkInlineMigration(refs(notes), api, codec), api, codec);
    expect(partial).toMatchObject({ status: 'failed', migrated: 1, commentsCarried: 1 });
    expect(annotations.find(item => item.id === 'old-sec')!.lifecycleStatus).toBe('active');
    const saved = notes[0].rawMarkdown;
    const resumedApi = fakeServer(notes, annotations);
    const [resumed] = await executeInlineMigration(
      await checkInlineMigration(refs(notes), resumedApi, codec),
      resumedApi,
      codec
    );
    expect(resumed).toMatchObject({ status: 'migrated', migrated: 1, abandoned: 1, commentsCarried: 0 });
    expect(notes[0].rawMarkdown).toBe(saved);
    expect(resumedApi.calls.some(call => call.startsWith('save:') || call.startsWith('comment:'))).toBe(false);
  });

  it('保存后正文被其他写入修改时不取消旧重点', async () => {
    const { notes, annotations } = await fixture();
    const api = fakeServer(notes, annotations, {
      afterSave() {
        notes[0].rawMarkdown += '\n并发补充。\n';
        notes[0].updatedAt = 'concurrent';
      }
    });
    const [result] = await executeInlineMigration(await checkInlineMigration(refs(notes), api, codec), api, codec);
    expect(result.status).toBe('failed');
    expect(notes[0].rawMarkdown).toContain('并发补充。');
    expect(api.calls.some(call => call.startsWith('delete:'))).toBe(false);
  });
  it('检查后才变得无法定位的重点必须重新确认，不使用旧摘要自动放弃', async () => {
    const { notes, annotations } = await fixture();
    const api = fakeServer(notes, annotations);
    const checks = await checkInlineMigration(refs(notes), api, codec);
    annotations.find(item => item.id === 'old-sel')!.anchorStatus = 'missing';
    const before = notes[0].rawMarkdown;
    const [result] = await executeInlineMigration(checks, api, codec);
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('重新检查确认');
    expect(api.calls).toEqual([]);
    expect(notes[0].rawMarkdown).toBe(before);
    expect(annotations.find(item => item.id === 'old-sel')!.lifecycleStatus).toBe('active');
  });

  it.each(['beforeRun', 'afterSave'])('无法定位重点新增备注不能沿用旧的放弃确认：%s', async when => {
    const { notes, annotations } = await fixture();
    const change = () => {
      const row = annotations.find(item => item.id === 'old-lost')!;
      row.comment = '刚补充的重要备注';
      row.revision! += 1;
    };
    const api = fakeServer(notes, annotations, { afterSave: when === 'afterSave' ? change : undefined });
    const checks = await checkInlineMigration(refs(notes), api, codec);
    if (when === 'beforeRun') change();
    const [result] = await executeInlineMigration(checks, api, codec);
    expect(result.status).toBe(when === 'beforeRun' ? 'skipped' : 'failed');
    expect(api.calls.filter(call => call.startsWith('delete:'))).toEqual([]);
    expect(annotations.find(item => item.id === 'old-lost')).toMatchObject({
      lifecycleStatus: 'active',
      comment: '刚补充的重要备注'
    });
  });
});
