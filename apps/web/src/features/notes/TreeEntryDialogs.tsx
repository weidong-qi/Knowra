import { useState, type FormEvent } from 'react';
import type { Folder } from '@study-accelerator/web-core';
import { isFolderWithin } from './entryMove';
import { folderLocation } from './notesIndexNavigation';
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  TextField,
  Select
} from '../../components/ui';

export interface TreeEntryTarget {
  kind: 'folder' | 'note';
  id: string;
  name: string;
}

export function RenameTreeEntryDialog({ target, onClose, onRename }: {
  target: TreeEntryTarget;
  onClose(): void;
  onRename(value: string): Promise<void>;
}) {
  const [value, setValue] = useState(target.name);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const entryLabel = target.kind === 'folder' ? '文件夹' : '笔记';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      setError(`请输入${entryLabel}名称`);
      return;
    }
    setPending(true);
    setError('');
    try {
      await onRename(normalizedValue);
      onClose();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : '重命名失败，请重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog title={`重命名${entryLabel}`} isOpen onOpenChange={(open) => { if (!open) onClose(); }} isPending={pending}>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <DialogBody>
          <TextField
            autoFocus
            label={`${entryLabel}名称`}
            value={value}
            onChange={setValue}
            isRequired
            isInvalid={Boolean(error)}
            errorMessage={error}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose variant="ghost">取消</DialogClose>
          <Button type="submit" variant="primary" isPending={pending}>保存</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

export function DeleteTreeEntryDialog({ target, parentId = null, folders = {}, onClose, onDelete }: {
  target: TreeEntryTarget;
  parentId?: string | null;
  folders?: Record<string, Folder>;
  onClose(): void;
  onDelete(input?: { mode: 'keep' | 'with-content'; destinationId?: string | null }): Promise<void>;
}) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const isFolder = target.kind === 'folder';
  const [mode, setMode] = useState<'keep' | 'with-content'>('keep');
  const [destinationId, setDestinationId] = useState(parentId ?? '');

  async function handleDelete() {
    setPending(true);
    setError('');
    try {
      await onDelete(isFolder ? { mode, destinationId: destinationId || null } : undefined);
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除失败，请重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      title={isFolder ? '删除文件夹？' : '删除笔记？'}
      isOpen
      onOpenChange={(open) => { if (!open) onClose(); }}
      isPending={pending}
    >
      <DialogBody>
        <p>
          {isFolder
            ? `“${target.name}”及其子文件夹将移入回收站。请选择其中笔记的处理方式。`
            : `“${target.name}”将移入回收站。`}
        </p>
        {isFolder ? <><Select label="内容处理方式" selectedKey={mode} onSelectionChange={key => setMode(String(key) as 'keep' | 'with-content')} options={[{ id: 'keep', label: '保留笔记并移至其他目录' }, { id: 'with-content', label: '笔记一起移入回收站' }]} />
          {mode === 'keep' ? <Select label="笔记移至" selectedKey={destinationId || '__root__'} onSelectionChange={key => setDestinationId(key === '__root__' ? '' : String(key))}
            options={[{ id: '__root__', label: '笔记库（根目录）' }, ...Object.values(folders).filter(folder => !isFolderWithin(folder.id, target.id, folders)).map(folder => ({ id: folder.id, label: folderLocation(folder.id, folders) }))]} /> : null}</> : null}
        {error ? <p role="alert">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <DialogClose variant="ghost">取消</DialogClose>
        <Button variant="danger" isPending={pending} onPress={() => void handleDelete()}>删除</Button>
      </DialogFooter>
    </Dialog>
  );
}
