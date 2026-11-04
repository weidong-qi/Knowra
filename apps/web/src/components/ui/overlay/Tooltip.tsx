// V4-04 Tooltip
//
// 默认 hover/focus 触发，Esc 关闭，焦点归还触发器。React Aria 的 TooltipTrigger
// 已经处理键盘焦点场景；视觉与阴影遵循印格 demo 的 .tooltip 定义。

import { forwardRef, type ReactNode } from 'react';
import {
  Tooltip as RATooltip,
  TooltipTrigger as RATooltipTrigger,
  type TooltipProps as RATooltipProps,
  type TooltipTriggerComponentProps
} from 'react-aria-components';
import { cx } from '../classnames';
import styles from './Overlay.module.css';
import { useScopedAppearance } from './ScopedAppearance';

export interface TooltipProps extends Omit<RATooltipProps, 'className' | 'children'> {
  children: ReactNode;
  className?: string;
}

export const Tooltip = forwardRef<HTMLDivElement, TooltipProps>(function Tooltip(
  { children, className, ...rest },
  ref
) {
  const appearance = useScopedAppearance();
  return (
    <RATooltip ref={ref} offset={6} {...appearance} {...rest} className={cx(styles.tooltip, appearance?.className, className)}>
      {children}
    </RATooltip>
  );
});

export type TooltipTriggerProps = Omit<TooltipTriggerComponentProps, 'children'> & {
  children: [ReactNode, ReactNode];
  /** 默认 250ms 延迟，可由调用方覆盖。 */
  delay?: number;
  /** 默认 300ms 关闭延迟。 */
  closeDelay?: number;
};

export function TooltipTrigger({ children, delay = 250, closeDelay = 300 }: TooltipTriggerProps) {
  return (
    <RATooltipTrigger delay={delay} closeDelay={closeDelay}>
      {children}
    </RATooltipTrigger>
  );
}
