import { useRef, useState } from 'react';
import { Button } from '../../../components/ui';
import { Menu, MenuItem, MenuPopover, MenuTrigger } from '../../../components/ui/overlay';
import { ChevronDownIcon } from '../../../components/icons/knowra';
import { ItemStatus } from '../../notes/NotesIndexItemMeta';
import { getStatusLabel } from '../editorInspectorModel';
import styles from '../EditorInspector.module.css';

const STATUS_CHOICES = [
  { id: 'draft', label: '待整理' },
  { id: 'active', label: '进行中' },
  { id: 'published', label: '已发布' },
  { id: 'archived', label: '已归档' }
];

/** 保留快捷菜单外观，写入期间串行操作，失败后可重新选择。父层按笔记 id 重建。 */
export function NoteStatusControl({ status, disabled, onChange }: {
  status?: string;
  disabled: boolean;
  onChange(status: string): Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const current = status || 'draft';

  async function change(next: string) {
    if (disabled || saving.current || next === current) return;
    saving.current = true;
    setPending(true);
    setError('');
    try {
      await onChange(next);
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : '状态更新失败'}，请重新选择状态重试`);
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return <>
    <MenuTrigger>
      <Button size="mini" variant="ghost" className={styles.statusButton} isDisabled={disabled || pending} aria-busy={pending || undefined} aria-label={`状态：${getStatusLabel(status)}，点击切换`}>
        <ItemStatus status={getStatusLabel(status)} /><ChevronDownIcon size={11} />
      </Button>
      <MenuPopover placement="bottom start">
        <Menu ariaLabel="切换状态" onAction={key => { void change(String(key)); }}>
          {STATUS_CHOICES.map(choice => <MenuItem id={choice.id} key={choice.id} isDisabled={disabled || pending} kbd={choice.id === current ? '当前' : undefined}>{choice.label}</MenuItem>)}
        </Menu>
      </MenuPopover>
    </MenuTrigger>
    {error ? <span role="alert" className={styles.versionError}>{error}</span> : null}
  </>;
}
