// V4-04 TagGroup
//
// 1. 用于资料标签、筛选 chip、多选胶囊；
// 2. 视觉：26px 高、1px 墨边、tone 软填、hover 浮起 1px 出现硬阴影、selected 压入；
// 3. 支持 tone / showDot / count / visibleLabel / onRemove（自动渲染 remove 按钮）；
// 4. 行为（箭头切换、Backspace/Delete 删除、空格选中）由 React Aria 提供。

import { forwardRef, type ReactNode } from 'react';
import {
  Button as RAButton,
  Tag as RATag,
  TagGroup as RATagGroup,
  TagList as RATagList,
  type Key,
  type TagGroupProps as RATagGroupProps,
  type TagListProps as RATagListProps,
  type TagProps as RATagProps
} from 'react-aria-components';
import { cx } from '../classnames';
import type { StatusTone } from '../tokens';
import styles from './Collection.module.css';

export interface TagItem {
  id: string;
  label: string;
  isDisabled?: boolean;
  /** 状态色；决定边框/文字/点的色相（与 Badge tone 同源）。 */
  tone?: StatusTone;
  /** 隐藏前导方点（默认显示）。 */
  hideDot?: boolean;
  /** 计数小角标，等宽数字后置。 */
  count?: number;
}

export type TagGroupProps = Omit<RATagGroupProps, 'className' | 'children'> & {
  /** 同时作为可见的组标签头与 aria-label。 */
  label: string;
  items: TagItem[];
  ariaLabel?: string;
  className?: string;
  /** 是否渲染可见的组标签头；默认 true。 */
  visibleLabel?: boolean;
  /** 组右侧的辅助信息（计数、状态等）。 */
  trailing?: ReactNode;
  /**
   * 移除回调；当提供时，每个 tag 会自动渲染一个内置的 remove 按钮。
   * 实际状态由调用方维护（推荐受控：传 defaultSelectedKeys / selectedKeys + onSelectionChange）。
   */
  onRemove?: (keys: Set<Key>) => void;
};

export const TagGroup = forwardRef<HTMLDivElement, TagGroupProps>(function TagGroup(
  { label, items, ariaLabel, className, visibleLabel = true, trailing, onRemove, ...rest },
  ref
) {
  const showHeader = visibleLabel || trailing !== undefined;
  const allowsRemoving = typeof onRemove === 'function';
  return (
    <div ref={ref} className={cx(styles.tagGroup, className)}>
      {showHeader ? (
        <div className={styles.tagGroupHeader}>
          <span className={styles.tagGroupLabel}>{label}</span>
          {trailing ? <span className={styles.tagGroupTrailing}>{trailing}</span> : null}
        </div>
      ) : null}
      <RATagGroup
        aria-label={ariaLabel ?? label}
        className={styles.tagList}
        onRemove={onRemove}
        {...rest}
      >
        <RATagList items={items} className={styles.tagList}>
          {(item) => (
            <RATag
              id={item.id}
              textValue={item.label}
              isDisabled={item.isDisabled}
              className={cx(styles.tag, item.tone ? toneClass[item.tone] : null)}
            >
              {item.hideDot ? null : <span className={styles.tagDot} aria-hidden="true" />}
              <span className={styles.tagLabel}>{item.label}</span>
              {typeof item.count === 'number' ? (
                <span className={styles.tagCount} aria-label={`数量 ${item.count}`}>
                  {item.count}
                </span>
              ) : null}
              {allowsRemoving ? (
                <RAButton slot="remove" className={styles.tagRemove} aria-label={`移除 ${item.label}`} />
              ) : null}
            </RATag>
          )}
        </RATagList>
      </RATagGroup>
    </div>
  );
});

const toneClass: Record<StatusTone, string> = {
  neutral: styles.toneNeutral,
  accent: styles.toneAccent,
  success: styles.toneSuccess,
  warning: styles.toneWarning,
  danger: styles.toneDanger
};

export const Tag = forwardRef<HTMLDivElement, RATagProps>(function Tag(props, ref) {
  return <RATag ref={ref} {...props} />;
});

export const TagList = forwardRef<HTMLDivElement, Omit<RATagListProps<TagItem>, 'children' | 'items'> & { items: TagItem[] }>(
  function TagList({ items, ...rest }, ref) {
    return <RATagList ref={ref} items={items} {...rest} />;
  }
);
