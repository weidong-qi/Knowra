import type { WorkDomain } from '../store/types';
import type { PathSegment } from './path';

export interface StatusPathInput {
  pathname: string;
  routeDomain: WorkDomain;
  onNavigateHome(): void;
  onNavigateMaterials(): void;
  /** 笔记编辑路由的当前标题；索引页不传。 */
  noteTitle?: string | null;
}

/**
 * Derives the stable surface breadcrumb shown by StatusBar.
 *
 * A store selection is intentionally not an implicit location. In particular,
 * workspace hydration may select the first note in the background; `/materials`
 * must still describe the index surface as `笔记库 / 全部笔记`.
 */
export function deriveStatusPath({
  pathname,
  routeDomain,
  onNavigateHome,
  onNavigateMaterials,
  noteTitle
}: StatusPathInput): PathSegment[] {
  const home: PathSegment = { id: 'home', label: '主页', onNavigate: onNavigateHome };

  if (pathname === '/') {
    return [{ ...home, current: true }];
  }

  if (pathname === '/showcase') {
    return [home, { id: 'showcase', label: '组件库', current: true }];
  }

  if (pathname === '/showcase/icons') {
    return [home, { id: 'showcase', label: '组件库' }, { id: 'icons', label: '图标库', current: true }];
  }

  if (pathname === '/settings') {
    return [home, { id: 'settings', label: '设置', current: true }];
  }

  if (routeDomain === 'materials') {
    if (pathname.startsWith('/materials/notes/')) {
      return [
        { id: 'materials:root', label: '笔记库', onNavigate: onNavigateMaterials },
        { id: 'materials:note', label: noteTitle || '笔记', current: true }
      ];
    }
    return [
      { id: 'materials:root', label: '笔记库', onNavigate: onNavigateMaterials },
      { id: 'materials:index', label: '全部笔记', current: true }
    ];
  }

  const domainLabel: Record<WorkDomain, string> = {
    'task-workspaces': '任务工作区',
    materials: '资料',
    knowledge: '知识库',
    training: '试题库',
    learning: '执行',
    profile: '我的'
  };
  return [home, { id: `domain:${routeDomain}`, label: domainLabel[routeDomain], current: true }];
}
