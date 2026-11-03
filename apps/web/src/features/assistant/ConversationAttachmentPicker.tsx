import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button/Button';
import { Popover, PopoverDialog, PopoverTrigger } from '../../components/ui/overlay/Popover';
import { FileDropField } from '../../components/ui/file/FileDropField';
import { conversationAttachmentApi } from './conversationAttachmentApi';
import styles from './ConversationAttachmentPicker.module.css';

export interface ConversationAttachment {
  attachmentId: string; conversationId: string; revision: number; fileName: string; mimeType: string; size: number;
  sha256: string; storageStatus: 'pending' | 'ready' | 'missing' | 'removed';
  parseStatus: 'not_parsed' | 'failed'; errorCode: string | null;
  parserVersion: string | null; parsedTextHash: string | null; imageMetadata: ImageMetadata | null;
  removedAt: string | null; createdAt: string; updatedAt: string;
}
interface ImageMetadata { width: number; height: number; format: string }
export interface ConversationAttachmentPreview {
  attachment: ConversationAttachment; segments: Array<{ text: string; start: number; end: number; page?: number }>;
  imageMetadata: ImageMetadata | null;
}
export interface ConversationAttachmentApi {
  list(id: string): Promise<ConversationAttachment[]>;
  upload(id: string, input: { uploadKey: string; fileName: string; mimeType: string; contentBase64: string }): Promise<ConversationAttachment>;
  preview(id: string, attachmentId: string): Promise<ConversationAttachmentPreview>;
  content(id: string, attachmentId: string): Promise<Blob>;
  remove(id: string, attachmentId: string, expectedRevision: number): Promise<ConversationAttachment>;
}
const accepted = '.txt,.md,.markdown,.pdf,.docx,.png,.jpg,.jpeg';
const types: Record<string, string> = { txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const maxBytes = 5 * 1024 * 1024;
function attachmentErrorText(code: string | null) {
  if (code === 'AI_ATTACHMENT_CONFLICT') return '附件版本已变化，请刷新附件后重试。';
  if (code === 'AI_ATTACHMENT_SCOPE_FORBIDDEN') return '无权访问当前对话附件。';
  if (code === 'AI_ATTACHMENT_REMOVED' || code === 'AI_ATTACHMENT_NOT_FOUND') return '附件已移除或不存在，请刷新附件列表。';
  if (code === 'AI_ATTACHMENT_STORAGE_INVALID') return '附件完整性校验失败，请移除后重新上传。';
  if (code === 'AI_ATTACHMENT_FILE_MISSING') return '附件内容缺失，请移除后重新上传。';
  if (code === 'AI_ATTACHMENT_UPLOAD_INVALID') return '附件类型或大小无效，请检查文件后重新上传。';
  if (code === 'AI_ATTACHMENT_DOC_UNSUPPORTED') return '旧版 DOC 暂不支持，请另存为 DOCX 后上传。';
  if (code?.endsWith('_LIMIT')) return '附件数量或大小超过当前上限，请移除部分附件后重试。';
  return '附件操作失败，请重试。';
}
const unparsedNotice = '未解析，不能用于附件问答；尚未发送给 AI。';
const isImage = (mimeType: string) => ['image/png', 'image/jpeg'].includes(mimeType);
const errorText = (cause: unknown) => {
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
  return typeof code === 'string' && code.startsWith('AI_ATTACHMENT_') ? attachmentErrorText(code)
    : cause instanceof Error ? cause.message : '附件操作失败，请重试。';
};
interface UploadTask { file: File; uploadKey: string; conversationId: string | null; mimeType: string; error: string | null; valid: boolean; contentBase64?: string }

export function ConversationAttachmentPicker({ conversationId, ensureConversation, isDisabled = false, api = conversationAttachmentApi }: {
  conversationId: string | null; ensureConversation(): Promise<string>; isDisabled?: boolean; api?: ConversationAttachmentApi;
}) {
  const [attachments, setAttachments] = useState<ConversationAttachment[]>([]);
  const [upload, setUpload] = useState<UploadTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ attachmentId: string; detail: ConversationAttachmentPreview; url?: string } | null>(null);
  const previewRef = useRef(preview); previewRef.current = preview;
  const currentConversation = useRef(conversationId); currentConversation.current = conversationId;
  const previousConversation = useRef(conversationId);
  const uploadTask = useRef<UploadTask | null>(null);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previewElementRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current, element = previewElementRef.current;
    if (!open || !preview || !dialog || !element) return;
    // 只滚动附件内部，避免 scrollIntoView 连带移动应用外壳和输入区。
    element.focus({ preventScroll: true });
    const headerHeight = dialog.firstElementChild?.getBoundingClientRect().height ?? 0;
    dialog.scrollTop += element.getBoundingClientRect().top - dialog.getBoundingClientRect().top - headerHeight - 8;
  }, [open, preview]);
  const mounted = useRef(true);
  const generation = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { return () => { if (preview?.url) URL.revokeObjectURL(preview.url); }; }, [preview]);
  useEffect(() => {
    const previous = previousConversation.current; previousConversation.current = conversationId;
    generation.current++; setAttachments([]); setPreview(null); setError(null);
    // A newly ensured conversation is the upload's own destination, not a navigation away.
    if (!(previous === null && uploadTask.current?.conversationId === conversationId)) {
      uploadTask.current = null; setUpload(null); setBusy(false);
    }
    if (!conversationId) { setLoading(false); return; }
    let active = true; setLoading(true);
    void api.list(conversationId).then(rows => { if (active) setAttachments(previous => {
      const merged = new Map(rows.filter(row => row.storageStatus !== 'removed').map(row => [row.attachmentId, row]));
      for (const row of previous) if (!merged.has(row.attachmentId) || row.revision > merged.get(row.attachmentId)!.revision) merged.set(row.attachmentId, row);
      return [...merged.values()];
    }); })
      .catch(cause => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [conversationId, api]);

  async function sendFile(task: UploadTask) {
    if (isDisabled || busy || !task.valid) return;
    dialogRef.current?.focus({ preventScroll: true });
    uploadTask.current = task; setUpload(task); setBusy(true); setError(null);
    const isCurrent = () => mounted.current && uploadTask.current === task
      && (currentConversation.current === null || currentConversation.current === task.conversationId);
    try {
      task.conversationId ??= await ensureConversation();
      if (!isCurrent()) return;
      task.contentBase64 ??= await readBase64(task.file);
      if (!isCurrent()) return;
      const attachment = await api.upload(task.conversationId, { uploadKey: task.uploadKey, fileName: task.file.name,
        mimeType: task.mimeType, contentBase64: task.contentBase64 });
      if (!isCurrent()) return;
      if (attachment.storageStatus === 'removed' || attachment.removedAt) {
        setAttachments(rows => rows.filter(row => row.attachmentId !== attachment.attachmentId));
        task.valid = false; task.error = '原上传对应的附件已被移除，请移除待上传文件后重新选择。';
        setUpload({ ...task }); setError(task.error); return;
      }
      setAttachments(rows => [...rows.filter(row => row.attachmentId !== attachment.attachmentId), attachment]);
      uploadTask.current = null; setUpload(null);
    } catch (cause) {
      if (isCurrent()) { task.error = errorText(cause); setUpload({ ...task }); setError(task.error); }
    } finally { if (mounted.current && (uploadTask.current === task || uploadTask.current === null) && (currentConversation.current === null || currentConversation.current === task.conversationId)) setBusy(false); }
  }
  function select(file: File) {
    if (isDisabled || busy || uploadTask.current) return;
    setOpen(true);
    const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
    const mimeType = types[extension];
    const validation = !mimeType ? extension === 'doc' ? '旧版 DOC 暂不支持，请另存为 DOCX 后上传。' : '不支持此文件类型，请选择 TXT、Markdown、PDF、DOCX、PNG 或 JPEG。'
      : !file.size ? '文件为空，请选择有内容的文件。' : file.size > maxBytes ? '单个附件不能超过 5 MB。' : null;
    const task: UploadTask = { file, uploadKey: crypto.randomUUID(), conversationId, mimeType: mimeType ?? file.type, error: validation, valid: !validation };
    uploadTask.current = task; setUpload(task); setError(validation);
    if (task.valid) void sendFile(task);
  }
  function paste(event: ClipboardEvent) {
    if (!(event.target instanceof Element) || !event.target.closest('[data-conversation-composer], [data-conversation-attachments]')) return;
    const image = Array.from(event.clipboardData?.items ?? []).find(item => item.kind === 'file' && ['image/png', 'image/jpeg'].includes(item.type));
    if (isDisabled || !image || loading || busy || uploadTask.current) return;
    const file = image.getAsFile(); if (!file) return;
    event.preventDefault();
    const name = `粘贴图片.${image.type === 'image/png' ? 'png' : 'jpg'}`;
    select(new File([file], name, { type: image.type }));
  }
  useEffect(() => {
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  });
  async function perform(work: (id: string, assertCurrent: () => void) => Promise<void>) {
    if (!conversationId || busy) return;
    // 禁用当前按钮前留住弹层焦点，避免浏览器把焦点丢到 body 后 Escape 失效。
    dialogRef.current?.focus({ preventScroll: true });
    const captured = generation.current, id = conversationId; setBusy(true); setError(null);
    const assertCurrent = () => { if (!mounted.current || generation.current !== captured || currentConversation.current !== id) throw new Error('对话已变化，请重新操作附件。'); };
    try { await work(id, assertCurrent); }
    catch (cause) { if (mounted.current && generation.current === captured) setError(errorText(cause)); }
    finally { if (mounted.current && generation.current === captured) setBusy(false); }
  }
  return <section className={styles.picker} data-conversation-attachments aria-label="对话附件" tabIndex={0}>
    <PopoverTrigger isOpen={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="compact" isDisabled={isDisabled}>附件（{attachments.length}）</Button>
      <Popover placement="top start" className={styles.popover}>
      <PopoverDialog ref={dialogRef} className={styles.dialog} data-conversation-attachments aria-label="对话附件管理">
      <div className={styles.header}><strong>对话附件</strong><Button variant="ghost" size="compact" onPress={() => setOpen(false)}>关闭附件</Button></div>
      <p>附件仅保存到此对话。{unparsedNotice}</p>
      <FileDropField accept={accepted} isDisabled={isDisabled || loading || busy || Boolean(upload)} label="添加对话附件"
        description="TXT、Markdown、PDF、DOCX、PNG、JPEG；单个最多 5 MB。也可在消息输入区粘贴 PNG 或 JPEG。"
        onSelect={files => { if (files[0]) select(files[0]); }} />
      {conversationId ? <Button variant="ghost" size="compact" isDisabled={loading || busy} onPress={() => void perform(async (id, assertCurrent) => {
        const rows = await api.list(id); assertCurrent(); setAttachments(rows.filter(row => row.storageStatus !== 'removed'));
        // 列表刷新只保留仍可读取的同版本预览，失效图片沿用现有 effect 释放 URL。
        setPreview(previous => previous && rows.some(row => row.attachmentId === previous.attachmentId
          && row.revision === previous.detail.attachment.revision && row.storageStatus === 'ready' && !row.removedAt)
          ? previous : null);
      })}>刷新附件</Button> : null}
      {loading ? <p role="status">正在恢复附件…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {upload ? <div className={styles.row}>
        <span>{upload.file.name} · {busy ? '正在保存到此对话…' : '上传未完成；尚未发送给 AI'}</span>
        {!busy && upload.valid ? <Button variant="default" size="compact" onPress={() => void sendFile(uploadTask.current!)}>重试上传</Button> : null}
        <Button variant="ghost" size="compact" isDisabled={busy} onPress={() => { uploadTask.current = null; setUpload(null); setError(null); }}>移除待上传文件</Button>
      </div> : null}
      {attachments.map(attachment => <div className={styles.row} key={attachment.attachmentId}>
        <div><strong>{attachment.fileName}</strong><p>{attachment.storageStatus === 'ready' ? '已保存到此对话；尚未发送给 AI' : '附件内容尚未就绪；尚未发送给 AI'}</p>
          <p>{unparsedNotice}</p>
          {isImage(attachment.mimeType) ? <p>当前模型尚不支持图片理解。</p> : null}
          {attachment.storageStatus === 'missing' ? <p>附件内容缺失，请移除后重新上传。</p> : null}
        </div>
        <div className={styles.actions}><Button variant="default" size="compact" isDisabled={busy || attachment.storageStatus !== 'ready'} onPress={() => void perform(async (id, assertCurrent) => {
          const detail = await api.preview(id, attachment.attachmentId); assertCurrent();
          let url: string | undefined;
          if (isImage(attachment.mimeType)) { const blob = await api.content(id, attachment.attachmentId); assertCurrent(); url = URL.createObjectURL(blob); }
          setPreview({ attachmentId: attachment.attachmentId, detail, url });
        })}>预览 {attachment.fileName}</Button>
          <Button variant="ghost" size="compact" isDisabled={loading || busy} onPress={() => void perform(async (id, assertCurrent) => {
            await api.remove(id, attachment.attachmentId, attachment.revision); assertCurrent();
            setAttachments(rows => rows.filter(row => row.attachmentId !== attachment.attachmentId));
            setPreview(previous => previous?.attachmentId === attachment.attachmentId ? null : previous);
          })}>移除 {attachment.fileName}</Button></div>
      </div>)}
      {preview ? <section ref={previewElementRef} className={styles.preview} aria-label="附件预览" tabIndex={-1}>
        <strong>{preview.detail.attachment.fileName}</strong>
        {preview.url ? <img src={preview.url} alt={`附件预览：${preview.detail.attachment.fileName}`} onError={() => {
          if (previewRef.current?.url !== preview.url) return;
          setError('图片内容无法显示，可能已损坏。请检查文件后重新上传。'); setPreview(null);
        }} />
          : <p>仅显示附件信息，当前不提供文档正文预览。</p>}
        <p>{preview.detail.attachment.mimeType} · {preview.detail.attachment.size} 字节</p>
        <p>{unparsedNotice}</p>
        {preview.url ? <p>当前模型尚不支持图片理解。</p> : null}
        <Button variant="ghost" size="compact" onPress={() => setPreview(null)}>关闭附件预览</Button>
      </section> : null}
      </PopoverDialog>
      </Popover>
    </PopoverTrigger>
  </section>;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('读取文件失败，请重新选择。'));
    reader.readAsDataURL(file);
  });
}
