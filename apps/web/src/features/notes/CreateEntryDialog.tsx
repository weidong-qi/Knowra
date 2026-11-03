import { useState, type FormEvent } from 'react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  TextField
} from '../../components/ui';

export type CreateMode = 'note' | 'folder' | null;

export function CreateEntryDialog({
  mode,
  parentFolderId,
  onOpenChange,
  onCreateNote,
  onCreateFolder
}: {
  mode: CreateMode;
  parentFolderId: string | null;
  onOpenChange(open: boolean): void;
  onCreateNote(folderId: string | null, title: string): Promise<string>;
  onCreateFolder(parentId: string | null, name: string): Promise<string>;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  if (!mode) return null;
  const isNote = mode === 'note';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      setError(isNote ? '请输入笔记名称' : '请输入文件夹名称');
      return;
    }
    setPending(true);
    setError('');
    try {
      if (isNote) await onCreateNote(parentFolderId, normalizedValue);
      else await onCreateFolder(parentFolderId, normalizedValue);
      setValue('');
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '创建失败，请重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      title={isNote ? '新建笔记' : '新建文件夹'}
      isOpen
      onOpenChange={onOpenChange}
      isPending={pending}
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        <DialogBody>
          <TextField
            autoFocus
            label={isNote ? '笔记名称' : '文件夹名称'}
            value={value}
            onChange={setValue}
            isRequired
            isInvalid={Boolean(error)}
            errorMessage={error}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose variant="ghost">取消</DialogClose>
          <Button type="submit" variant="primary" isPending={pending}>创建</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
