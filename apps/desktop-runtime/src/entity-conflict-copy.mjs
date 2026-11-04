import { randomUUID } from 'node:crypto';
import { attachmentIdsInText } from '@study-accelerator/shared/attachments';

/** 副本持有独立附件；原文件留给云端原笔记及冲突恢复记录。 */
export function createEntityConflictCopy({
  original,
  localAttachments,
  localPdfAnnotations = [],
  state,
  noteService,
  entityTransfer,
  preparedCopies
}) {
  if (!state.spaces.some(space => space.id === original.spaceId)) throw new Error('云端已删除此空间，请导出恢复记录。');
  const owned = localAttachments.filter(attachment => attachment.noteId === original.id);
  const ownedIds = new Set(owned.map(attachment => attachment.id));
  for (const id of attachmentIdsInText(original.rawMarkdown)) {
    if (!ownedIds.has(id) && !state.attachments.some(attachment => attachment.id === id)) {
      throw new Error('正文引用的附件元数据缺失，请先恢复附件，再保留两篇。');
    }
  }
  if (owned.length && !entityTransfer?.prepareCopy) throw new Error('附件复制不可用，请重新查看冲突。');
  const noteId = randomUUID();
  const aliases = new Map();
  for (const attachment of owned) {
    const prepared = entityTransfer.prepareCopy(attachment, noteId);
    preparedCopies.push(prepared);
    aliases.set(attachment.id, prepared.attachment.id);
    state.attachments.push(prepared.attachment);
  }
  // 与同步依赖扫描相同的资源边界；保留查询参数、fragment 和 Markdown/HTML 格式。
  const rawMarkdown = original.rawMarkdown.replace(
    /\/api\/storage\/attachments\/[^/\s"'<>?#]+\/content(?=$|[\s"'<>?#)\]\}.,;])/g,
    reference => {
      const id = attachmentIdsInText(reference)[0];
      return aliases.has(id) ? `/api/storage/attachments/${aliases.get(id)}/content` : reference;
    }
  );
  const pdfSource = original.pdfSource
    ? {
        ...original.pdfSource,
        attachmentId: aliases.get(original.pdfSource.attachmentId) ?? original.pdfSource.attachmentId
      }
    : null;
  for (const mark of localPdfAnnotations)
    if (mark.noteId === original.id)
      state.pdfAnnotations.push({
        ...structuredClone(mark),
        id: randomUUID(),
        noteId,
        attachmentId: pdfSource.attachmentId,
        revision: 1,
        operationId: randomUUID()
      });
  noteService.createNote({
    ...original,
    pdfSource,
    id: noteId,
    rawMarkdown,
    title: `${original.title}（本地副本 ${randomUUID().slice(0, 4)}）`,
    deleted: false,
    folderId: state.folders.some(folder => folder.id === original.folderId) ? original.folderId : null,
    tagIds: original.tagIds.filter(id => state.tags.some(tag => tag.id === id))
  });
}
