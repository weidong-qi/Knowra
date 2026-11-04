// V5 全局外壳：常驻标签/操作顶栏、模块轨道、上下文侧栏与内容面板。

import { useEffect, useState, type ReactNode, type HTMLAttributes } from 'react';
import { ModuleRail } from './ModuleRail';
import { type PathSegment, type StatusPanel } from './StatusBar';
import { MobileTabs } from './MobileTabs';
import { DesktopTitlebarContext } from './DesktopTitlebarContext';
import { cx } from '../components/ui/classnames';
import type { WorkDomain } from '../store/types';
import styles from './AppShell.module.css';
import { ShellToolbar } from './ShellToolbar';
import { ResponsivePanel } from '../components/ui/overlay/ResponsivePanel';
import { IconButton } from '../components/ui/button';
import { CloseIcon } from '../components/icons/knowra';

export interface AppShellProps {
  children: ReactNode;
  appearance?: HTMLAttributes<HTMLDivElement>;
  toolbarAccessories?: ReactNode;
  /** 当前工作域的上下文导航；与主工作区并列，拥有独立滚动边界。 */
  contextSidebar?: ReactNode;
  contextSidebarOpen?: boolean;
  navigationKey?: string;
  /** 当前激活的工作域（用于 Rail / MobileTabs 的 aria-current）；组件展台没有业务工作域时传 null。 */
  activeDomain: WorkDomain | null;
  onSelectDomain(domain: WorkDomain): void;
  onReturnHome(): void;
  onOpenSearch?(): void;
  onOpenNotifications?(): void;
  onOpenSettings?(): void;
  onOpenAssistant?(): void;
  isSettingsActive?: boolean;
  isAssistantActive?: boolean;
  /** StatusBar 数据。 */
  statusbar: {
    /** 当前位置 breadcrumb；至少 1 段。 */
    path: PathSegment[];
    charCount?: number;
    savedAt?: string | null;
    saveState?: 'idle' | 'saving' | 'saved' | 'error';
    saveError?: string | null;
    dataMode: 'api' | 'cache' | 'local' | 'loading';
    showDataMode?: boolean;
    persistenceMode?: 'remote' | 'desktop-local';
    dataModeNote?: ReactNode;
    panels?: StatusPanel[];
  };
  /** 移动端底栏（≤767px 替代 rail）。 */
  mobileTabs?: boolean;
  /** live region 用于无障碍宣告。 */
  liveAnnouncement?: string;
  /** 编辑器等沉浸式页面由自身管理内边距和滚动边界。 */
  stageMode?: 'default' | 'workspace';
  /** Mac 应用的笔记页将标签栏放入原生窗口标题栏。 */
  desktopTitlebarEditor?: boolean;
  /** Mac 应用其他页面继续显示已打开的笔记标签。 */
  desktopTitlebarTabs?: ReactNode;
  /** 专注模式隐藏应用轨道、上下文侧栏和移动端导航，只保留编辑舞台与状态栏。 */
  focusMode?: boolean;
}

export function AppShell({
  children,
  appearance,
  toolbarAccessories,
  contextSidebar,
  contextSidebarOpen = true,
  navigationKey,
  activeDomain,
  onSelectDomain,
  onReturnHome,
  onOpenSearch,
  onOpenNotifications,
  onOpenSettings,
  onOpenAssistant,
  isSettingsActive,
  isAssistantActive,
  statusbar,
  mobileTabs,
  liveAnnouncement,
  stageMode = 'default',
  desktopTitlebarEditor = false,
  desktopTitlebarTabs,
  focusMode = false
}: AppShellProps) {
  const desktop = typeof window !== 'undefined' && Boolean(window.knowraDesktop);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 920px)').matches ?? false));
  const [sidebarOverlayOpen, setSidebarOverlayOpen] = useState(false);
  const [skipFocused, setSkipFocused] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 920px)');
    if (!media) return;
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { setSidebarOverlayOpen(false); setSkipFocused(false); }, [navigationKey]);
  useEffect(() => { if (focusMode) setSidebarOverlayOpen(false); }, [focusMode]);
  const sidebarVisible = !focusMode && (compact ? sidebarOverlayOpen : contextSidebarOpen);
  const toolbarStatus = { ...statusbar, panels: statusbar.panels?.filter(panel => !focusMode || panel.id !== 'sidebar').map(panel => panel.id === 'sidebar' ? { ...panel, active: sidebarVisible, onToggle: compact ? () => setSidebarOverlayOpen(open => !open) : panel.onToggle } : panel) };
  const [titlebarHost, setTitlebarHost] = useState<HTMLDivElement | null>(null);
  return (
    <DesktopTitlebarContext.Provider value={{ enabled: desktop, host: titlebarHost }}>
    <div {...appearance} className={cx(
      styles.shell,
      appearance?.className,
      desktop ? styles.desktopShell : undefined,
      contextSidebar && sidebarVisible && !focusMode && !compact ? styles.shellWithSidebar : undefined,
      focusMode ? styles.focusShell : undefined
    )} data-desktop={desktop || undefined}>
      <a href="#feature-stage" className={styles.skipLink} onClick={event => {
        event.preventDefault();
        setSkipFocused(true);
        document.getElementById('feature-stage')?.focus({ preventScroll: true });
      }}>
        跳到主内容
      </a>

      <header className={styles.desktopTitlebar} aria-label={desktop ? 'Mac 窗口标题栏' : '全局顶栏'}>
        <ShellToolbar status={toolbarStatus}>
          <div ref={setTitlebarHost} className={styles.desktopTitlebarHost}>
            {!desktopTitlebarEditor ? desktopTitlebarTabs ?? <span className={styles.desktopTitle}>知境</span> : null}
          </div>
          {toolbarAccessories ? <span className={styles.toolbarDivider} aria-hidden="true" /> : null}
          {toolbarAccessories}
        </ShellToolbar>
      </header>

      {!focusMode ? <ModuleRail
        activeDomain={activeDomain}
        onSelect={onSelectDomain}
        onReturnHome={onReturnHome}
        onOpenNotifications={onOpenNotifications}
        onOpenSettings={onOpenSettings}
        onOpenAssistant={onOpenAssistant}
        isSettingsActive={isSettingsActive}
        isAssistantActive={isAssistantActive}
      /> : null}

      {contextSidebar && !focusMode ? (
        <aside className={styles.contextSidebar} hidden={!sidebarVisible} aria-label="笔记上下文导航" data-compact={compact || undefined} data-open={sidebarVisible || undefined}>
          <ResponsivePanel title="笔记导航" modal={compact} isOpen={sidebarVisible} onClose={() => setSidebarOverlayOpen(false)} className={styles.sidebarDialog}>
            {compact && sidebarVisible ? <div className={styles.sidebarClose}><IconButton aria-label="关闭笔记导航" onPress={() => setSidebarOverlayOpen(false)}><CloseIcon size={18} /></IconButton></div> : null}
            {contextSidebar}
          </ResponsivePanel>
        </aside>
      ) : null}

      <main
        id="feature-stage"
        data-skip-focused={skipFocused || undefined}
        onBlur={() => setSkipFocused(false)}
        className={cx(styles.stage, stageMode === 'workspace' ? styles.workspaceStage : undefined)}
        tabIndex={-1}
      >
        {children}
      </main>


      {mobileTabs && !focusMode ? (
        <MobileTabs
          activeDomain={activeDomain}
          onSelect={onSelectDomain}
          onOpenSearch={onOpenSearch}
          onOpenSettings={onOpenSettings}
          onOpenAssistant={onOpenAssistant}
          isSettingsActive={isSettingsActive}
          isAssistantActive={isAssistantActive}
        />
      ) : null}

      <div className={styles.liveRegion} role="status" aria-live="polite">
        {liveAnnouncement ?? ''}
      </div>
    </div>
    </DesktopTitlebarContext.Provider>
  );
}
