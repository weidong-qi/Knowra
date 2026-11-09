// V5 桌面轨道：主页、工作域与底部工具组共用紧凑按钮。
// 选中态沿用分层外壳原型的白色高光、强调色图标与淡光晕。
// 工作域切换：setActiveWorkDomain；品牌按钮回主页。

import { forwardRef, type ReactNode } from 'react';
import { PressableButton } from '../components/ui/button/PressableButton';
import {
  BellIcon,
  RailAssistantIcon,
  RailHomeIcon,
  RailKnowledgeIcon,
  RailNoteIcon,
  RailQuestionIcon,
  RailSearchIcon,
  RailTaskIcon,
  RailTodoIcon,
  RailUserIcon,
  SettingsIcon,
  type KnowraIconProps
} from '../components/icons/knowra';
import type { WorkDomain } from '../store/types';
import { cx } from '../components/ui/classnames';
import { Menu, MenuItem, MenuPopover, MenuTrigger } from '../components/ui/overlay/Menu';
import styles from './ModuleRail.module.css';

export interface RailItem {
  id: WorkDomain;
  label: string;
  description: string;
  Icon: (props: KnowraIconProps) => ReactNode;
  available: boolean;
}

export const PRIMARY_DOMAINS: readonly RailItem[] = [
  {
    id: 'materials',
    label: '资料',
    description: 'Markdown 笔记的采集、编辑与整理。',
    Icon: RailNoteIcon,
    available: true
  },
  {
    id: 'knowledge',
    label: '知识',
    description: '知识候选、人工确认与来源追溯。',
    Icon: RailKnowledgeIcon,
    available: true
  },
  {
    id: 'training',
    label: '试题',
    description: '题目库与考试场景。',
    Icon: RailQuestionIcon,
    available: true
  },
  {
    id: 'task-workspaces',
    label: '任务',
    description: '协作文档、任务执行与人工验收。',
    Icon: RailTaskIcon,
    available: true
  },
  {
    id: 'learning',
    label: '待办',
    description: '主线、支线、今日安排与计划。',
    Icon: RailTodoIcon,
    available: true
  }
] as const;

export const UTILITY_ITEMS: readonly RailItem[] = [
  {
    id: 'profile',
    label: '我的',
    description: '工作区与个人设置。',
    Icon: RailUserIcon,
    available: false
  }
] as const;

export interface ModuleRailProps {
  activeDomain: WorkDomain | null;
  onSelect(domain: WorkDomain): void;
  onReturnHome(): void;
  onOpenSearch?(): void;
  onOpenNotifications?(): void;
  onOpenSettings?(): void;
  onOpenAssistant?(): void;
  isSettingsActive?: boolean;
  isAssistantActive?: boolean;
}

/** 左栏只展示已上线的工作域；未上线的入口（执行、我的等）在上线前不占位。 */
const AVAILABLE_DOMAINS = PRIMARY_DOMAINS.filter(item => item.available);

export const ModuleRail = forwardRef<HTMLElement, ModuleRailProps>(function ModuleRail(
  {
    activeDomain,
    onSelect,
    onReturnHome,
    onOpenSearch,
    onOpenNotifications,
    onOpenSettings,
    onOpenAssistant,
    isSettingsActive,
    isAssistantActive
  },
  ref
) {
  return (
    <nav ref={ref} className={styles.rail} aria-label="工作域导航">
      <div className={styles.railGroup} role="group" aria-label="全局">
        <PressableButton
          type="button"
          className={styles.railItem}
          aria-label="知境工作区"
          title="知境工作区"
          onPress={onReturnHome}
        >
          <span className={styles.railIcon}>
            <RailHomeIcon size={21} />
          </span>
        </PressableButton>
        {onOpenSearch ? (
          <PressableButton
            type="button"
            className={styles.railItem}
            aria-label="全局搜索"
            title="全局搜索（Ctrl+K）"
            onPress={onOpenSearch}
          >
            <span className={styles.railIcon}>
              <RailSearchIcon size={21} />
            </span>
          </PressableButton>
        ) : null}
      </div>

      <span className={styles.railDivider} aria-hidden="true" />

      <div className={styles.railGroup} role="group" aria-label="主要工作域">
        {AVAILABLE_DOMAINS.map(item => (
          <RailButton key={item.id} item={item} isActive={item.id === activeDomain} onClick={() => onSelect(item.id)} />
        ))}
      </div>

      <div className={cx(styles.railGroup, styles.railGroupUtility)} role="group" aria-label="工具">
        <PressableButton
          type="button"
          className={styles.railItem}
          onPress={onOpenAssistant}
          aria-label="AI 助手"
          title="AI 助手"
          aria-current={isAssistantActive ? 'page' : undefined}
          isDisabled={!onOpenAssistant}
        >
          <span className={styles.railIcon}>
            <RailAssistantIcon size={21} />
          </span>
        </PressableButton>
        {onOpenNotifications ? (
          <RailActionButton label="通知" title="通知" Icon={BellIcon} onClick={onOpenNotifications} />
        ) : null}
        {onOpenSettings ? (
          <MenuTrigger>
            <PressableButton
              type="button"
              className={styles.railItem}
              aria-label="账户与设置"
              title="账户与设置"
              aria-current={isSettingsActive ? 'page' : undefined}
            >
              <span className={styles.railIcon}>
                <RailUserIcon size={21} />
              </span>
            </PressableButton>
            <MenuPopover placement="right bottom">
              <Menu ariaLabel="账户与设置" onAction={key => (key === 'settings' ? onOpenSettings() : undefined)}>
                <MenuItem id="settings" icon={<SettingsIcon size={16} />}>
                  设置
                </MenuItem>
              </Menu>
            </MenuPopover>
          </MenuTrigger>
        ) : null}
      </div>
    </nav>
  );
});

interface RailButtonProps {
  item: RailItem;
  isActive: boolean;
  onClick(): void;
}

function RailButton({ item, isActive, onClick }: RailButtonProps) {
  const { Icon, label, description, id, available } = item;
  const ariaCurrent = isActive ? 'page' : undefined;
  if (!available) {
    return (
      <PressableButton
        type="button"
        className={styles.railItem}
        aria-label={`${label}（${available ? '可用' : '尚未上线'}）`}
        aria-disabled="true"
        isDisabled
        title={`${label}：${description}`}
      >
        <span className={styles.railIcon}>
          <Icon size={21} />
        </span>
      </PressableButton>
    );
  }
  return (
    <PressableButton
      type="button"
      className={styles.railItem}
      aria-label={label}
      aria-current={ariaCurrent}
      data-module={id}
      onPress={onClick}
      title={`${label}：${description}`}
    >
      <span className={styles.railIcon}>
        <Icon size={21} />
      </span>
    </PressableButton>
  );
}

interface RailActionButtonProps {
  label: string;
  title: string;
  Icon: (props: KnowraIconProps) => ReactNode;
  onClick?: () => void;
}

function RailActionButton({ label, title, Icon, onClick }: RailActionButtonProps) {
  return (
    <PressableButton
      type="button"
      className={styles.railItem}
      onPress={onClick}
      aria-label={onClick ? label : `${label}（尚未上线）`}
      title={title}
      isDisabled={!onClick}
    >
      <span className={styles.railIcon}>
        <Icon size={21} />
      </span>
    </PressableButton>
  );
}

/** 主页入口在 TopBar 也使用，这里只导出图标本身。 */
export const HomeGlyphIcon = RailHomeIcon;
