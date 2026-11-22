// V4-04 Tabs
//
// 行为（左右切换 / Home/End / 自动激活）由 React Aria 提供。
// 视觉：底部 2px 蓝激活条，hover 暖纸底，焦点蓝色实阴影。

import { forwardRef, type ReactNode } from 'react';
import {
  Tab as RATab,
  TabList as RATabList,
  TabPanel as RATabPanel,
  TabPanels as RATabPanels,
  Tabs as RATabs,
  type TabsProps as RATabsProps,
  type Key
} from 'react-aria-components';
import { cx } from '../classnames';
import styles from './Collection.module.css';
import segmentedStyles from '../button/SegmentedControl.module.css';

export interface TabsItem {
  id: Key;
  label: string;
  badge?: string | number;
  isDisabled?: boolean;
}

export interface TabsProps extends Omit<RATabsProps, 'className' | 'children'> {
  items: TabsItem[];
  appearance?: 'default' | 'segmented';
  className?: string;
  /** 渲染每个 Tab 的内容；用于自定 badge / icon。 */
  renderTab?: (item: TabsItem) => ReactNode;
  /** 渲染每个 Panel 的内容；默认用 id 找 children[key]。 */
  children: (item: TabsItem) => ReactNode;
}

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  { items, appearance = 'default', className, children, renderTab, 'aria-label': ariaLabel, ...rest },
  ref
) {
  const segmented = appearance === 'segmented';
  const listClass = segmented ? cx(segmentedStyles.group, segmentedStyles.compactGroup) : styles.tabList;
  const tabClass = segmented ? segmentedStyles.segment : styles.tab;
  return (
    <RATabs ref={ref} className={cx(styles.tabs, className)} {...rest}>
      <RATabList className={listClass} aria-label={ariaLabel}>
        {items.map(item => (
          <RATab key={item.id} id={item.id} isDisabled={item.isDisabled} className={tabClass}>
            {renderTab ? (
              renderTab(item)
            ) : (
              <>
                {item.label}
                {item.badge !== undefined ? (
                  <>
                    {' '}
                    <span className={segmented ? segmentedStyles.count : styles.tabBadge}>{item.badge}</span>
                  </>
                ) : null}
              </>
            )}
          </RATab>
        ))}
      </RATabList>
      <RATabPanels>
        {items.map(item => (
          <RATabPanel key={String(item.id)} id={item.id} className={styles.tabPanel}>
            {children(item)}
          </RATabPanel>
        ))}
      </RATabPanels>
    </RATabs>
  );
});
