// V4-04 EmptyState
//
// 状态契约：主操作 + 次操作 + 逃生（重置 / 导入）。

import { forwardRef, type ReactNode } from 'react';
import { cx } from '../classnames';
import styles from './Status.module.css';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  escapeAction?: ReactNode;
  className?: string;
  /** 角色；默认 status，避免被读屏频繁打断。 */
  role?: 'status' | 'region';
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { title, description, icon, primaryAction, secondaryAction, escapeAction, className, role = 'status' },
  ref
) {
  return (
    <div ref={ref} className={cx(styles.empty, className)} role={role} aria-live="polite">
      {icon ? <div className={styles.emptyIcon} aria-hidden="true">{icon}</div> : null}
      <h3 className={styles.emptyTitle}>{title}</h3>
      {description ? <p className={styles.emptyDescription}>{description}</p> : null}
      {(primaryAction || secondaryAction || escapeAction) ? (
        <div className={styles.emptyActions}>
          {primaryAction}
          {secondaryAction}
          {escapeAction}
        </div>
      ) : null}
    </div>
  );
});
