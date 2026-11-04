// 首页小组件注册表与默认布局。
// 每个组件登记一项（标题、图标、渲染函数）；布局是一份纯数据，以后可替换为用户保存的配置，
// 新增待办、标签、日程等组件只需往 HOME_WIDGETS 里加一项。

import type { ReactNode } from 'react';
import type { Note, Tag } from '@study-accelerator/web-core';
import { Button } from '../components/ui/button/Button';
import { EmptyState } from '../components/ui/status';
import { ClockIcon } from '../components/icons/knowra';
import type { HomeStats } from './homeViewModel';
import { HeatmapBlock, RecentNotes, StatsTiles, StatusBlock, TagsBlock } from './HomeActivity';
import { Workbenches } from './HomeWorkbenches';

export type HomeWidgetId = 'recent' | 'stats' | 'heatmap' | 'status' | 'tags' | 'workbenches';
/** main：左侧主列；side：右侧窄列；wide：通栏。 */
export type HomeWidgetArea = 'main' | 'side' | 'wide';

export interface HomeWidgetLayoutItem {
  id: HomeWidgetId;
  area: HomeWidgetArea;
  hidden?: boolean;
}

export const DEFAULT_HOME_LAYOUT: readonly HomeWidgetLayoutItem[] = [
  { id: 'recent', area: 'main' },
  { id: 'stats', area: 'side' },
  { id: 'heatmap', area: 'side' },
  { id: 'status', area: 'side', hidden: true },
  { id: 'tags', area: 'side', hidden: true },
  { id: 'workbenches', area: 'wide' }
];

export interface HomeWidgetContext {
  stats: HomeStats;
  notes: Note[];
  tags: Tag[];
  isWritable: boolean;
  onOpenMaterials?: () => void;
  onOpenKnowledge?: () => void;
  onOpenSearch?: () => void;
  onOpenCreate?: () => void;
  onSelectNote?: (noteId: string, title: string) => void;
}

export interface HomeWidgetDefinition {
  title: string;
  icon?: ReactNode;
  flush?: boolean;
  actions?: (ctx: HomeWidgetContext) => ReactNode;
  render: (ctx: HomeWidgetContext) => ReactNode;
}

export const HOME_WIDGETS: Record<HomeWidgetId, HomeWidgetDefinition> = {
  recent: {
    title: '最近编辑',
    icon: <ClockIcon size={14} />,
    flush: true,
    actions: ctx => (
      <Button variant="ghost" size="compact" onClick={ctx.onOpenMaterials} isDisabled={!ctx.onOpenMaterials}>
        查看全部
      </Button>
    ),
    render: ctx =>
      ctx.stats.recentNotes.length ? (
        <RecentNotes notes={ctx.stats.recentNotes.slice(0, 7)} tags={ctx.tags} onOpen={ctx.onSelectNote} />
      ) : (
        <EmptyState
          title="还没有资料"
          description={
            ctx.isWritable ? '创建第一篇笔记，开始整理资料与知识。' : '当前为只读模式：连接资料服务后可继续操作。'
          }
          primaryAction={
            ctx.onOpenCreate ? (
              <Button variant="primary" onClick={ctx.onOpenCreate}>
                新建笔记
              </Button>
            ) : undefined
          }
          secondaryAction={ctx.onOpenSearch ? <Button onClick={ctx.onOpenSearch}>打开全局搜索</Button> : undefined}
        />
      )
  },
  stats: { title: '概览', render: ctx => <StatsTiles stats={ctx.stats} tags={ctx.tags} /> },
  heatmap: { title: '近 12 周', render: ctx => <HeatmapBlock notes={ctx.notes} /> },
  status: { title: '状态', render: ctx => <StatusBlock stats={ctx.stats} /> },
  tags: { title: '常用标签', render: ctx => <TagsBlock stats={ctx.stats} /> },
  workbenches: {
    title: '工作域',
    flush: true,
    render: ctx => (
      <Workbenches
        activeNoteCount={ctx.stats.activeNotes}
        onOpenMaterials={ctx.onOpenMaterials}
        onOpenKnowledge={ctx.onOpenKnowledge}
      />
    )
  }
};
