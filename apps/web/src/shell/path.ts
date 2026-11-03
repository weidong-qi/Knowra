export interface PathSegment {
  /** React key；通常 `${kind}:${id}`。 */
  id: string;
  /** 位置显示文案。 */
  label: string;
  /** 父级段的返回动作；当前段通常不提供。 */
  onNavigate?(): void;
  /** 明确标记当前路由位置。 */
  current?: boolean;
}

export type PathSurface = 'status' | 'notes-index';

/**
 * 同一份 canonical path 在不同 surface 的展示投影。
 * 顶部索引带省略全局主页，但不复制或改写任何位置文案。
 */
export function pathForSurface(path: PathSegment[], surface: PathSurface): PathSegment[] {
  if (surface === 'notes-index') return path.filter((segment) => segment.id !== 'home');
  return path;
}
