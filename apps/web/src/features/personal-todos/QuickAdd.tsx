import { useState } from 'react';
import { PlusIcon } from '../../components/icons/knowra';
import { TextField } from '../../components/ui';
import { useTodoActions } from './TodoActions';
import styles from './PersonalTodos.module.css';

/** 只填名称即可保存；回车连续添加，Esc 清空。 */
export function QuickAdd({
  parentId,
  kind,
  plannedDate,
  placeholder,
  depth = 0,
  compact = false
}: {
  parentId: string | null;
  kind?: 'mainline' | 'sideline';
  plannedDate?: string | null;
  placeholder: string;
  depth?: number;
  compact?: boolean;
}) {
  const actions = useTodoActions();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const value = title.trim();
    if (!value || busy) return;
    setBusy(true);
    const created = await actions.create({ parentId, title: value, kind, plannedDate });
    setBusy(false);
    if (created) setTitle('');
  };
  return (
    <div
      className={compact ? styles.quickAddCompact : styles.quickAdd}
      style={{ '--depth': depth } as React.CSSProperties}
      role={compact ? 'listitem' : undefined}
    >
      <PlusIcon size={compact ? 14 : 16} className={styles.quickAddIcon} aria-hidden="true" />
      <TextField
        label={placeholder}
        hideLabel
        appearance="bare"
        placeholder={`${placeholder}，回车保存`}
        value={title}
        onChange={setTitle}
        isDisabled={busy}
        maxLength={200}
        className={styles.quickAddField}
        onKeyDown={event => {
          if (event.key === 'Enter') void submit();
          if (event.key === 'Escape') setTitle('');
        }}
      />
    </div>
  );
}
