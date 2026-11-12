import { type ReactNode } from 'react';
import { CloseIcon } from '../icons/knowra';
import { IconButton } from '../ui';
import { ResponsivePanel } from '../ui/overlay/ResponsivePanel';
import { useCompactLayout } from '../../shell/useCompactLayout';
import styles from './LibraryIndex.module.css';
export function LibraryIndexHeader({
  title,
  titleId,
  count,
  icon,
  breadcrumb,
  children
}: {
  title: string;
  titleId?: string;
  count?: number;
  icon: ReactNode;
  breadcrumb: ReactNode;
  children: ReactNode;
}) {
  const compact = useCompactLayout();
  return (
    <header className={styles.header} data-compact={compact || undefined}>
      <div className={styles.heading}>
        {icon}
        <h1 id={titleId}>{title}</h1>
        {count !== undefined ? <span aria-label={`当前 ${count} 项`}>{count}</span> : null}
      </div>
      <nav className={styles.breadcrumb} aria-label="当前位置">
        {breadcrumb}
      </nav>
      <div className={styles.tools}>{children}</div>
    </header>
  );
}
export function LibraryInspector({
  title = '详情',
  isOpen = true,
  label,
  onClose,
  children
}: {
  title?: string;
  isOpen?: boolean;
  label: string;
  onClose(): void;
  children: ReactNode;
}) {
  const compact = useCompactLayout();
  return (
    <aside className={styles.inspector} aria-label={label} hidden={!isOpen} data-compact={compact || undefined}>
      <ResponsivePanel isOpen={isOpen} title={label} modal={compact} onClose={onClose} className={styles.drawer}>
        <header className={styles.inspectorHeader}>
          <h2>{title}</h2>
          <IconButton aria-label={`关闭${title}`} onPress={onClose}>
            <CloseIcon size={18} />
          </IconButton>
        </header>
        <div className={styles.inspectorBody}>{children}</div>
      </ResponsivePanel>
    </aside>
  );
}
