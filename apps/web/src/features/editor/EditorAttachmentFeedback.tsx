import { Button, Dialog, DialogBody } from '../../components/ui';
import styles from './NoteEditorView.module.css';

/** 正文附件的瞬时反馈；请求、桌面任务及对象 URL 生命周期由会话拥有。 */
export function EditorAttachmentFeedback({ preview, savedToken, onClosePreview, onDismissDownload, onOpenSavedAttachment }: {
  preview: { name: string; url: string } | null;
  savedToken: string | null;
  onClosePreview(): void;
  onDismissDownload(): void;
  onOpenSavedAttachment(): void;
}) {
  return <>
    {savedToken ? <div className={styles.attachmentDownloadNotice} role="status">
      <span>附件已保存</span>
      <Button size="compact" onPress={onOpenSavedAttachment}>打开已保存附件</Button>
      <Button variant="ghost" size="mini" onPress={onDismissDownload}>关闭</Button>
    </div> : null}
    {preview ? <Dialog title={preview.name} isOpen onOpenChange={open => { if (!open) onClosePreview(); }}>
      <DialogBody><img src={preview.url} alt={preview.name} className={styles.attachmentPreviewImage} /></DialogBody>
    </Dialog> : null}
  </>;
}
