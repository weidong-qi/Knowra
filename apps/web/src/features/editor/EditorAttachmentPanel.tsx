import { useEffect, useRef, useState } from 'react';
import type { Attachment, AttachmentDeleteResult, AttachmentCleanupStatus, WorkspaceApi } from '@study-accelerator/web-core';
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  Menu,
  MenuItem,
  MenuPopover,
  MenuSeparator,
  MenuTrigger,
  PressableButton,
  TextField
} from '../../components/ui';
import { DeleteIcon, EditIcon, ImageIcon, LinkIcon, PaperclipIcon, PlusIcon } from '../../components/icons/knowra';
import {
  formatAttachmentSize,
  isAttachmentReferenced
} from './attachmentFiles';
import { AttachmentDeleteDialog } from './AttachmentDeleteDialog';
import { trackDesktopTask } from '../../app/desktopLifecycle';
import { downloadAttachment, fetchAttachmentBlob } from './attachmentAccess';
import { isInlineImageAttachment, readRestoreFile } from './attachmentFiles';
import styles from './EditorInspector.module.css';

export type AttachmentActions = Pick<WorkspaceApi, 'inspectAttachmentDeletion' | 'verifyNoteAttachment' | 'restoreNoteAttachment' | 'listAttachmentCleanup' | 'retryAttachmentCleanup'> & { refreshAttachments?(): Promise<void> };

export function EditorAttachmentPanel({ attachments, markdown, canWrite, canInsert, loading, onUpload, onInsert, onRename, onDelete, actions, onOpenNote, onOpenKnowledgeItem }: {
  attachments: Attachment[];
  markdown: string;
  canWrite: boolean;
  canInsert: boolean;
  loading: boolean;
  onUpload(file: File): Promise<Attachment>;
  onInsert(attachment: Attachment): Promise<void>;
  onRename(attachmentId: string, fileName: string): Promise<Attachment>;
  onDelete(attachmentId: string): Promise<AttachmentDeleteResult | void>;
  actions?: AttachmentActions;
  onOpenNote?(id: string): void;
  onOpenKnowledgeItem?(id: string): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [renameTarget, setRenameTarget] = useState<Attachment | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const restoreTargetRef = useRef<Attachment | null>(null);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [cleanup, setCleanup] = useState<AttachmentCleanupStatus>({ items: [], pending: 0 });
  const [notice, setNotice] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Attachment | null>(null);

  useEffect(() => {
    let active = true;
    void actions?.listAttachmentCleanup().then(value => { if (active) setCleanup(value); }).catch(() => { if (active) setError('文件清理状态加载失败，请刷新重试'); });
    return () => { active = false; };
  }, [actions?.listAttachmentCleanup]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function run(task: () => Promise<unknown>) {
    setPending(true); setError('');
    try { await trackDesktopTask(task); } catch (reason) {
      setError(reason instanceof Error ? reason.message : '附件操作失败');
      await actions?.refreshAttachments?.().catch(() => undefined);
    }
    finally { setPending(false); }
  }

  async function openAttachment(attachment: Attachment, download = false) {
    if (attachment.status !== 'ready') return;
    await run(async () => {
      if (!download && isInlineImageAttachment(attachment)) {
        const blob = await fetchAttachmentBlob(attachment.id);
        setPreview({ name: attachment.fileName, url: URL.createObjectURL(blob) });
      } else setSavedToken(await downloadAttachment(attachment));
    });
  }

  async function upload(file: File) {
    setPending(true);
    setError('');
    try {
      await onUpload(file);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '附件上传失败，请重试');
    } finally {
      setPending(false);
    }
  }

  async function insert(attachment: Attachment) {
    setError('');
    try {
      await onInsert(attachment);
    } catch (insertError) {
      setError(insertError instanceof Error ? insertError.message : '附件插入失败，请重试');
    }
  }

  return (
    <div className={styles.attachmentPanel}>
      <input ref={restoreInputRef} type="file" className={styles.nativeFileInput} aria-label="选择原附件文件" disabled={!canWrite || pending} onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        const target = restoreTargetRef.current;
        if (file && target && actions) void run(async () => { await actions.restoreNoteAttachment(target.id, await readRestoreFile(target, file)); setNotice('原附件已恢复，原正文引用可继续使用'); });
      }} />
      <input
        ref={inputRef}
        className={styles.nativeFileInput}
        type="file"
        aria-label="选择要上传的附件"
        disabled={!canWrite || pending}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void upload(file);
        }}
      />
      <Button
        variant="ghost"
        isDisabled={!canWrite || pending}
        isPending={pending}
        onPress={() => inputRef.current?.click()}
      >
        <PlusIcon size={14} /> 上传附件
      </Button>
      {loading ? <p className={styles.emptyInline} role="status">正在加载附件…</p> : null}
      {!loading && attachments.length === 0 ? <p className={styles.emptyInline}>暂无附件</p> : null}
      {attachments.length > 0 ? (
        <div className={styles.attachmentList}>
          {attachments.map((attachment) => {
            const ready = attachment.status === 'ready';
            const labels: Record<string, string> = { ready: '可用', missing: '文件缺失', corrupt: '文件损坏', pending: '处理中', failed: '未完成／失败' };
            const statusLabel = Object.hasOwn(labels, attachment.status) ? labels[attachment.status] : '状态未知';
            const referenced = isAttachmentReferenced(markdown, attachment.id);
            return (
              <div key={attachment.id} className={styles.attachmentRow}>
                <MenuTrigger trigger="contextMenu">
                  <PressableButton
                    className={styles.attachmentTarget}
                    aria-label={`打开附件 ${attachment.fileName}`}
                    title="左键打开，右键管理附件"
                    isDisabled={pending}
                    onPress={() => void openAttachment(attachment)}
                  >
                    <PaperclipIcon size={15} />
                    <span><strong>{attachment.fileName}</strong><small>{formatAttachmentSize(attachment.size)} · {statusLabel}</small></span>
                  </PressableButton>
                  <MenuPopover placement="right top">
                    <Menu ariaLabel={`${attachment.fileName}附件操作`} onAction={(key) => {
                      if (key === 'open') void openAttachment(attachment);
                      if (key === 'download') void openAttachment(attachment, true);
                      if (key === 'verify' && actions) void run(async () => { const result = await actions.verifyNoteAttachment(attachment.id); setNotice(result.status === 'ready' ? '附件核验通过' : '附件核验完成，文件仍不可用'); });
                      if (key === 'restore') { restoreTargetRef.current = attachment; restoreInputRef.current?.click(); }
                      if (key === 'insert') void insert(attachment);
                      if (key === 'rename') setRenameTarget(attachment);
                      if (key === 'delete') setDeleteTarget(attachment);
                    }}>
                      <MenuItem id="open" isDisabled={!ready || pending} icon={<LinkIcon size={14} />}>打开附件</MenuItem>
                      <MenuItem id="insert" icon={<ImageIcon size={14} />} isDisabled={!canInsert || !ready || pending}>插入到正文</MenuItem>
                      <MenuItem id="download" isDisabled={!ready || pending}>下载附件</MenuItem>
                      <MenuItem id="verify" isDisabled={!canWrite || !actions || pending}>核验文件</MenuItem>
                      <MenuItem id="restore" isDisabled={!canWrite || !actions || pending || !/^[a-f0-9]{64}$/i.test(attachment.sha256 ?? '')}>恢复原文件</MenuItem>
                      <MenuSeparator />
                      <MenuItem id="rename" icon={<EditIcon size={14} />} isDisabled={!canWrite || pending}>重命名</MenuItem>
                      <MenuItem id="delete" icon={<DeleteIcon size={14} />} isDanger isDisabled={pending}>查看删除依赖</MenuItem>
                    </Menu>
                  </MenuPopover>
                </MenuTrigger>
                <div className={styles.attachmentControls}>
                  {referenced ? <span className={styles.referenceBadge}>正文中</span> : null}
                  <Button variant="ghost" size="mini" aria-label={`重命名附件 ${attachment.fileName}`} isDisabled={!canWrite || pending} onPress={() => setRenameTarget(attachment)}><EditIcon size={14} /></Button>
                  <Button variant="ghost" size="mini" aria-label={`删除附件 ${attachment.fileName}`} isDisabled={pending} onPress={() => setDeleteTarget(attachment)}><DeleteIcon size={14} /></Button>
                </div>
                {!ready ? <div className={styles.attachmentRecoveryActions}>
                  <Button variant="ghost" size="compact" isDisabled={!canWrite || pending || !actions} onPress={() => void run(async () => { const result = await actions!.verifyNoteAttachment(attachment.id); setNotice(result.status === 'ready' ? '附件核验通过' : '附件核验完成，文件仍不可用'); })}>核验文件</Button>
                  {/^[a-f0-9]{64}$/i.test(attachment.sha256 ?? '') ? <Button variant="ghost" size="compact" isDisabled={!canWrite || pending || !actions} onPress={() => { restoreTargetRef.current = attachment; restoreInputRef.current?.click(); }}>恢复原文件</Button> : <small>缺少可信原哈希，请另行上传新附件。</small>}
                </div> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {cleanup.pending > 0 ? <div><p>文件清理待重试：{cleanup.pending} 项</p><ul>{cleanup.items.map((item, index) => <li key={item.attachmentId ?? index}>{item.fileName}</li>)}</ul><Button isDisabled={!canWrite || pending || !actions} onPress={() => void run(async () => { await actions!.retryAttachmentCleanup(); setCleanup(await actions!.listAttachmentCleanup()); })}>重试文件清理</Button></div> : null}
      {savedToken ? <Button onPress={() => void run(async () => { await window.knowraDesktop?.openSavedAttachment?.(savedToken); })}>打开已保存文件</Button> : null}
      {preview ? <Dialog title={preview.name} isOpen onOpenChange={open => { if (!open) setPreview(null); }}><DialogBody><img src={preview.url} alt={preview.name} className={styles.attachmentPreviewImage} /></DialogBody></Dialog> : null}
      {error ? <p className={styles.versionError} role="alert">{error}</p> : null}
      <RenameAttachmentDialog target={renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null); }} onRename={onRename} />
      {deleteTarget ? <AttachmentDeleteDialog target={deleteTarget} canWrite={canWrite} inspect={actions?.inspectAttachmentDeletion} onClose={() => setDeleteTarget(null)} onOpenNote={onOpenNote} onOpenKnowledgeItem={onOpenKnowledgeItem} onDelete={async id => {
        const result = await onDelete(id);
        if (result) setNotice(result.cleanup === 'complete' ? '附件已删除，文件已清理' : result.cleanup === 'retained-local' ? '附件记录已删除，本机副本按同步与恢复规则保留' : '附件已删除，文件清理待重试');
        if (actions) {
          try { setCleanup(await actions.listAttachmentCleanup()); }
          catch { setError('附件记录已删除，文件清理状态暂不可用，请刷新重试'); }
        }
        return result;
      }} /> : null}
    </div>
  );
}

function RenameAttachmentDialog({ target, onOpenChange, onRename }: {
  target: Attachment | null;
  onOpenChange(open: boolean): void;
  onRename(attachmentId: string, fileName: string): Promise<Attachment>;
}) {
  const [fileName, setFileName] = useState(target?.fileName ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!target) return;
    setFileName(target.fileName);
    setError('');
  }, [target]);
  if (!target) return null;
  const normalized = fileName.trim();
  return (
    <Dialog title="重命名附件" isOpen onOpenChange={onOpenChange} isPending={pending}>
      <DialogBody>
        <TextField label="文件名" value={fileName} onChange={setFileName} autoComplete="off" />
        {error ? <p className={styles.versionError} role="alert">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <DialogClose variant="ghost">取消</DialogClose>
        <Button variant="primary" isDisabled={!normalized} isPending={pending} onPress={() => {
          setPending(true);
          setError('');
          void onRename(target.id, normalized)
            .then(() => onOpenChange(false))
            .catch((renameError) => setError(renameError instanceof Error ? renameError.message : '附件重命名失败'))
            .finally(() => setPending(false));
        }}>保存文件名</Button>
      </DialogFooter>
    </Dialog>
  );
}
