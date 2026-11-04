// 首页小组件外壳：统一卡片外观、标题行与右上角操作位。
// 首页的每一块内容都放进这里，之后新增待办、标签等组件只需提供 body。

import type { ReactNode } from 'react';
import { cx } from '../components/ui/classnames';
import styles from './HomeWidget.module.css';

export interface HomeWidgetProps {
  id: string;
  title: string;
  icon?: ReactNode;
  /** 标题行右侧的操作（按钮、菜单等）。 */
  actions?: ReactNode;
  /** 内容贴边（列表类组件），否则带内边距。 */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function HomeWidget({ id, title, icon, actions, flush, className, children }: HomeWidgetProps) {
  const titleId = `home-widget-${id}`;
  return (
    <section className={cx(styles.widget, className)} aria-labelledby={titleId} data-widget={id}>
      <header className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {icon ? (
            <span className={styles.icon} aria-hidden="true">
              {icon}
            </span>
          ) : null}
          {title}
        </h2>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      <div className={flush ? styles.bodyFlush : styles.body}>{children}</div>
    </section>
  );
}
