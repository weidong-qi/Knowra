import { forwardRef, type ReactNode } from 'react';
import { PressableButton, type PressableButtonProps } from '../button/PressableButton';
import { cx } from '../classnames';
import styles from './SideNavItem.module.css';

export interface SideNavItemProps extends Omit<PressableButtonProps, 'children'> {
  label: ReactNode;
  icon?: ReactNode;
  count?: ReactNode;
  density?: 'regular' | 'compact';
}

/** 普通侧栏导航项；由调用方使用 aria-pressed 或 aria-current 表达当前状态。 */
export const SideNavItem = forwardRef<HTMLButtonElement, SideNavItemProps>(function SideNavItem(
  { label, icon, count, density = 'regular', className, ...props },
  ref
) {
  return <PressableButton
    ref={ref}
    className={cx(styles.item, density === 'compact' && styles.compact, className)}
    {...props}
  >
    {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
    <span className={styles.label}>{label}</span>
    {count !== undefined ? <small className={styles.count}>{count}</small> : null}
  </PressableButton>;
});
