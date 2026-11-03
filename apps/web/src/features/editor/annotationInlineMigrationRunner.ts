import { calculateContentHash } from '@study-accelerator/content-anchor';
import type {
  Annotation,
  AnnotationPreview,
  Note,
  UpdateAnnotationInput,
  UpdateNoteInput
} from '@study-accelerator/web-core';
import {
  migrationSourceEdits,
  planNoteMigration,
  type MigrationCodec,
  type MigrationExclusion,
  type NoteMigrationPlan
} from './annotationInlineMigration';
import { inlineMarkIdOf, isInlineAnnotation } from './editorInlineAnnotations';

/**
 * 重点内联化 I3c：设置里的一次性"迁移重点到正文"。
 * 检查（只读）→ 执行：逐篇保存写好标记的正文 → 确认服务端已派生 v3 行 → 转移备注 → 取消旧重点（7 天后自动回收）。
 * 每篇单独处理：自检不过、正文在检查后被改过、保存冲突或派生缺失时，这篇保持原样并在报告中说明。
 */
export interface MigrationApi {
  getNote(noteId: string): Promise<Note>;
  updateNote(noteId: string, input: UpdateNoteInput): Promise<Note>;
  listAnnotations(noteId: string, spaceId: string): Promise<Annotation[]>;
  deleteAnnotation(annotationId: string, expectedRevision?: number): Promise<Annotation>;
  updateAnnotation?(annotationId: string, input: UpdateAnnotationInput): Promise<Annotation>;
  previewAnnotation?(annotationId: string): Promise<AnnotationPreview>;
}

export interface MigrationNoteRef {
  id: string;
  title: string;
  spaceId: string;
  deleted?: boolean;
}

export interface NoteMigrationCheck {
  note: MigrationNoteRef;
  updatedAt: string;
  rawMarkdown: string;
  legacy: Annotation[];
  exclusions: MigrationExclusion[];
  plan: NoteMigrationPlan;
}

export type NoteMigrationStatus = 'migrated' | 'skipped' | 'failed';
export interface NoteMigrationResult {
  note: MigrationNoteRef;
  status: NoteMigrationStatus;
  /** 跳过或失败的原因（中文）。 */
  message: string | null;
  migrated: number;
  abandoned: number;
  commentsCarried: number;
  rewritesFormat: boolean;
}

export interface MigrationProgress {
  phase: 'check' | 'migrate';
  done: number;
  total: number;
  title?: string;
}

const isLegacyActive = (annotation: Annotation) =>
  !isInlineAnnotation(annotation) && (annotation.lifecycleStatus ?? 'active') === 'active';

// 放弃无法定位的重点不会转移备注，因此检查后新写的备注或属性必须重新确认。
function abandonedSnapshot(annotation: Annotation) {
  return JSON.stringify([
    annotation.kind,
    annotation.importance,
    annotation.scopeType,
    annotation.comment,
    annotation.anchorStatus,
    annotation.anchor
  ]);
}

async function exclusionsOf(api: MigrationApi, legacy: Annotation[]): Promise<MigrationExclusion[]> {
  if (!api.previewAnnotation) {
    if (legacy.some(item => ['section', 'list'].includes(item.scopeType ?? '')))
      throw new Error('无法读取重点的排除范围，已停止迁移');
    return [];
  }
  const result: MigrationExclusion[] = [];
  for (const annotation of legacy.filter(item => ['section', 'list'].includes(item.scopeType ?? ''))) {
    const preview = await api.previewAnnotation(annotation.id);
    for (const exclusion of preview.exclusions ?? [])
      result.push({
        id: exclusion.id,
        parentAnnotationId: annotation.id,
        status: exclusion.status,
        anchor: exclusion.anchor as unknown as MigrationExclusion['anchor']
      });
  }
  return result;
}

/** 检查（只读）：找出还有活跃旧重点的笔记，逐篇算出迁移结果。回收站里的笔记暂不迁移。 */
export async function checkInlineMigration(
  notes: MigrationNoteRef[],
  api: MigrationApi,
  codec: MigrationCodec,
  onProgress?: (progress: MigrationProgress) => void
) {
  const checks: NoteMigrationCheck[] = [];
  const candidates = notes.filter(note => !note.deleted);
  for (const [index, note] of candidates.entries()) {
    onProgress?.({ phase: 'check', done: index, total: candidates.length, title: note.title });
    const legacy = (await api.listAnnotations(note.id, note.spaceId)).filter(isLegacyActive);
    if (!legacy.length) continue;
    const full = await api.getNote(note.id);
    const exclusions = await exclusionsOf(api, legacy);
    const plan = planNoteMigration({ markdown: full.rawMarkdown, annotations: legacy, exclusions }, codec);
    checks.push({ note, updatedAt: full.updatedAt ?? '', rawMarkdown: full.rawMarkdown, legacy, exclusions, plan });
  }
  onProgress?.({ phase: 'check', done: candidates.length, total: candidates.length });
  return checks;
}

export function summarizeChecks(checks: NoteMigrationCheck[]) {
  const outcomes = checks.flatMap(check => check.plan.outcomes);
  return {
    notes: checks.length,
    migratable: outcomes.filter(item => item.status === 'migrated').length,
    abandoned: outcomes.filter(item => item.status === 'unplaced').length,
    blockedNotes: checks.filter(check => check.plan.issues.length).length,
    rewritesFormat: checks.filter(check => check.plan.rewritesFormat).length
  };
}

async function migrateOne(
  check: NoteMigrationCheck,
  api: MigrationApi,
  codec: MigrationCodec
): Promise<NoteMigrationResult> {
  const result: NoteMigrationResult = {
    note: check.note,
    status: 'migrated',
    message: null,
    migrated: 0,
    abandoned: 0,
    commentsCarried: 0,
    rewritesFormat: check.plan.rewritesFormat
  };
  const fail = (status: NoteMigrationStatus, message: string) => ({ ...result, status, message });
  // 重点、备注和排除可以单独变化，不能只按正文更新时间决定是否刷新。
  const current = await api.getNote(check.note.id);
  if (current.deleted) return fail('skipped', '笔记已移入回收站，保持原样');
  const legacy = (await api.listAnnotations(check.note.id, check.note.spaceId)).filter(isLegacyActive);
  if (!legacy.length) return fail('skipped', '旧重点已取消，无需迁移');
  const plan = planNoteMigration(
    { markdown: current.rawMarkdown, annotations: legacy, exclusions: await exclusionsOf(api, legacy) },
    codec
  );
  result.rewritesFormat = plan.rewritesFormat;
  const confirmedAbandoned = new Set(
    check.plan.outcomes.filter(item => item.status === 'unplaced').map(item => item.annotationId)
  );
  if (
    plan.outcomes.some(
      item =>
        item.status === 'unplaced' &&
        (!confirmedAbandoned.has(item.annotationId) ||
          abandonedSnapshot(legacy.find(source => source.id === item.annotationId)!) !==
            abandonedSnapshot(check.legacy.find(source => source.id === item.annotationId)!))
    )
  ) {
    return fail('skipped', '检查后出现新的无法定位重点，请重新检查确认后再迁移');
  }
  if (plan.issues.length) return fail('skipped', `自检未通过，保持原样：${plan.issues[0]}`);
  if (plan.markdown !== current.rawMarkdown) {
    try {
      await api.updateNote(check.note.id, {
        rawMarkdown: plan.markdown,
        expectedUpdatedAt: current.updatedAt,
        annotationMapping: {
          formatVersion: 1,
          operationId: crypto.randomUUID(),
          baseContentHash: calculateContentHash(current.rawMarkdown),
          targetContentHash: calculateContentHash(plan.markdown),
          edits: migrationSourceEdits(current.rawMarkdown, plan.markdown)
        }
      });
    } catch (error) {
      return fail('failed', `保存正文失败，保持原样：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const after = await api.listAnnotations(check.note.id, check.note.spaceId);
  const byMarkId = new Map(
    after
      .filter(item => isInlineAnnotation(item) && (item.lifecycleStatus ?? 'active') === 'active')
      .map(item => [inlineMarkIdOf(item), item])
  );
  const migrated = plan.outcomes.filter(item => item.status === 'migrated');
  const missing = migrated.filter(item => !byMarkId.has(item.markId));
  // 正文已写好但没有派生出重点行：不取消旧重点，保证这篇的重点不会丢；下次迁移会按已有标记续跑。
  if (missing.length) return fail('failed', `正文已写入标记，但有 ${missing.length} 条重点没有派生出来，旧重点保留`);
  const latest = new Map(after.map(item => [item.id, item]));
  const planned = plan.outcomes.filter(item => item.status === 'migrated' || item.status === 'unplaced');
  const sources = planned.map(item => latest.get(item.annotationId));
  if (sources.some(item => !item || !isLegacyActive(item)))
    return fail('failed', '迁移期间旧重点状态已变化，尚未取消的旧重点保留');
  const verifiedSources = sources as Annotation[];
  if (
    planned.some(
      item =>
        item.status === 'unplaced' &&
        abandonedSnapshot(latest.get(item.annotationId)!) !==
          abandonedSnapshot(legacy.find(source => source.id === item.annotationId)!)
    )
  ) {
    return fail('failed', '迁移期间无法定位的旧重点已变化，旧重点保留，请重新检查确认');
  }
  // 保存正文会自动跟随旧锚点并推进 revision。验证跟随后的位置、类别和排除仍与
  // 已写入标记一致，才能使用这次读取的 revision；后续并发修改仍由删除的 CAS 拒绝。
  const saved = await api.getNote(check.note.id);
  if (saved.deleted || saved.rawMarkdown !== plan.markdown) return fail('failed', '迁移期间正文已变化，旧重点保留');
  const verified = planNoteMigration(
    { markdown: saved.rawMarkdown, annotations: verifiedSources, exclusions: await exclusionsOf(api, verifiedSources) },
    codec
  );
  if (
    verified.issues.length ||
    verified.markdown !== saved.rawMarkdown ||
    verified.outcomes.some(
      item =>
        !planned.some(
          before =>
            before.annotationId === item.annotationId && before.status === item.status && before.markId === item.markId
        )
    )
  ) {
    return fail('failed', '迁移期间旧重点范围或属性已变化，旧重点保留，请重新检查');
  }
  for (const outcome of migrated) {
    const old = latest.get(outcome.annotationId)!;
    const target = byMarkId.get(outcome.markId)!;
    // 包括续跑前源备注已清空的情况：不能把旧副本当成用户仍要保留的备注。
    if (target.comment && target.comment !== old.comment) return fail('failed', '新旧重点备注不同，旧重点保留');
    if (old.comment && target.comment !== old.comment) {
      // 不覆盖新重点自己的备注，也不能在备注未成功转移时取消来源。
      if (!api.updateAnnotation) return fail('failed', '无法转移备注，旧重点保留');
      try {
        await api.updateAnnotation(target.id, { expectedRevision: target.revision ?? 1, comment: old.comment });
        result.commentsCarried += 1;
      } catch (error) {
        return fail('failed', `转移备注失败，旧重点保留：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  // 只取消本次计划且已验证的旧行，不触及保存期间新建的重点。
  for (const old of verifiedSources) {
    try {
      await api.deleteAnnotation(old.id, old.revision ?? 1);
      if (planned.find(item => item.annotationId === old.id)!.status === 'migrated') result.migrated += 1;
      else result.abandoned += 1;
    } catch (error) {
      return fail(
        'failed',
        `取消旧重点失败，尚未取消的旧重点保留：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return result;
}

/** 执行：逐篇迁移，单篇失败不影响其他笔记。调用方负责事先备份与同步检查。 */
export async function executeInlineMigration(
  checks: NoteMigrationCheck[],
  api: MigrationApi,
  codec: MigrationCodec,
  onProgress?: (progress: MigrationProgress) => void
) {
  const results: NoteMigrationResult[] = [];
  for (const [index, check] of checks.entries()) {
    onProgress?.({ phase: 'migrate', done: index, total: checks.length, title: check.note.title });
    try {
      results.push(await migrateOne(check, api, codec));
    } catch (error) {
      results.push({
        note: check.note,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        migrated: 0,
        abandoned: 0,
        commentsCarried: 0,
        rewritesFormat: check.plan.rewritesFormat
      });
    }
  }
  onProgress?.({ phase: 'migrate', done: checks.length, total: checks.length });
  return results;
}
