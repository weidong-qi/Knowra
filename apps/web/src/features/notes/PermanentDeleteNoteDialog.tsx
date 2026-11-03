import { useState } from 'react';
import { Button, Dialog, DialogBody, DialogClose, DialogFooter } from '../../components/ui';

export function PermanentDeleteNoteDialog({
  noteTitle,
  isOpen,
  onOpenChange,
  onDelete
}: {
  noteTitle: string;
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  onDelete(): Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!isOpen) return null;

  async function handleDelete() {
    setPending(true);
    setError('');
    try {
      await onDelete();
      onOpenChange(false);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '彻底删除失败，请重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog title="彻底删除这篇笔记？" isOpen onOpenChange={onOpenChange} isPending={pending}>
      <DialogBody>
        <p>“{noteTitle || '无标题笔记'}”及其历史版本将被永久删除，此操作无法撤销。</p>
        {error ? <p role="alert">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <DialogClose variant="ghost">取消</DialogClose>
        <Button variant="danger" isPending={pending} onPress={() => void handleDelete()}>彻底删除</Button>
      </DialogFooter>
    </Dialog>
  );
}
