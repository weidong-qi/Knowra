import { Button, Dialog, DialogBody, DialogFooter, DialogClose } from '../../components/ui';
import styles from './NoteEditorView.module.css';

interface EditorSaveConflictFeedbackProps {
  visible: boolean;
  error: string | null;
  discardOpen: boolean;
  onDiscardOpenChange(open: boolean): void;
  onRetry(): void;
  onExport(): void;
  onReload(): void;
  onDiscard(): void;
}

export function EditorSaveConflictFeedback({
  visible, error, discardOpen, onDiscardOpenChange, onRetry, onExport, onReload, onDiscard
}: EditorSaveConflictFeedbackProps) {
  if (!visible) return null;
  return (
    <div className={styles.saveConflict} role="alert">
      <div>
        <strong>正文尚未保存</strong>
        <p>{error ?? '请重试保存或导出草稿核对，系统不会自动覆盖冲突版本。'}</p>
      </div>
      <Button variant="default" onPress={onRetry}>重试保存</Button>
      <Button variant="default" onPress={onExport}>导出本地草稿</Button>
      <Button variant="default" onPress={onReload}>保留草稿并重新加载</Button>
      <Button variant="ghost" onPress={() => onDiscardOpenChange(true)}>放弃草稿…</Button>
      <Dialog title="放弃本地草稿？" isOpen={discardOpen} onOpenChange={onDiscardOpenChange}>
        <DialogBody>请先确认需要保留的正文已经另存。继续会删除此笔记的恢复草稿，并加载最新已保存正文。</DialogBody>
        <DialogFooter><DialogClose variant="ghost">取消</DialogClose>
          <Button onPress={onDiscard}>确认放弃并加载</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
