import type { ReactNode } from 'react';
import { Menu, MenuItem, MenuPopover, MenuTrigger } from '../../components/ui';
import { FolderIcon, NoteIcon, UploadIcon } from '../../components/icons/knowra';

export function CreateEntryChoices({ canWrite, onCreate, onImport }: { canWrite: boolean; onCreate(mode: 'note' | 'folder'): void; onImport?(): void }) {
  return <Menu ariaLabel="新建" onAction={key => { if (key === 'import') onImport?.(); else onCreate(key as 'note' | 'folder'); }}>
    <MenuItem id="note" icon={<NoteIcon size={14} />} isDisabled={!canWrite}>新建笔记</MenuItem>
    <MenuItem id="folder" icon={<FolderIcon size={14} />} isDisabled={!canWrite}>新建文件夹</MenuItem>
    {onImport ? <MenuItem id="import" icon={<UploadIcon size={14} />} isDisabled={!canWrite}>导入 Markdown</MenuItem> : null}
  </Menu>;
}

export function CreateEntryMenu({ canWrite, onCreate, onImport, children, contextMenu = false }: {
  canWrite: boolean; onCreate(mode: 'note' | 'folder'): void; onImport?(): void; children: ReactNode; contextMenu?: boolean;
}) {
  return <MenuTrigger {...(contextMenu ? { trigger: 'contextMenu' as const } : {})}>
    {children}
    <MenuPopover><CreateEntryChoices canWrite={canWrite} onCreate={onCreate} onImport={onImport} /></MenuPopover>
  </MenuTrigger>;
}
