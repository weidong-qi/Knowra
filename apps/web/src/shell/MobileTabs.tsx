// V4-05 MobileTabs
//
// ≤767px 时替代左侧 ModuleRail：工作域、助手、设置与搜索保持同一行。
// 选中态顶部 4px 蓝条 + 蓝字 + 白底。

import { forwardRef, type CSSProperties } from 'react';
import { PressableButton } from '../components/ui/button/PressableButton';
import { PRIMARY_DOMAINS, UTILITY_ITEMS, type RailItem } from './ModuleRail';
import { SearchIcon, SettingsIcon, SparkIcon } from '../components/icons/knowra';
import type { WorkDomain } from '../store/types';
import styles from './MobileTabs.module.css';

export interface MobileTabsProps {
  activeDomain: WorkDomain | null;
  onSelect(domain: WorkDomain): void;
  onOpenSearch?(): void;
  onOpenSettings?(): void;
  onOpenAssistant?(): void;
  isSettingsActive?: boolean;
  isAssistantActive?: boolean;
}

const ALL_ITEMS: readonly RailItem[] = [...PRIMARY_DOMAINS, ...UTILITY_ITEMS];

export const MobileTabs = forwardRef<HTMLElement, MobileTabsProps>(function MobileTabs(
  { activeDomain, onSelect, onOpenSearch, onOpenSettings, onOpenAssistant, isSettingsActive, isAssistantActive },
  ref
) {
  return (
    <nav ref={ref} className={styles.mobileTabs} style={{ '--mobile-tab-count': ALL_ITEMS.length + 3 } as CSSProperties} aria-label="移动端模块导航">
      {ALL_ITEMS.map((item) => {
        if (!item.available) {
          return (
            <PressableButton
              key={item.id}
              type="button"
              className={styles.mobileTab}
              isDisabled
              aria-label={`${item.label}：${item.description}`}
            >
              <span className={styles.mobileIcon}>
                <item.Icon size={19} />
              </span>
              <span className={styles.mobileLabel}>{item.label}</span>
            </PressableButton>
          );
        }
        return (
          <PressableButton
            key={item.id}
            type="button"
            className={styles.mobileTab}
            aria-current={item.id === activeDomain ? 'page' : undefined}
            aria-label={item.label}
            onPress={() => onSelect(item.id)}
          >
            <span className={styles.mobileIcon}>
              <item.Icon size={19} />
            </span>
            <span className={styles.mobileLabel}>{item.label}</span>
          </PressableButton>
        );
      })}
      <PressableButton type="button" className={styles.mobileTab} aria-label="AI 助手"
        aria-current={isAssistantActive ? 'page' : undefined} onPress={onOpenAssistant} isDisabled={!onOpenAssistant}>
        <span className={styles.mobileIcon}><SparkIcon size={19} /></span>
        <span className={styles.mobileLabel}>助手</span>
      </PressableButton>
      <PressableButton
        type="button"
        className={styles.mobileTab}
        aria-label="设置"
        aria-current={isSettingsActive ? 'page' : undefined}
        onPress={onOpenSettings}
        isDisabled={!onOpenSettings}
      >
        <span className={styles.mobileIcon}><SettingsIcon size={19} /></span>
        <span className={styles.mobileLabel}>设置</span>
      </PressableButton>
      <PressableButton
        type="button"
        className={styles.mobileTab}
        aria-label="打开全局搜索"
        onPress={onOpenSearch}
        isDisabled={!onOpenSearch}
      >
        <span className={styles.mobileIcon}>
          <SearchIcon size={19} />
        </span>
        <span className={styles.mobileLabel}>搜索</span>
      </PressableButton>
    </nav>
  );
});
