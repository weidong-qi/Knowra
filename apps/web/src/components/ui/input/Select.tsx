// V4-04 Select
//
// 使用 React Aria 的 ListBox + Popover 作为下拉内容；触发器复用按钮视觉。
// 业务代码只能通过本封装使用 select，不得直接 import react-aria-components 的 Select。

import { forwardRef, type ReactNode } from 'react';
import {
  Button as RAButton,
  Label,
  ListBox as RAListBox,
  ListBoxItem as RAItem,
  Popover as RAPopover,
  Select as RASelect,
  SelectValue as RASelectValue,
  Text,
  type SelectProps as RASelectProps,
  type Key
} from 'react-aria-components';
import { cx } from '../classnames';
import { ChevronDownIcon } from '../../icons/knowra';
import overlayStyles from '../overlay/Overlay.module.css';
import collectionStyles from '../collection/Collection.module.css';
import styles from './Input.module.css';
import { NestedOverlay } from '../overlay/ResponsivePanel';
import { useScopedAppearance } from '../overlay/ScopedAppearance';

export interface SelectOption {
  id: string;
  label: string;
  description?: string;
  isDisabled?: boolean;
}

export interface SelectProps<T extends Key = string>
  extends Omit<RASelectProps<T>, 'className' | 'children'> {
  label: string;
  description?: string;
  errorMessage?: string;
  placeholder?: string;
  isRequired?: boolean;
  isInvalid?: boolean;
  isDisabled?: boolean;
  options: SelectOption[];
  /** 工具栏中的紧凑筛选框；标签仍提供给辅助技术。 */
  presentation?: 'field' | 'toolbar';
  leadingIcon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export const Select = forwardRef<HTMLDivElement, SelectProps>(function Select(
  {
    label,
    description,
    errorMessage,
    placeholder = '请选择',
    isRequired,
    isInvalid,
    isDisabled,
    options,
    presentation = 'field',
    leadingIcon,
    className,
    ...rest
  },
  ref
) {
  const appearance = useScopedAppearance();
  return (
    <RASelect
      ref={ref}
      isRequired={isRequired}
      isInvalid={isInvalid}
      isDisabled={isDisabled}
      className={cx(styles.field, presentation === 'toolbar' && styles.toolbarSelect, className)}
      {...rest}
    >
      <Label className={cx(styles.label, presentation === 'toolbar' && styles.visuallyHidden)}>
        {label}
        {isRequired ? <span className={styles.required} aria-hidden="true">*</span> : null}
      </Label>
      {description ? (
        <Text slot="description" className={styles.description}>{description}</Text>
      ) : null}
      <RAButton className={styles.selectTrigger} data-input-shadow-owner="true">
        {leadingIcon ? <span className={styles.selectLeadingIcon} aria-hidden="true">{leadingIcon}</span> : null}
        <RASelectValue className={styles.selectValue}>
          {({ selectedText, isPlaceholder }) => (
            <span data-placeholder={isPlaceholder || undefined}>{selectedText ?? placeholder}</span>
          )}
        </RASelectValue>
        <ChevronDownIcon className={styles.selectChevron} size={12} />
      </RAButton>
      <RAPopover {...appearance} className={cx(overlayStyles.popover, appearance?.className)} offset={4} placement="bottom start">
        <NestedOverlay>{asRAListBox(options)}</NestedOverlay>
      </RAPopover>
      {errorMessage ? <div className={styles.error} role="alert">{errorMessage}</div> : null}
    </RASelect>
  );
});

function asRAListBox(options: SelectOption[]) {
  return (
    <RAListBox className={collectionStyles.listbox} items={options}>
      {(item) => (
        <RAItem id={item.id} textValue={item.label} isDisabled={item.isDisabled}>
          {item.label}
        </RAItem>
      )}
    </RAListBox>
  );
}
