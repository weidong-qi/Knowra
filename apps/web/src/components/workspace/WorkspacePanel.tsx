import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import styles from './WorkspacePanel.module.css';

function classNames(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(' ');
}

type PanelProps = HTMLAttributes<HTMLElement> & { as?: 'article' | 'main' };

export function WorkspacePanel({ as: Element = 'article', className, children, ...props }: PanelProps) {
  return <Element className={classNames(styles.panel, className)} {...props}>{children}</Element>;
}

export function WorkspacePanelHeader({ title, titleId, icon, history, breadcrumb, breadcrumbTitle, actions, actionsLabel, className }: {
  title: string;
  code: string;
  titleId?: string;
  icon?: ReactNode;
  history?: ReactNode;
  breadcrumb: ReactNode;
  breadcrumbTitle?: string;
  actions?: ReactNode;
  actionsLabel: string;
  className?: string;
}) {
  return <header className={classNames(styles.header, className)}>
    <div className={styles.title}>
      {icon}
      {titleId ? <h1 id={titleId}>{title}</h1> : <span>{title}</span>}
    </div>
    {history}
    <nav className={styles.breadcrumb} aria-label="当前位置" title={breadcrumbTitle}>
      {breadcrumb}
    </nav>
    <div className={styles.actions} aria-label={actionsLabel}>{actions}</div>
  </header>;
}

export function WorkspacePanelToolbar({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={styles.toolbarFrame}>
    <div className={classNames(styles.toolbar, className)} {...props}>{children}</div>
  </div>;
}

export const WorkspacePanelBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { grid?: boolean }>(
  function WorkspacePanelBody({ children, className, grid = false, ...props }, ref) {
    return <div ref={ref} className={classNames(styles.body, grid && styles.gridBody, className)} {...props}>{children}</div>;
  }
);

export function WorkspacePanelFooter({ children, className, ...props }: HTMLAttributes<HTMLElement>) {
  return <footer className={classNames(styles.footer, className)} {...props}>{children}</footer>;
}

export { styles as workspacePanelStyles };
