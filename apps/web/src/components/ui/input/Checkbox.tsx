// V4-04 Checkbox
//
// 18×18 方形复选框，复选 / 不确定 / 禁用状态完整。

import { forwardRef, type ReactNode } from 'react';
import { Checkbox as RACheckbox, type CheckboxProps as RACheckboxProps } from 'react-aria-components';
import { cx } from '../classnames';
import styles from './Input.module.css';

export interface CheckboxProps extends Omit<RACheckboxProps, 'className' | 'children'> {
  children?: ReactNode;
  className?: string;
  indeterminateIcon?: ReactNode;
  size?: 'default' | 'compact';
}

export const Checkbox = forwardRef<HTMLLabelElement, CheckboxProps>(function Checkbox(
  { children, className, size = 'default', ...rest },
  ref
) {
  return (
    <RACheckbox ref={ref} className={cx(styles.checkbox, size === 'compact' && styles.checkboxCompact, className)} {...rest}>
      {({ isSelected, isIndeterminate, isDisabled }) => (
        <>
          <span
            className={styles.box}
            data-selected={isSelected || undefined}
            data-indeterminate={isIndeterminate || undefined}
            data-disabled={isDisabled || undefined}
            aria-hidden="true"
          >
            {isIndeterminate ? (
              <svg className={styles.check} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <rect y="5" width="12" height="2" />
              </svg>
            ) : isSelected ? (
              <svg className={styles.check} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M2 6.5l2.5 2.5L10 3.5" />
              </svg>
            ) : null}
          </span>
          {children ? <span>{children}</span> : null}
        </>
      )}
    </RACheckbox>
  );
});
