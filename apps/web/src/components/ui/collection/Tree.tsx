// V4-04 Tree
//
// 1. 行为：↑↓ 移动 / → 展开 / ← 收起 / Home/End / typeahead 由 React Aria 提供。
// 2. 视觉：左侧缩进（每层 14px），暖纸行底，hover 暖纸底，selected 蓝软填。
// 3. 业务代码只使用 <Tree> 与 items 数组；嵌套子节点通过内部 <Collection> 注册。

import { forwardRef, type ReactNode } from 'react';
import {
  Button as RAButton,
  Collection,
  Tree as RATree,
  TreeItem as RATreeItem,
  TreeItemContent as RATreeItemContent,
  type TreeItemContentProps as RATreeItemContentProps,
  type TreeItemProps as RATreeItemProps,
  type TreeProps as RATreeProps
} from 'react-aria-components';
import { cx } from '../classnames';
import { TreeExpandIcon } from '../../icons/knowra';
import styles from './Collection.module.css';

export interface TreeItemData {
  id: string;
  label: string;
  /** 子节点；为空则是叶子。 */
  children?: TreeItemData[];
  /** 右侧灰色计数；用于目录树显示资料数。 */
  count?: number;
  isDisabled?: boolean;
}

export interface TreeProps<T extends TreeItemData>
  extends Omit<RATreeProps<T>, 'className' | 'children' | 'items'> {
  items: T[];
  /** 每行额外的视觉元素（状态点、操作按钮）。 */
  renderExtras?: (item: T) => ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function Tree<T extends TreeItemData>({
  items,
  renderExtras,
  className,
  ariaLabel,
  ...rest
}: TreeProps<T>) {
  return (
    <RATree<T> aria-label={ariaLabel ?? '目录树'} className={cx(styles.tree, className)} items={items} {...rest}>
      {(item: T) => (
        <TreeRow item={item} renderExtras={renderExtras} />
      )}
    </RATree>
  );
}

interface TreeRowProps<T extends TreeItemData> {
  item: T;
  renderExtras?: (item: T) => ReactNode;
}

function TreeRow<T extends TreeItemData>({ item, renderExtras }: TreeRowProps<T>) {
  return (
    <RATreeItem textValue={item.label} isDisabled={item.isDisabled} className={styles.treeRow}>
      <RATreeItemContent>
        {({ hasChildItems, isExpanded, isFocused, isSelected, level }) => (
          <span
            className={styles.treeRow}
            data-focused={isFocused || undefined}
            data-selected={isSelected || undefined}
            style={{ ['--indent' as string]: `${12 + (level - 1) * 14}px` }}
          >
            {hasChildItems ? (
              <RAButton
                slot="chevron"
                className={styles.treeChevron}
                data-expanded={isExpanded || undefined}
                aria-label={isExpanded ? '收起' : '展开'}
              >
                <TreeExpandIcon size={10} />
              </RAButton>
            ) : (
              <span className={styles.treeChevron} aria-hidden="true" />
            )}
            <span className={styles.treeLabel}>{item.label}</span>
            {item.count !== undefined ? (
              <span className={styles.treeCount}>{item.count}</span>
            ) : null}
            {renderExtras ? renderExtras(item) : null}
          </span>
        )}
      </RATreeItemContent>
      {item.children && item.children.length > 0 ? (
        <Collection items={item.children as unknown as T[]}>
          {(child) => <TreeRow item={child} renderExtras={renderExtras} />}
        </Collection>
      ) : null}
    </RATreeItem>
  );
}

export const TreeItem = forwardRef<HTMLDivElement, Omit<RATreeItemProps, 'className'> & { children: ReactNode; className?: string }>(
  function TreeItem(props, ref) {
    return <RATreeItem ref={ref} {...props} />;
  }
);

export const TreeItemContent = forwardRef<Element, RATreeItemContentProps>(function TreeItemContent(props, ref) {
  return <RATreeItemContent ref={ref} {...props} />;
});
