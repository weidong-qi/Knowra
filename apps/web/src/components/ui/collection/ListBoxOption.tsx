import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cx } from '../classnames';
import styles from './Collection.module.css';

/** 供输入框用 aria-activedescendant 导航的选项，焦点保留在输入框。 */
export const ListBoxOption = forwardRef<HTMLLIElement, ComponentPropsWithoutRef<'li'> & { selected: boolean }>(
  function ListBoxOption({ selected, className, ...props }, ref) {
    return (
      <li
        {...props}
        ref={ref}
        role="option"
        aria-selected={selected}
        data-selected={selected || undefined}
        className={cx(styles.listboxItem, className)}
      />
    );
  }
);
