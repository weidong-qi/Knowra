// V5 桌面轨道：主页、工作域与底部工具组共用紧凑按钮。
// 选中态沿用分层外壳原型的白色高光、强调色图标与淡光晕。
// 工作域切换：setActiveWorkDomain；品牌按钮回主页。

import { forwardRef, type ReactNode } from 'react';
import { PressableButton } from '../components/ui/button/PressableButton';
import {
  KnowledgeIcon,
  BellIcon,
  CheckIcon,
  HomeIcon,
  NoteIcon,
  QuestionIcon,
  SparkIcon,
  SettingsIcon,
  UserIcon,
  type KnowraIconProps
} from '../components/icons/knowra';
import type { WorkDomain } from '../store/types';
import { cx } from '../components/ui/classnames';
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
    Icon: NoteIcon,
    available: true
  },
  {
    id: 'knowledge',
    label: '知识',
    description: '知识候选、人工确认与来源追溯。',
    Icon: KnowledgeIcon,
    available: true
  },
  {
    id: 'training',
    label: '试题',
    description: '题目库与考试场景。',
    Icon: QuestionIcon,
    available: true
  },
  { id: 'task-workspaces', label: '任务', description: '协作文档、任务执行与人工验收。', Icon: CheckIcon, available: true },
  {
    id: 'learning',
    label: '执行',
    description: '待办、打卡与习惯追踪。',
    Icon: CheckIcon,
    available: false
  }
] as const;

export const UTILITY_ITEMS: readonly RailItem[] = [
  {
    id: 'profile',
    label: '我的',
    description: '工作区与个人设置。',
    Icon: UserIcon,
    available: false
  }
] as const;

export interface ModuleRailProps {
  activeDomain: WorkDomain | null;
  onSelect(domain: WorkDomain): void;
  onReturnHome(): void;
  onOpenNotifications?(): void;
  onOpenSettings?(): void;
  onOpenAssistant?(): void;
  isSettingsActive?: boolean;
  isAssistantActive?: boolean;
}

export const ModuleRail = forwardRef<HTMLElement, ModuleRailProps>(function ModuleRail(
  {
    activeDomain,
    onSelect,
    onReturnHome,
    onOpenNotifications,
    onOpenSettings,
    onOpenAssistant,
    isSettingsActive,
    isAssistantActive
  },
  ref
) {
  return (
    <nav
      ref={ref}
      className={styles.rail}
      aria-label="工作域导航"
    >
      <PressableButton
        type="button"
        className={styles.railItem}
        aria-label="知境工作区"
        title="知境工作区"
        onPress={onReturnHome}
      >
        <span className={styles.railIcon}><HomeIcon size={18} /></span>
      </PressableButton>

      <div className={styles.railGroup} role="group" aria-label="主要工作域">
        {PRIMARY_DOMAINS.map((item) => (
          <RailButton
            key={item.id}
            item={item}
            isActive={item.id === activeDomain}
            onClick={() => onSelect(item.id)}
          />
        ))}
      </div>

      <div className={cx(styles.railGroup, styles.railGroupUtility)} role="group" aria-label="工具">
        <PressableButton type="button" className={styles.railItem} onPress={onOpenAssistant}
          aria-label="AI 助手" title="AI 助手" aria-current={isAssistantActive ? 'page' : undefined}
          isDisabled={!onOpenAssistant}>
          <span className={styles.railIcon}><SparkIcon size={18} /></span>
        </PressableButton>
        <RailActionButton
          label="通知"
          title="通知：尚未上线"
          Icon={BellIcon}
          onClick={onOpenNotifications}
        />
        <PressableButton
          type="button"
          className={styles.railItem}
          onPress={onOpenSettings}
          aria-current={isSettingsActive ? 'page' : undefined}
          aria-label={onOpenSettings ? '设置' : '设置（尚未上线）'}
          title={onOpenSettings ? '设置' : '设置：尚未上线'}
          isDisabled={!onOpenSettings}
        >
          <span className={styles.railIcon}>
            <SettingsIcon size={18} />
          </span>
        </PressableButton>
        {UTILITY_ITEMS.map((item) => (
          <RailButton
            key={item.id}
            item={item}
            isActive={item.id === activeDomain}
            onClick={() => onSelect(item.id)}
          />
        ))}
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
          <Icon size={18} />
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
        <Icon size={18} />
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
        <Icon size={18} />
      </span>
    </PressableButton>
  );
}

/** 主页入口在 TopBar 也使用，这里只导出图标本身。 */
export const HomeGlyphIcon = HomeIcon;
