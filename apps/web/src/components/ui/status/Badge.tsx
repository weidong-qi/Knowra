// V4-04 Badge
//
// 22px 高的状态印章；左侧 6–7px 方点；tone 决定颜色。
// 状态点的颜色永远不用 emoji / 不用大色块（来自 §1 品牌原则）。

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../classnames';
import type { StatusTone } from '../tokens';
import styles from './Status.module.css';

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
  /** 隐藏左侧方点；用于纯文字状态。 */
  hideDot?: boolean;
}

const toneClass: Record<StatusTone, string> = {
  neutral: styles.toneNeutral,
  accent: styles.toneAccent,
  success: styles.toneSuccess,
  warning: styles.toneWarning,
  danger: styles.toneDanger
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = 'neutral', children, className, hideDot = false, ...rest },
  ref
) {
  return (
    <span ref={ref} className={cx(styles.badge, toneClass[tone], className)} {...rest}>
      {hideDot ? null : <span className={styles.badgeDot} aria-hidden="true" />}
      {children}
    </span>
  );
});
