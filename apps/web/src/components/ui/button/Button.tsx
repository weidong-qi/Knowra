// V4-04 Button
//
// 唯一允许直接依赖 react-aria-components 的封装层之一；业务代码通过
// `import { Button } from '@/components/ui'` 间接访问。
//
// 4 个 variant：
// - `primary` ：当前容器最关键的动作（保存 / 创建 / 确定 / 导入 / 新建）。视觉：橙底 + 白字。
// - `default` ：普通动作。视觉：白底 + 墨边 + 墨字。
// - `ghost`   ：次要 / 取消 / 关闭 / 返回。视觉：无底，hover 才出底色。
// - `danger`  ：破坏性（删除 / 移除 / 归档）。
//
// 决策顺序：danger → primary → ghost → default。
// 仅图标按钮请使用 `IconButton`，不要使用本组件的 iconOnly。

import { forwardRef, type ReactNode } from 'react';
import { Button as RAButton, type ButtonProps as RAButtonProps } from 'react-aria-components';
import { cx } from '../classnames';
import type { ButtonVariant } from '../tokens';
import styles from './Button.module.css';

export interface ButtonProps extends Omit<RAButtonProps, 'className' | 'children' | 'isPending'> {
  /**
   * 视觉变体：
   * - `primary` 主操作 / `default` 普通 / `ghost` 弱化 / `danger` 危险。
   */
  variant?: ButtonVariant;
  /** 工作区工具栏、分组标题、密集卡片的尺寸；视觉规则统一由本组件维护。 */
  size?: 'default' | 'workspace' | 'compact' | 'mini' | 'toolbar' | 'footer';
  /** 小型操作默认胶囊；square 为小圆角矩形，不随主题变为胶囊。 */
  shape?: 'square' | 'pill';
  /** 低强调蓝色操作，用于卡片内的“查看”等入口。 */
  emphasis?: 'normal' | 'soft';
  /** 图标（仅 icon 模式时作为主内容；其它模式可与 label 并列）。 */
  icon?: ReactNode;
  /** 提交/保存中状态，禁用按压但保留焦点。 */
  isPending?: boolean;
  children?: ReactNode;
  className?: string;
}

const variantClass: Record<ButtonVariant, string> = {
  default: styles.btn,
  primary: cx(styles.btn, styles.primary),
  danger: cx(styles.btn, styles.danger),
  ghost: cx(styles.btn, styles.ghost)
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'default', shape = 'pill', emphasis = 'normal', icon, children, className, isPending, ...rest },
  ref
) {
  const composed = cx(variantClass[variant], size !== 'default' && styles[size], styles[shape], emphasis === 'soft' && styles.soft, className);
  return (
    <RAButton ref={ref} className={composed} isPending={isPending} {...rest}>
      {icon}
      {children}
    </RAButton>
  );
});
