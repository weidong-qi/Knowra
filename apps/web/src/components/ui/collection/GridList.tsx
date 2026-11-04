// V4-04 GridList
//
// 1. 行为（单选 / 多选 / 上下移动 / Home/End / typeahead）由 React Aria 提供。
// 2. 视觉：白纸底、底 1px --ink-panel、hover 暖纸底、selected 蓝软填。
// 3. 响应式：≥768px 使用多列 Grid；≤767px 切两行紧凑列表（标题 + meta），不压缩列、不出现横向滚动。
// 4. GridListHeader 不输出伪表头，避免与选择列表语义冲突（按 V4-04 验收 P1-6）。
// 5. 桌面模式不向业务层暴露 columnheader；若未来要做真表格，请改用 RAC Table。

import { forwardRef, type ReactNode, useMemo } from 'react';
import {
  GridList as RAGridList,
  GridListItem as RAGridListItem,
  type GridListItemProps as RAGridListItemProps,
  type GridListProps as RAGridListProps,
  type SelectionMode
} from 'react-aria-components';
import { cx } from '../classnames';
import styles from './Collection.module.css';

export interface GridListColumn<T> {
  id: string;
  /** 桌面 ≥768 CSS Grid 模板片段，例如 "minmax(220px, 2fr) 0.6fr 0.8fr 0.6fr"。 */
  template: string;
  /** 移动 ≤767 行的"标题"列；第一列永远是标题来源。 */
  title?: boolean;
  /** 桌面与移动的 cell renderer。 */
  cell: (item: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
}

export interface GridListProps<T>
  extends Omit<RAGridListProps<T>, 'className' | 'children' | 'items'> {
  items: T[];
  columns: GridListColumn<T>[];
  ariaLabel: string;
  getKey: (item: T) => string;
  selectionMode?: SelectionMode;
  emptyState?: ReactNode;
  className?: string;
}

export function GridList<T>({
  items,
  columns,
  ariaLabel,
  getKey,
  selectionMode = 'single',
  emptyState,
  className,
  ...rest
}: GridListProps<T>) {
  const template = useMemo(() => columns.map((c) => c.template).join(' '), [columns]);
  return (
    <RAGridList
      aria-label={ariaLabel}
      items={items}
      selectionMode={selectionMode}
      className={cx(styles.gridList, className)}
      style={{ display: 'grid' }}
      renderEmptyState={emptyState ? () => <>{emptyState}</> : undefined}
      {...rest}
    >
      {items.map((item) => (
        <RAGridListItem
          key={getKey(item)}
          id={getKey(item)}
          textValue={getRowTextValue(item, columns)}
          className={styles.gridRow}
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((col) => (
            <div
              key={col.id}
              data-col={col.id}
              data-col-title={col.title ? 'true' : undefined}
              className={styles.gridCell}
              style={{ justifyContent: col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start' }}
            >
              {col.cell(item)}
            </div>
          ))}
        </RAGridListItem>
      ))}
    </RAGridList>
  );
}

function getRowTextValue<T>(item: T, columns: GridListColumn<T>[]): string {
  const first = columns[0];
  if (!first) return String(item);
  const rendered = first.cell(item);
  if (typeof rendered === 'string' || typeof rendered === 'number') return String(rendered);
  return '';
}

export const GridListItem = forwardRef<HTMLDivElement, RAGridListItemProps>(function GridListItem(
  props,
  ref
) {
  return <RAGridListItem ref={ref} {...props} />;
});
