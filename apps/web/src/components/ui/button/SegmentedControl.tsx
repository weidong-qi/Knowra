import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { PressableButton, type PressableButtonProps } from './PressableButton';
import { cx } from '../classnames';
import styles from './SegmentedControl.module.css';

export function SegmentedControl({
  className,
  children,
  variant = 'default',
  density = 'regular',
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  variant?: 'default' | 'underline' | 'outline';
  density?: 'regular' | 'compact' | 'comfortable';
}) {
  return (
    <div
      className={cx(
        styles.group,
        variant !== 'default' && styles[variant],
        density === 'compact' && styles.compactGroup,
        density === 'comfortable' && styles.comfortableGroup,
        className
      )}
      role="group"
      {...rest}
    >
      {children}
    </div>
  );
}

export interface SegmentedButtonProps extends Omit<PressableButtonProps, 'className' | 'children'> {
  count?: number;
  iconOnly?: boolean;
  children: ReactNode;
  className?: string;
}

export const SegmentedButton = forwardRef<HTMLButtonElement, SegmentedButtonProps>(function SegmentedButton(
  { count, iconOnly, children, className, ...rest },
  ref
) {
  return (
    <PressableButton ref={ref} className={cx(styles.segment, iconOnly && styles.iconOnly, className)} {...rest}>
      {children}
      {count !== undefined ? (
        <>
          {' '}
          <span className={styles.count}>{count}</span>
        </>
      ) : null}
    </PressableButton>
  );
});
