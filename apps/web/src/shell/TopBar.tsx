// V4-05 TopBar
//
// 印格顶部：左侧页头（kicker + 标题 + 副标题），右侧全局搜索 + 主操作 + 通知。
// 全局搜索按钮显示 ⌘K / Ctrl K 提示；点击后由父级触发 SearchCommand。

import { forwardRef, type ReactNode } from 'react';
import { Button } from '../components/ui/button/Button';
import { cx } from '../components/ui/classnames';
import { BellIcon, PlusIcon, SearchIcon } from '../components/icons/knowra';
import styles from './TopBar.module.css';

export interface TopBarKicker {
  /** 单行 mono kicker（可选，V4 主页用 "今日" 之类）。 */
  text?: string;
}

export interface TopBarProps {
  kicker?: TopBarKicker;
  title: string;
  subtitle?: string;
  primaryAction?: ReactNode;
  onOpenSearch(): void;
  onOpenNotifications?(): void;
  notificationCount?: number;
  /** mac 用 ⌘K，其他平台显示 Ctrl K。默认探测 navigator.platform。 */
  shortcutHint?: string;
}

export const TopBar = forwardRef<HTMLElement, TopBarProps>(function TopBar(
  { kicker, title, subtitle, primaryAction, onOpenSearch, onOpenNotifications, notificationCount, shortcutHint },
  ref
) {
  const hint = shortcutHint ?? defaultShortcutHint();
  const hasNotifications = typeof notificationCount === 'number' && notificationCount > 0;
  return (
    <header ref={ref} className={styles.topbar}>
      <div className={styles.titleBlock}>
        {kicker?.text ? <span className={styles.kicker}>{kicker.text}</span> : null}
        <p className={styles.title}>{title}</p>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.searchTrigger}
          onClick={onOpenSearch}
          aria-label="打开全局搜索"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <SearchIcon size={16} />
          <span className={styles.searchLabel}>搜索资料 / 标签 / 跳转</span>
          <span className={styles.searchKbd} aria-hidden="true">{hint}</span>
        </button>
        {primaryAction ?? (
          <Button variant="primary" onClick={onOpenSearch}>
            <PlusIcon size={14} />
            <span>新建资料</span>
          </Button>
        )}
        <button
          type="button"
          className={cx(styles.iconSlot, hasNotifications && styles.iconSlotActive)}
          onClick={onOpenNotifications}
          aria-label={onOpenNotifications ? (hasNotifications ? `通知（${notificationCount} 条未读）` : '通知') : '通知（尚未上线）'}
          title={onOpenNotifications ? '通知' : '通知：尚未上线'}
          disabled={!onOpenNotifications}
        >
          <BellIcon size={18} />
          {hasNotifications ? (
            <span className={styles.iconBadge} aria-hidden="true">
              {notificationCount! > 9 ? '9+' : notificationCount}
            </span>
          ) : null}
        </button>
      </div>
    </header>
  );
});

function defaultShortcutHint(): string {
  if (typeof navigator === 'undefined') return 'Ctrl K';
  const platform = navigator.platform || '';
  if (/mac|iphone|ipad|ipod/i.test(platform)) return '⌘ K';
  return 'Ctrl K';
}
