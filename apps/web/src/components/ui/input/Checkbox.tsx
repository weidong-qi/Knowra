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
  variant?: 'default' | 'row';
  size?: 'default' | 'compact';
}

/** 复选框和可勾选菜单项共用的装饰标记；交互语义由外层控件提供。 */
export function CheckboxIndicator({
  isSelected,
  isIndeterminate,
  isDisabled,
  variant = 'default'
}: {
  isSelected?: boolean;
  isIndeterminate?: boolean;
  isDisabled?: boolean;
  variant?: CheckboxProps['variant'];
}) {
  return (
    <span
      className={cx(styles.box, variant === 'row' && styles.rowIndicator)}
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
        <svg
          className={styles.check}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M2 6.5l2.5 2.5L10 3.5" />
        </svg>
      ) : null}
    </span>
  );
}

export const Checkbox = forwardRef<HTMLLabelElement, CheckboxProps>(function Checkbox(
  { children, className, variant = 'default', size = 'default', ...rest },
  ref
) {
  return (
    <RACheckbox
      ref={ref}
      data-variant={variant}
      className={cx(styles.checkbox, size === 'compact' && styles.checkboxCompact, className)}
      {...rest}
    >
      {({ isSelected, isIndeterminate, isDisabled }) => (
        <>
          <CheckboxIndicator
            variant={variant}
            isSelected={isSelected}
            isIndeterminate={isIndeterminate}
            isDisabled={isDisabled}
          />
          {children ? <span className={styles.checkboxLabel}>{children}</span> : null}
        </>
      )}
    </RACheckbox>
  );
});
