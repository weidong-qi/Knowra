import { useState } from 'react';
import { Button, Dialog, DialogBody, DialogClose, DialogFooter } from '../../components/ui';

export function EmptyRecycleDialog({
  isOpen,
  count,
  onOpenChange,
  onEmpty
}: {
  isOpen: boolean;
  count: number;
  onOpenChange(open: boolean): void;
  onEmpty(): Promise<number>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!isOpen) return null;

  async function handleEmpty() {
    setPending(true);
    setError('');
    try {
      await onEmpty();
      onOpenChange(false);
    } catch (emptyError) {
      setError(emptyError instanceof Error ? emptyError.message : '清空失败，请重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog title="清空回收站？" isOpen onOpenChange={onOpenChange} isPending={pending}>
      <DialogBody>
        <p>将彻底删除回收站中的 {count} 条笔记，此操作无法撤销。</p>
        {error ? <p role="alert">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <DialogClose variant="ghost">取消</DialogClose>
        <Button variant="danger" isPending={pending} onPress={() => void handleEmpty()}>彻底删除</Button>
      </DialogFooter>
    </Dialog>
  );
}
