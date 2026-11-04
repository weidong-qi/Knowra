import type { ReactNode } from 'react';
import { IconButton } from '../components/ui/button';
import { Popover, PopoverDialog, PopoverTrigger } from '../components/ui/overlay';
import { ArrowRightIcon, FocusIcon, PanelIcon, SidebarIcon, MoreHorizontalIcon } from '../components/icons/knowra';
import { useLocation } from '../app/router';
import { StatusBar, type StatusBarProps } from './StatusBar';
import styles from './ShellToolbar.module.css';

/** 全局控制与真实保存信息。与文档内容、标签页状态分离。 */
export function ShellToolbar({ status, children }: { status: StatusBarProps; children?: ReactNode }) {
  const navigation = useLocation();
  return <div className={styles.toolbar}>
    {status.panels?.filter(panel => panel.id === 'sidebar').map(panel => <span key={panel.id} className={styles.sidebarToggleSlot}><IconButton
      aria-label={`切换${panel.label}`} title={panel.label} aria-pressed={panel.active} onPress={panel.onToggle}>
      <SidebarIcon size={17} />
    </IconButton></span>)}
    <div className={styles.history} role="group" aria-label="浏览历史">
      <IconButton size={28} aria-label="后退" title="后退" disabled={!navigation.canGoBack || !navigation.back} onPress={navigation.back}>
        <span className={styles.backArrow}><ArrowRightIcon size={16} /></span>
      </IconButton>
      <IconButton size={28} aria-label="前进" title="前进" disabled={!navigation.canGoForward || !navigation.forward} onPress={navigation.forward}>
        <ArrowRightIcon size={16} />
      </IconButton>
    </div>
    {children}
    <div className={styles.actions} aria-label="工作区操作">
      {status.persistenceMode === 'desktop-local' ? status.dataModeNote : null}
      {status.panels?.filter(panel => panel.id !== 'sidebar').map(panel => <IconButton key={panel.id}
        aria-label={`切换${panel.label}`} title={panel.label} aria-pressed={panel.active} onPress={panel.onToggle}>
        {panel.id === 'inspector' ? <PanelIcon size={17} /> : <FocusIcon size={17} />}
      </IconButton>)}
      <PopoverTrigger>
        <IconButton aria-label="工作区状态" title={status.saveState === 'error' ? '保存失败，查看状态' : '工作区状态'}>
          <span className={styles.statusIndicator} data-error={status.saveState === 'error' || undefined}><MoreHorizontalIcon size={17} /></span>
        </IconButton>
        <Popover placement="bottom end">
          <PopoverDialog aria-label="工作区状态">
            <StatusBar {...status} dataModeNote={status.persistenceMode === 'desktop-local' && status.dataModeNote ? <span>本地资料 · 同步操作位于顶栏</span> : status.dataModeNote} panels={[]} presentation="detail" />
          </PopoverDialog>
        </Popover>
      </PopoverTrigger>
    </div>
    <span className={styles.announcement} aria-live="polite">
      {status.saveState === 'saving' ? '保存中…' : status.saveState === 'error' ? `保存失败：${status.saveError ?? '请检查工作区状态'}` : status.saveState === 'saved' ? '已保存' : ''}
    </span>
  </div>;
}
