// V4-04 Menu
//
// 1. 行为（↑↓ 循环 / Esc 关闭 / 焦点归还 / Home/End / 字符搜索）由 React Aria 提供。
// 2. 视觉与 MenuTrigger 由本封装统一：与印格 demo 的 .menu 完全一致。

import { forwardRef, type ReactNode } from 'react';
import {
  Menu as RAMenu,
  Text as RAText,
  Header as RAHeader,
  MenuItem as RAMenuItem,
  MenuSection as RAMenuSection,
  MenuTrigger as RAMenuTrigger,
  Popover as RAPopover,
  Separator as RASeparator,
  SubmenuTrigger as RASubmenuTrigger,
  type MenuItemProps as RAMenuItemProps,
  type MenuProps as RAMenuProps,
  type MenuTriggerProps as RAMenuTriggerProps,
  type PopoverProps as RAPopoverProps,
  type SubmenuTriggerProps as RASubmenuTriggerProps
} from 'react-aria-components';
import { cx } from '../classnames';
import styles from './Overlay.module.css';
import { useScopedAppearance } from './ScopedAppearance';
import { NestedOverlay } from './ResponsivePanel';

export type MenuItemProps = Omit<RAMenuItemProps, 'className' | 'children'> & {
  icon?: ReactNode;
  /** 右侧提示键位，例如 "⌘K"。 */
  kbd?: string;
  isDanger?: boolean;
  /** 标题下方的一行说明，仅在 `variant="rich"` 的菜单里排版。 */
  description?: string;
  children: ReactNode;
  className?: string;
};

export const MenuItem = forwardRef<HTMLDivElement, MenuItemProps>(function MenuItem(
  { children, icon, kbd, isDanger, description, className, ...rest },
  ref
) {
  return (
    <RAMenuItem
      ref={ref}
      className={cx(styles.item, className)}
      data-danger={isDanger || undefined}
      {...rest}
    >
      {icon ? <span className={styles.itemIcon}>{icon}</span> : null}
      {description
        ? <span className={styles.itemText}><RAText slot="label">{children}</RAText><RAText slot="description" className={styles.itemDesc}>{description}</RAText></span>
        : <span>{children}</span>}
      {kbd ? <span className={styles.itemKbd}>{kbd}</span> : null}
    </RAMenuItem>
  );
});

export interface MenuProps<T> extends Omit<RAMenuProps<T>, 'className' | 'children'> {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  /** `rich`：分组标题、图标底板和说明行的操作面板；默认保持紧凑菜单。 */
  variant?: 'default' | 'rich';
}

export function Menu<T extends object>({ children, className, ariaLabel, variant = 'default', ...rest }: MenuProps<T>) {
  return (
    <RAMenu<T> aria-label={ariaLabel} className={cx(styles.menu, variant === 'rich' && styles.menuRich, className)} {...rest}>
      {children}
    </RAMenu>
  );
}

export interface MenuHeaderProps {
  children: ReactNode;
  className?: string;
}

export const MenuHeader = forwardRef<HTMLElement, MenuHeaderProps>(function MenuHeader(
  { children, className },
  ref
) {
  return (
    <RAHeader ref={ref} className={cx(styles.menuHead, className)}>
      {children}
    </RAHeader>
  );
});

export interface MenuSectionProps {
  children: ReactNode;
  className?: string;
}

export const MenuSection = forwardRef<HTMLElement, MenuSectionProps>(function MenuSection(
  { children, className },
  ref
) {
  return <RAMenuSection ref={ref} className={className}>{children}</RAMenuSection>;
});

export const MenuSeparator = forwardRef<HTMLHRElement, { className?: string }>(
  function MenuSeparator({ className }, ref) {
    return <RASeparator ref={ref} className={cx(styles.separator, className)} />;
  }
);

export type MenuTriggerProps = Omit<RAMenuTriggerProps, 'children'> & {
  /**
   * 形如 [trigger, popover]。
   * React Aria 的 MenuTrigger 期望 trigger 与 Popover 平级，Popover 内部再放 Menu。
   * 不再在内部自动包裹 Popover，避免破坏 React Aria 的语义。
   */
  children: [ReactNode, ReactNode];
};

export function MenuTrigger({ children, ...rest }: MenuTriggerProps) {
  return <RAMenuTrigger {...rest}>{children}</RAMenuTrigger>;
}

/**
 * 二级菜单继续复用 React Aria 的悬浮延迟、指针安全通道与方向键语义。
 * 业务组件不自行维护 hover timer，避免鼠标跨越主菜单与子菜单时误关闭。
 */
export const SubmenuTrigger = RASubmenuTrigger;
export type SubmenuTriggerProps = RASubmenuTriggerProps;

/** 复用的 Popover 视觉默认值，业务代码可继续自行传入 placement / offset。 */
export const MenuPopover = forwardRef<
  HTMLDivElement,
  Omit<RAPopoverProps, 'children' | 'className'> & { children: ReactNode; className?: string }
>(
  function MenuPopover({ children, className, ...rest }, ref) {
    const appearance = useScopedAppearance();
    return (
      <RAPopover
        ref={ref}
        offset={4}
        placement="bottom start"
        {...appearance}
        {...rest}
        className={cx(styles.menuPopover, appearance?.className, className)}
      >
        <NestedOverlay>{children}</NestedOverlay>
      </RAPopover>
    );
  }
);
