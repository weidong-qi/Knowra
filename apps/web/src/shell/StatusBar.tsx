// V4-05 StatusBar
//
// 印格 32px 状态条：左侧 breadcrumb（当前位置），中部 spacer，
// 右侧字数 / 保存状态 / 数据模式 / 同步状态 / 面板开关。
// breadcrumb 由 App 派生，StatusBar 只负责数据→渲染，零业务判断。

import { forwardRef, type ReactNode } from 'react';
import type { WorkspaceDataMode } from '@study-accelerator/web-core';
import { cx } from '../components/ui/classnames';
import { FocusIcon, PanelIcon, SidebarIcon } from '../components/icons/knowra';
import { PathTrail } from './PathTrail';
import type { PathSegment } from './path';
import styles from './StatusBar.module.css';

export type { PathSegment } from './path';

export interface StatusPanel {
  id: 'sidebar' | 'inspector' | 'focus';
  label: string;
  active: boolean;
  onToggle(): void;
}

export interface StatusBarProps {
  /** 当前位置的 breadcrumb；至少 1 段，第 0 段约定为"主页"或工作域根。 */
  path: PathSegment[];
  presentation?: 'bar' | 'detail';
  charCount?: number;
  savedAt?: string | null;
  saveState?: 'idle' | 'saving' | 'saved' | 'error';
  saveError?: string | null;
  dataMode: WorkspaceDataMode;
  showDataMode?: boolean;
  persistenceMode?: 'remote' | 'desktop-local';
  /** 真实数据 / 缓存 / 本地恢复 之外的额外业务描述（如"重试"动作）。 */
  dataModeNote?: ReactNode;
  panels?: StatusPanel[];
}

export const StatusBar = forwardRef<HTMLElement, StatusBarProps>(function StatusBar(
  { path, charCount, savedAt, saveState, saveError, dataMode, showDataMode = true, persistenceMode, dataModeNote, panels = [], presentation = 'bar' },
  ref
) {
  const modeMeta = persistenceMode === 'desktop-local' && dataMode === 'api'
    ? { label: dataModeNote ? '本地资料' : '本地资料 · 云端同步未启用', squareClass: styles.squareWarning }
    : describeDataMode(dataMode);
  return (
    <footer ref={ref} className={cx(styles.statusbar, presentation === 'detail' && styles.detail)} role="contentinfo" aria-label="状态栏">
      {path.length > 0 ? (
        <span className={styles.context} aria-label="工作区位置">
          <span className={styles.contextDot} aria-hidden="true" />
          <PathTrail path={path} />
        </span>
      ) : null}

      {typeof charCount === 'number' ? (
        <span className={cx(styles.item, styles.itemCount)}>
          <span className={styles.mono}>{charCount.toLocaleString('zh-CN')}</span> 字
        </span>
      ) : null}

      {saveState && saveState !== 'idle' ? (
        <span className={cx(styles.item, styles.itemSaved)} aria-live="polite" title={saveState === 'error' ? saveError ?? undefined : undefined}>
          {saveState === 'saving' ? '保存中…' : saveState === 'error' ? '保存失败'
            : persistenceMode === 'desktop-local' ? '已保存到本机' : '已保存'}
          {saveState === 'saved' && savedAt ? (
            <time className={styles.mono} dateTime={savedAt}>
              {formatTime(savedAt)}
            </time>
          ) : null}
        </span>
      ) : null}

      <span className={styles.spacer} />

      {showDataMode ? persistenceMode === 'desktop-local' && dataMode === 'api' && dataModeNote
        ? <span className={styles.item}>{dataModeNote}</span>
        : <span className={styles.item} aria-label={`数据模式：${modeMeta.label}`}>
          <span className={cx(styles.square, modeMeta.squareClass)} aria-hidden="true" />
          <span>{modeMeta.label}</span>
          {dataModeNote ? <span className={styles.note}>{dataModeNote}</span> : null}
        </span> : null}

      {panels.length > 0 ? (
        <span className={styles.switches} aria-label="面板开关">
          {panels.map((panel) => (
            <button
              key={panel.id}
              type="button"
              className={styles.switch}
              aria-pressed={panel.active}
              aria-label={`切换${panel.label}`}
              title={panel.label}
              onClick={panel.onToggle}
            >
              {panel.id === 'sidebar' ? <SidebarIcon size={16} /> : null}
              {panel.id === 'inspector' ? <PanelIcon size={16} /> : null}
              {panel.id === 'focus' ? <FocusIcon size={16} /> : null}
            </button>
          ))}
        </span>
      ) : null}
    </footer>
  );
});

function describeDataMode(mode: WorkspaceDataMode) {
  switch (mode) {
    case 'api':
      return { label: '已同步', squareClass: styles.squareSync };
    case 'cache':
      return { label: '缓存只读', squareClass: styles.squareWarning };
    case 'local':
      return { label: '本地恢复', squareClass: styles.squareDanger };
    case 'loading':
    default:
      return { label: '加载中', squareClass: styles.squareNeutral };
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}
