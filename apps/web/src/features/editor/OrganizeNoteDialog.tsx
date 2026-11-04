import { useEffect, useMemo, useState } from 'react';
import type { Folder, Note } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogClose, DialogFooter, Select } from '../../components/ui';
import styles from './EditorInspector.module.css';

const UNFILED_KEY = '__unfiled__';
const STATUS_OPTIONS = [
  { id: 'draft', label: '待整理' },
  { id: 'active', label: '进行中' },
  { id: 'published', label: '已发布' },
  { id: 'archived', label: '已归档' }
];

export function OrganizeNoteDialog({ note, foldersById, isOpen, onOpenChange, onSave }: {
  note: Note;
  foldersById: Record<string, Folder>;
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  onSave(input: { folderId: string | null; status: string }): Promise<void>;
}) {
  const [folderKey, setFolderKey] = useState(note.folderId ?? UNFILED_KEY);
  const [status, setStatus] = useState(note.status || 'draft');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const folderOptions = useMemo(() => [
    { id: UNFILED_KEY, label: '未整理' },
    ...flattenFolderOptions(foldersById)
  ], [foldersById]);

  useEffect(() => {
    if (!isOpen) return;
    setFolderKey(note.folderId ?? UNFILED_KEY);
    setStatus(note.status || 'draft');
    setError('');
  }, [isOpen, note.folderId, note.status]);

  async function save() {
    setPending(true);
    setError('');
    try {
      await onSave({
        folderId: folderKey === UNFILED_KEY ? null : folderKey,
        status
      });
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '笔记整理失败，请重试');
    } finally {
      setPending(false);
    }
  }

  if (!isOpen) return null;
  return (
    <Dialog
      title="整理笔记"
      description="调整笔记所在目录和当前状态。"
      isOpen
      onOpenChange={onOpenChange}
      isPending={pending}
    >
      <DialogBody>
        <div className={styles.organizeFields}>
          <Select
            label="所在目录"
            options={folderOptions}
            selectedKey={folderKey}
            onSelectionChange={(key) => setFolderKey(String(key))}
          />
          <Select
            label="笔记状态"
            options={STATUS_OPTIONS}
            selectedKey={status}
            onSelectionChange={(key) => setStatus(String(key))}
          />
        </div>
        {error ? <p className={styles.versionError} role="alert">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <DialogClose variant="ghost">取消</DialogClose>
        <Button variant="primary" isPending={pending} onPress={() => void save()}>保存整理结果</Button>
      </DialogFooter>
    </Dialog>
  );
}

function flattenFolderOptions(foldersById: Record<string, Folder>) {
  const folders = Object.values(foldersById);
  const children = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const siblings = children.get(folder.parentId) ?? [];
    siblings.push(folder);
    children.set(folder.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  }
  const options: Array<{ id: string; label: string }> = [];
  const visit = (parentId: string | null, depth: number, visited: Set<string>) => {
    for (const folder of children.get(parentId) ?? []) {
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      options.push({ id: folder.id, label: `${'— '.repeat(depth)}${folder.name}` });
      visit(folder.id, depth + 1, visited);
    }
  };
  visit(null, 0, new Set());
  return options;
}
