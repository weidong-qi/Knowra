import { calculateContentHash } from '../knowledge/domain/note-version.ts';

/** 笔记固有隐私是 AI 读取的上限，授权策略不能覆盖它。旧资料缺省为普通。 */
export function isAiReadableNote(note) {
  return !!note && !note.deleted && (note.aiVisibility === undefined || note.aiVisibility === 'normal');
}

export function assertAiReadableNote(note) {
  if (!isAiReadableNote(note)) {
    /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
    const error = new Error('来源不在当前 AI 可读取范围。');
    error.code = 'AI_SCOPE_FORBIDDEN';
    throw error;
  }
  return note;
}

/** 所有异步版本读取之后重新检查实时笔记，历史版本和列表快照不能绕过切私密。 */
export async function assertAiNoteUnchanged(noteRepository, before) {
  const current = assertAiReadableNote(await noteRepository.findById(before.id));
  if (
    current.spaceId !== before.spaceId ||
    current.folderId !== before.folderId ||
    current.title !== before.title ||
    current.rawMarkdown !== before.rawMarkdown
  ) {
    /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
    const error = new Error('读取期间来源已变化，请重新检索。');
    error.code = 'AI_SOURCE_STALE';
    throw error;
  }
  return current;
}

/** 用一次仓库快照检查全部来源，避免逐篇 async 复核期间前一篇已切私密。 */
export async function assertAiSourcesReadable(
  noteRepository,
  sourceRefs,
  spaceId,
  { requireCurrentVersion = true } = {}
) {
  const ids = [...new Set(sourceRefs.map(ref => ref.noteId))];
  if (!ids.length) return;
  if (!noteRepository.findByIds && ids.length > 1) {
    /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
    const error = new Error('当前仓库未提供批量来源权限检查，已阻止读取。');
    error.code = 'AI_CONTEXT_NOT_READY';
    throw error;
  }
  const notes = noteRepository.findByIds
    ? await noteRepository.findByIds(ids)
    : [await noteRepository.findById(ids[0])];
  const byId = new Map(notes.filter(Boolean).map(note => [note.id, note]));
  for (const id of ids) {
    const note = assertAiReadableNote(byId.get(id));
    if (note.spaceId !== spaceId) {
      /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
      const error = new Error('来源不在当前 AI 可读取范围。');
      error.code = 'AI_SCOPE_FORBIDDEN';
      throw error;
    }
    // 没有 contentHash 的引用（目录条目只含标题等元数据）只检查可读性，不比较正文版本。
    if (
      requireCurrentVersion &&
      sourceRefs.some(
        ref =>
          ref.noteId === id &&
          ref.contentHash !== undefined &&
          ref.contentHash !== calculateContentHash(note.rawMarkdown)
      )
    ) {
      /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
      const error = new Error('发送前来源当前版本已变化。');
      error.code = 'AI_SOURCE_STALE';
      throw error;
    }
  }
}
