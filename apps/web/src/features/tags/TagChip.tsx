import type { ButtonHTMLAttributes } from 'react';
import type { Tag, TagColor } from '@study-accelerator/web-core';
import styles from './TagChip.module.css';

export function normalizeTagColor(color: Tag['color']): TagColor {
  return ['blue', 'green', 'orange', 'red', 'violet'].includes(String(color))
    ? color as TagColor
    : 'neutral';
}

export function TagChip({ tag, selected = false, removable = false, className = '', ...props }: {
  tag: Tag;
  selected?: boolean;
  removable?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const interactive = Boolean(props.onClick || props.onContextMenu);
  const content = <>
    {selected ? <span className={styles.check} aria-hidden="true">✓</span> : null}
    <span className={styles.name}>{tag.name || '未命名标签'}</span>
    {removable ? <span className={styles.remove} aria-hidden="true">×</span> : null}
  </>;
  if (!interactive) {
    return <span className={`${styles.chip} ${className}`} data-color={normalizeTagColor(tag.color)} data-selected={selected || undefined}>{content}</span>;
  }
  return (
    <button
      type="button"
      className={`${styles.chip} ${interactive ? styles.interactive : ''} ${className}`}
      data-color={normalizeTagColor(tag.color)}
      data-selected={selected || undefined}
      {...props}
    >
      {content}
    </button>
  );
}
