import { useEffect, useRef, useState, type Dispatch, type MouseEvent, type RefObject, type SetStateAction } from 'react';
import { attachmentIdsInText, type Attachment, type AttachmentDeleteResult, type UploadAttachmentInput } from '@study-accelerator/web-core';
import { trackDesktopTask } from '../../app/desktopLifecycle';
import type { AttachmentActions } from './EditorAttachmentPanel';
import type { EditorCommandTarget } from './editorCommands';
import type { NoteAutosaveController } from './useNoteAutosave';
import { downloadAttachment, fetchAttachmentBlob } from './attachmentAccess';
import { assertInlineImageFile, attachmentImageAlt, buildAttachmentReferenceUrl, isAttachmentReferenced,
  isInlineImageAttachment, readAttachmentFile } from './attachmentFiles';

interface Options {
  noteId?: string;
  canWrite: boolean;
  showSourceEditor: boolean;
  extendedWritesEnabled: boolean;
  editorRef: RefObject<EditorCommandTarget | null>;
  autosave: Pick<NoteAutosaveController, 'getLatestMarkdown' | 'saveNow'>;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  attachmentActions?: AttachmentActions;
  onListAttachments(noteId: string): Promise<Attachment[]>;
  onUploadAttachment(input: UploadAttachmentInput): Promise<Attachment>;
  onRenameAttachment(attachmentId: string, fileName: string): Promise<Attachment>;
  onDeleteAttachment(attachmentId: string): Promise<AttachmentDeleteResult | void>;
  onFileStatus(message: string): void;
}

/** 编辑器附件交互与正文反馈；列表读取和附件持久化仍由原有边界负责。 */
export function useEditorAttachments({ noteId, canWrite, showSourceEditor, extendedWritesEnabled,
  editorRef, autosave, attachments, setAttachments, attachmentActions,
  onListAttachments, onUploadAttachment, onRenameAttachment, onDeleteAttachment, onFileStatus }: Options) {
  const writeState = useRef({ noteId, canWrite });
  writeState.current = { noteId, canWrite };
  const [bodySavedToken, setBodySavedToken] = useState<string | null>(null);
  const [bodyPreview, setBodyPreview] = useState<{ name: string; url: string } | null>(null);
  useEffect(() => () => { if (bodyPreview) URL.revokeObjectURL(bodyPreview.url); }, [bodyPreview]);
  useEffect(() => { setBodyPreview(null); setBodySavedToken(null); }, [noteId]);

  const uploadAttachmentFile = (file: File) => trackDesktopTask(async () => {
    if (!noteId) throw new Error('当前笔记不可用');
    const input = await readAttachmentFile(noteId, file);
    const attachment = await onUploadAttachment(input);
    if (writeState.current.noteId === noteId) setAttachments(current => [attachment, ...current.filter(item => item.id !== attachment.id)]);
    return attachment;
  });
  const insertImageFile = (file: File) => trackDesktopTask(async () => {
    assertInlineImageFile(file);
    const attachment = await uploadAttachmentFile(file);
    if (writeState.current.noteId !== noteId) throw new Error('图片已上传，笔记已切换，未插入正文');
    const inserted = editorRef.current?.insertImage(buildAttachmentReferenceUrl(attachment.id), attachmentImageAlt(attachment));
    if (!inserted) throw new Error('图片已上传，但未能插入正文');
    onFileStatus('图片已插入正文');
  });
  // Milkdown 负责粘贴/拖入图片的选区复核，不与文件选择器的插入路径合并。
  const uploadEditorImage = async (file: File) => {
    if (!extendedWritesEnabled) throw new Error('离线附件上传尚未开放，请先保留原文件。');
    const attachment = await uploadAttachmentFile(file);
    return { url: buildAttachmentReferenceUrl(attachment.id), alt: attachmentImageAlt(attachment) };
  };
  const insertStoredAttachment = async (attachment: Attachment) => {
    if (attachment.status !== 'ready') throw new Error('附件尚不可用，请先核验或恢复');
    const url = buildAttachmentReferenceUrl(attachment.id);
    const inserted = isInlineImageAttachment(attachment)
      ? editorRef.current?.insertImage(url, attachmentImageAlt(attachment))
      : editorRef.current?.insertLink(url, attachment.fileName);
    if (!inserted) throw new Error('当前编辑状态无法插入附件，请切换到正文编辑模式后重试');
    onFileStatus(isInlineImageAttachment(attachment) ? '图片已插入正文' : '附件链接已插入正文');
  };

  const handleAttachmentLink = (event: MouseEvent<HTMLDivElement>) => {
    if (!noteId || event.button !== 0 && event.button !== 1) return;
    const element = event.target instanceof Element ? event.target.closest('a[href]') : null;
    const href = element?.getAttribute('href');
    const id = href ? attachmentIdsInText(href)[0] : undefined;
    if (!id) return;
    event.preventDefault(); event.stopPropagation();
    void trackDesktopTask(async () => {
      const attachment = attachments.find(item => item.id === id) ?? (await onListAttachments('')).find(item => item.id === id);
      if (!attachment) throw new Error('附件不存在');
      if (attachment.status !== 'ready') throw new Error('附件尚不可用，请先核验或恢复原文件');
      if (isInlineImageAttachment(attachment)) {
        const blob = await fetchAttachmentBlob(id);
        if (writeState.current.noteId === noteId) setBodyPreview({ name: attachment.fileName, url: URL.createObjectURL(blob) });
      } else {
        const token = await downloadAttachment(attachment);
        if (writeState.current.noteId === noteId) setBodySavedToken(token);
      }
    }).catch(async error => {
      if (writeState.current.noteId !== noteId) return;
      onFileStatus(error instanceof Error ? error.message : '附件读取失败');
      const items = await onListAttachments(noteId).catch(() => null);
      if (items && writeState.current.noteId === noteId) setAttachments(items);
    });
  };

  const actions: AttachmentActions | undefined = attachmentActions ? { ...attachmentActions,
    refreshAttachments: async () => {
      if (!noteId) return;
      const items = await onListAttachments(noteId);
      if (writeState.current.noteId === noteId) setAttachments(items);
    },
    verifyNoteAttachment: async id => {
      const updated = await attachmentActions.verifyNoteAttachment(id);
      if (writeState.current.noteId === noteId) setAttachments(current => current.map(item => item.id === id ? updated : item));
      return updated;
    },
    restoreNoteAttachment: async (id, bytes) => {
      const updated = await attachmentActions.restoreNoteAttachment(id, bytes);
      if (writeState.current.noteId === noteId) setAttachments(current => current.map(item => item.id === id ? updated : item));
      return updated;
    }
  } : undefined;
  const renameAttachment = async (attachmentId: string, fileName: string) => {
    const updated = await onRenameAttachment(attachmentId, fileName);
    if (writeState.current.noteId === noteId) setAttachments(current => current.map(item => item.id === updated.id ? updated : item));
    return updated;
  };
  const deleteAttachment = async (attachmentId: string) => {
    if (!noteId) throw new Error('当前笔记不可用');
    const currentMarkdown = showSourceEditor ? autosave.getLatestMarkdown() : editorRef.current?.getMarkdown() ?? autosave.getLatestMarkdown();
    if (isAttachmentReferenced(currentMarkdown, attachmentId)) throw new Error('当前正文或草稿仍引用此附件，请先移除引用');
    await autosave.saveNow(currentMarkdown);
    if (writeState.current.noteId !== noteId || !writeState.current.canWrite) throw new Error('笔记或写入状态已变化，请重新检查');
    const latestMarkdown = autosave.getLatestMarkdown();
    if (isAttachmentReferenced(latestMarkdown, attachmentId)) throw new Error('当前草稿新增了附件引用，已阻止删除');
    if (latestMarkdown !== currentMarkdown) throw new Error('正文在保存期间发生变化，请保存后重新检查');
    const result = await onDeleteAttachment(attachmentId);
    if (writeState.current.noteId === noteId) setAttachments(current => current.filter(item => item.id !== attachmentId));
    return result;
  };
  const openSavedAttachment = () => {
    if (bodySavedToken) void trackDesktopTask(async () => {
      await window.knowraDesktop?.openSavedAttachment?.(bodySavedToken);
    }).catch(error => onFileStatus(String(error)));
  };

  return { uploadAttachmentFile, insertImageFile, uploadEditorImage, insertStoredAttachment, handleAttachmentLink,
    actions, renameAttachment, deleteAttachment, bodyPreview, bodySavedToken, openSavedAttachment,
    closePreview: () => setBodyPreview(null), dismissDownload: () => setBodySavedToken(null) };
}
