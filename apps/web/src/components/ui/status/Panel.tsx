// V4-04 Panel
//
// 通用卡片容器：白纸底、1px var(--ink) 边、shadow-1；header / body / footer 三段。

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../classnames';
import styles from './Status.module.css';

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  title?: ReactNode;
  /** 头部右侧的操作区（例如更多按钮、徽章）。 */
  headerActions?: ReactNode;
  /** 底部内容（例如状态行、按钮组）。 */
  footer?: ReactNode;
  /** body 内边距为 0；用于承载表格等自带边距的子内容。 */
  flush?: boolean;
  children: ReactNode;
}

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  { title, headerActions, footer, flush = false, children, className, ...rest },
  ref
) {
  return (
    <div ref={ref} className={cx(styles.panel, flush ? styles.flush : undefined, className)} {...rest}>
      {title || headerActions ? (
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>{title}</span>
          {headerActions}
        </div>
      ) : null}
      <div className={styles.panelBody}>{children}</div>
      {footer ? <div className={styles.panelFooter}>{footer}</div> : null}
    </div>
  );
});
