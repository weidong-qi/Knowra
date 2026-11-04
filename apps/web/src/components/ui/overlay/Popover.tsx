// V4-04 Popover
//
// 与 Menu 视觉一致；为非菜单用途（例如 Quick Look 预览、工具说明）提供通用浮层。
// 业务代码不得直接使用 react-aria-components 的 Popover。

import { forwardRef, type ReactNode } from 'react';
import {
  Dialog as RADialog,
  type DialogProps as RADialogProps,
  DialogTrigger as RADialogTrigger,
  Popover as RAPopover,
  type PopoverProps as RAPopoverProps,
  type DialogTriggerProps as RADialogTriggerProps
} from 'react-aria-components';
import { cx } from '../classnames';
import styles from './Overlay.module.css';
import { useScopedAppearance } from './ScopedAppearance';
import { NestedOverlay } from './ResponsivePanel';

export interface PopoverProps extends Omit<RAPopoverProps, 'className' | 'children'> {
  children: ReactNode;
  className?: string;
}

export const Popover = forwardRef<HTMLDivElement, PopoverProps>(function Popover(
  { children, className, ...rest },
  ref
) {
  const appearance = useScopedAppearance();
  return (
    <RAPopover ref={ref} {...appearance} {...rest} className={cx(styles.popover, appearance?.className, className)}>
      <NestedOverlay>{children}</NestedOverlay>
    </RAPopover>
  );
});

export type PopoverTriggerProps = Omit<RADialogTriggerProps, 'children'> & {
  children: [ReactNode, ReactNode];
};

export function PopoverTrigger({ children, ...rest }: PopoverTriggerProps) {
  return <RADialogTrigger {...rest}>{children}</RADialogTrigger>;
}

/** 浮层内的语义对话框，提供初始焦点与键盘交互。 */
export const PopoverDialog = forwardRef<HTMLDivElement, Omit<RADialogProps, 'children'> & { children: ReactNode }>(
  function PopoverDialog({ children, ...props }, ref) {
    return <RADialog ref={ref} {...props}>{children}</RADialog>;
  }
);
