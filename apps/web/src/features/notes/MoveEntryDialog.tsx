import { useState } from 'react';
import type { Folder } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogClose, DialogFooter, Select } from '../../components/ui';
import type { TreeEntryTarget } from './TreeEntryDialogs';
import { folderLocation } from './notesIndexNavigation';
import { isFolderWithin } from './entryMove';

export function moveDestinations(folders: Record<string, Folder>, target: TreeEntryTarget) {
  return Object.values(folders).filter(folder => {
    if (target.kind !== 'folder') return true;
    return !isFolderWithin(folder.id, target.id, folders);
  }).sort((a, b) => folderLocation(a.id, folders).localeCompare(folderLocation(b.id, folders), 'zh-CN'));
}

export function MoveEntryDialog({ target, currentParentId, folders, onClose, onMove }: {
  target: TreeEntryTarget; currentParentId: string | null; folders: Record<string, Folder>;
  onClose(): void; onMove(parentId: string | null): Promise<void>;
}) {
  const [destination, setDestination] = useState(currentParentId ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return <Dialog title={`移动${target.kind === 'folder' ? '文件夹' : '笔记'}`} description={`将“${target.name}”移动到所选目录。`} isOpen isPending={pending} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogBody>
      <Select label="目标目录" selectedKey={destination || '__root__'} isDisabled={pending} onSelectionChange={key => setDestination(key === '__root__' ? '' : String(key))}
        options={[{ id: '__root__', label: '笔记库（根目录）' }, ...moveDestinations(folders, target).map(folder => ({ id: folder.id, label: folderLocation(folder.id, folders) }))]} />
      {error ? <p role="alert">{error}</p> : null}
    </DialogBody>
    <DialogFooter><DialogClose variant="ghost">取消</DialogClose>
      <Button variant="primary" isPending={pending} isDisabled={destination === (currentParentId ?? '')} onPress={() => {
        setPending(true); setError('');
        void onMove(destination || null).then(onClose).catch(cause => setError(cause instanceof Error ? cause.message : '移动失败')).finally(() => setPending(false));
      }}>移动</Button>
    </DialogFooter>
  </Dialog>;
}
