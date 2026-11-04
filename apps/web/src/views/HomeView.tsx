// V5 首页：由小组件按布局配置（homeWidgets.tsx）渲染；左侧最近编辑，右侧概览，底部工作域入口。
// 所有数字、时间、标签均来自工作区数据；训练域尚未上线时保持锁定。

import { Fragment, useMemo } from 'react';
import type { Note, Folder, Tag } from '@study-accelerator/web-core';
import { Button } from '../components/ui/button/Button';
import { EmptyState, LoadingState } from '../components/ui/status';
import { RefreshIcon } from '../components/icons/knowra';
import styles from './HomeView.module.css';
import { HomeHero } from './HomeHero';
import { HomeWidget } from './HomeWidget';
import { DEFAULT_HOME_LAYOUT, HOME_WIDGETS, type HomeWidgetArea, type HomeWidgetContext } from './homeWidgets';
import { computeStats, greetingFor, formatToday, summaryLine } from './homeViewModel';

export interface HomeViewProps {
  loadState: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  dataMode: 'loading' | 'api' | 'cache' | 'local';
  notes: Note[];
  folders: Folder[];
  tags: Tag[];
  isWritable: boolean;
  onRetry(): void;
  onOpenMaterials?(): void;
  onOpenKnowledge?(): void;
  onOpenSearch?(): void;
  onOpenCreate?(): void;
  onOpenSchedule?(): void;
  onSelectNote?(noteId: string, title: string): void;
}

export function HomeView({
  loadState,
  error,
  dataMode,
  notes,
  folders,
  tags,
  isWritable,
  onRetry,
  onOpenMaterials,
  onOpenKnowledge,
  onOpenSearch,
  onOpenCreate,
  onOpenSchedule,
  onSelectNote
}: HomeViewProps) {
  const stats = useMemo(() => computeStats(notes, folders, tags), [notes, folders, tags]);
  const greeting = useMemo(() => greetingFor(new Date()), []);
  const today = useMemo(() => formatToday(), []);

  if (loadState === 'loading' && notes.length === 0 && dataMode !== 'cache') {
    return (
      <div className={styles.view}>
        <HomeHero
          id="home-title-loading"
          today={today}
          title={greeting}
          subtitle="正在连接资料服务，加载目录与笔记…"
          onOpenCreate={onOpenCreate}
          onOpenSchedule={onOpenSchedule}
          onOpenSearch={onOpenSearch}
        />
        <LoadingState label="正在加载资料…" />
      </div>
    );
  }

  if (loadState === 'error' && notes.length === 0) {
    return (
      <div className={styles.view}>
        <HomeHero
          id="home-title-error"
          today={today}
          title={greeting}
          subtitle="资料服务暂时不可用，请稍后重试。"
          onOpenCreate={onOpenCreate}
          onOpenSchedule={onOpenSchedule}
          onOpenSearch={onOpenSearch}
        />
        <EmptyState
          title="资料加载失败"
          description={error ?? '请检查 API 端口或稍后重试。'}
          primaryAction={
            <Button variant="primary" onClick={onRetry}>
              <RefreshIcon size={14} />
              <span>重试</span>
            </Button>
          }
          secondaryAction={onOpenSearch ? <Button onClick={onOpenSearch}>本地搜索</Button> : undefined}
        />
      </div>
    );
  }

  const ctx: HomeWidgetContext = {
    stats,
    notes,
    tags,
    isWritable,
    onOpenMaterials,
    onOpenKnowledge,
    onOpenSearch,
    onOpenCreate,
    onSelectNote
  };
  const renderArea = (area: HomeWidgetArea) =>
    DEFAULT_HOME_LAYOUT.filter(item => item.area === area && !item.hidden).map(item => {
      const def = HOME_WIDGETS[item.id];
      if (def.bare) return <Fragment key={item.id}>{def.render(ctx)}</Fragment>;
      return (
        <HomeWidget
          key={item.id}
          id={item.id}
          title={def.title}
          icon={def.icon}
          flush={def.flush}
          actions={def.actions?.(ctx)}
        >
          {def.render(ctx)}
        </HomeWidget>
      );
    });
  const belowAreas = (['main', 'side', 'wide'] as const).filter(area =>
    DEFAULT_HOME_LAYOUT.some(item => item.area === area && !item.hidden)
  );

  return (
    <div className={styles.view}>
      {loadState === 'error' ? (
        <div className={styles.errorBanner} role="alert">
          <span className={styles.errorDot} aria-hidden="true" />
          <span>{error ?? '资料服务暂时不可用。'}</span>
          <Button variant="ghost" onClick={onRetry}>
            <RefreshIcon size={14} />
            <span>重试</span>
          </Button>
        </div>
      ) : null}

      <HomeHero
        id="home-title"
        today={today}
        title={greeting}
        subtitle={loadState === 'error' ? '当前显示最近一次本地缓存。连接恢复后可继续编辑。' : summaryLine(stats)}
        onOpenCreate={onOpenCreate}
        onOpenSchedule={onOpenSchedule}
        onOpenSearch={onOpenSearch}
      >
        {renderArea('hero')}
      </HomeHero>

      {belowAreas.length ? (
        <div className={styles.below}>
          {belowAreas.map(area => (
            <div
              key={area}
              className={area === 'side' ? styles.sideCol : area === 'wide' ? styles.wideCol : styles.mainCol}
            >
              {renderArea(area)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
