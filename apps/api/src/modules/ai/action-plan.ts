import type { PlanNote, NoteImage, NotePlanItem, ActionPlanInput, OrganizeArguments } from './note-plan-types.ts';
type NativeDateConstructor = new (value: unknown) => Date;
import { assertAiReadableNote } from './note-privacy.ts';
import { createNoteWritePlan } from './note-plan.ts';
import { hashRecord } from './record-contract.ts';
import { calculateContentHash } from '../knowledge/domain/note-version.ts';
import { buildUpdateNoteDto } from '../knowledge/application/dto/note.dto.ts';
import { actionError } from './action-state.js';

export const image = (note: PlanNote) => ({
  id: note.id,
  spaceId: note.spaceId,
  title: note.title,
  folderId: note.folderId ?? null,
  tagIds: [...(note.tagIds ?? [])],
  rawMarkdown: note.rawMarkdown,
  aiVisibility: note.aiVisibility ?? 'normal'
});
export const metadataHash = (note: Pick<PlanNote, 'title' | 'folderId' | 'tagIds' | 'spaceId' | 'aiVisibility'>) =>
  hashRecord({
    title: note.title,
    folderId: note.folderId ?? null,
    tagIds: [...(note.tagIds ?? [])].sort(),
    spaceId: note.spaceId,
    ...(note.aiVisibility !== undefined ? { aiVisibility: note.aiVisibility } : {})
  });
export const baseline = (note: PlanNote) => ({
  targetNoteId: note.id,
  exists: true,
  expectedUpdatedAt: new (Date as NativeDateConstructor)(note.updatedAt).toISOString(),
  contentHash: calculateContentHash(note.rawMarkdown),
  metadataHash: metadataHash(image(note))
});
export const finalizePlan = <Content extends object>(content: Content) => ({
  ...content,
  planHash: hashRecord(content)
});

export function buildActionPlan<Provenance>({
  toolName,
  args,
  trusted,
  notes,
  references
}: ActionPlanInput<Provenance>) {
  let items: NotePlanItem[];
  if (toolName === 'notes_propose_organize') {
    if (
      !args ||
      Object.keys(args).some(key => key !== 'changes') ||
      !Array.isArray((args as OrganizeArguments).changes) ||
      (args as OrganizeArguments).changes.length < 1 ||
      (args as OrganizeArguments).changes.length > 20 ||
      new Set((args as OrganizeArguments).changes.map(row => row.noteId)).size !==
        (args as OrganizeArguments).changes.length
    ) {
      actionError('AI_NOTE_TOOL_INVALID', '整理计划需要 1–20 个不重复目标。', 422);
    }
    items = (args as OrganizeArguments).changes.map(change => {
      if (!change || Object.keys(change).some(key => !['noteId', 'title', 'folderId', 'tagIds'].includes(key))) {
        actionError('AI_NOTE_TOOL_INVALID', '整理字段不符合白名单。', 422);
      }
      const note = notes.find(row => row.id === change.noteId);
      if (!note || note.deleted || note.spaceId !== trusted.spaceId)
        actionError('AI_NOTE_TARGET_INVALID', '整理目标无效。', 422);
      assertAiReadableNote(note);
      const { noteId, ...updates } = change;
      const dto = buildUpdateNoteDto(updates) as Partial<Pick<NoteImage, 'title' | 'folderId' | 'tagIds'>>,
        before = image(note!),
        after = { ...before, ...dto };
      if (!Object.keys(dto).length || metadataHash(before) === metadataHash(after))
        actionError('AI_NOTE_NO_CHANGE', '整理未产生变化。', 422);
      return { before, after, baseline: baseline(note!), edits: [] };
    });
  } else {
    const original = createNoteWritePlan({ toolName, arguments: args, trusted });
    items = [{ before: original.before, after: original.after, baseline: original.baseline, edits: original.edits }];
  }
  for (const item of items) {
    if (item.after.title.length > 200 || item.after.tagIds.length > 20)
      actionError('AI_NOTE_PLAN_LIMIT', '标题或标签数量超过上限。', 422);
    if (
      (item.after.folderId && !references.some(ref => ref.kind === 'folder' && ref.id === item.after.folderId)) ||
      item.after.tagIds.some(id => !references.some(ref => ref.kind === 'tag' && ref.id === id))
    ) {
      actionError('AI_NOTE_REFERENCE_DENIED', '目录或标签不可用。', 422);
    }
  }
  return finalizePlan({
    schemaVersion: 1,
    toolVersion: 1,
    toolName,
    ...trusted.identity,
    items,
    references,
    provenance: trusted.provenance ?? null,
    approvalMode: 'previewRequired'
  });
}

export function assertBaseline(item: NotePlanItem, note: PlanNote | null | undefined) {
  if (!item.baseline.exists) {
    if (note) actionError('AI_ACTION_CONFLICT', '固定新建目标已存在。');
    return;
  }
  if (note) assertAiReadableNote(note);
  const currentBaseline = note ? baseline(note) : null;
  // 旧计划缺少可读性字段时只兼容普通笔记，保持已持久化 hash。
  if (note && item.before?.aiVisibility === undefined)
    currentBaseline!.metadataHash = metadataHash({ ...note, aiVisibility: undefined });
  if (
    !note ||
    note.deleted ||
    note.spaceId !== item.after.spaceId ||
    hashRecord(currentBaseline) !== hashRecord(item.baseline)
  )
    actionError('AI_ACTION_CONFLICT', '笔记已经变化，请保留建议并重新预览。');
}

// 同一领域流程可由同步 JSON/SQLite 或异步 PostgreSQL 驱动；本地事务不接受 Promise。
export function runSync<Yield, Result>(iterator: Iterator<Yield, Result, Yield>) {
  let step = iterator.next();
  while (!step.done) {
    if ((step.value as Yield & { then?: object })?.then) throw new TypeError('本地动作提交包含异步操作。');
    step = iterator.next(step.value as Yield);
  }
  return step.value;
}
export async function runAsync<Yield, Result>(iterator: Iterator<Yield, Result, Awaited<Yield>>) {
  let step = iterator.next();
  while (!step.done) step = iterator.next((await step.value) as Awaited<Yield>);
  return step.value;
}
