import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '../classnames';
import styles from './GroupedList.module.css';

export interface GroupedListProps {
  /** 可选分组小标题，显示在圆角卡片上方。 */
  title?: string;
  children: ReactNode;
  className?: string;
}

export function GroupedList({ title, children, className }: GroupedListProps) {
  return (
    <section className={cx(styles.group, className)}>
      {title ? <h4 className={styles.groupTitle}>{title}</h4> : null}
      <div className={styles.card}>{children}</div>
    </section>
  );
}

export interface GroupedRowProps {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  descriptionTone?: 'default' | 'attention' | 'danger';
  control?: ReactNode;
  /** 点击行主体时的回调（如展开/收起下方时间调整子行），点击右侧 control 不触发。 */
  onPress?: () => void;
  expanded?: boolean;
  className?: string;
}

export function GroupedRow({
  icon,
  label,
  description,
  descriptionTone = 'default',
  control,
  onPress,
  expanded,
  className
}: GroupedRowProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onPress) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPress();
    }
  };

  return (
    <div
      className={cx(styles.row, !icon && styles.rowNoIcon, onPress && styles.rowInteractive, className)}
      onClick={onPress}
      onKeyDown={handleKeyDown}
      role={onPress ? 'button' : undefined}
      tabIndex={onPress ? 0 : undefined}
      aria-expanded={onPress ? expanded : undefined}
    >
      {icon ? (
        <span className={styles.rowIcon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className={styles.rowMain}>
        <span className={styles.rowLabel}>{label}</span>
        {description ? (
          <span
            className={cx(
              styles.rowDescription,
              descriptionTone === 'attention' && styles.rowDescriptionAttention,
              descriptionTone === 'danger' && styles.rowDescriptionDanger
            )}
          >
            {description}
          </span>
        ) : null}
      </div>
      {control ? (
        <div
          className={styles.rowControl}
          onClick={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
        >
          {control}
        </div>
      ) : null}
    </div>
  );
}

export interface GroupedSubRowProps {
  children: ReactNode;
  className?: string;
}

export function GroupedSubRow({ children, className }: GroupedSubRowProps) {
  return <div className={cx(styles.subRow, className)}>{children}</div>;
}
