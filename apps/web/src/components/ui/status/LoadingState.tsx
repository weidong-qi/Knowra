// V4-04 LoadingState
//
// 1. 默认视觉：状态板 §7 的四条骨架脉冲；保留行内进度条与方点变体。
// 2. 默认 `aria-busy="true"` 但不阻塞输入（不遮挡 click）。
// 3. prefers-reduced-motion 时冻结动画。

import { forwardRef, type ReactNode } from 'react';
import { cx } from '../classnames';
import { SkeletonPulse } from './SkeletonPulse';
import styles from './Status.module.css';

export interface LoadingStateProps {
  label?: string;
  /** 默认四条骨架脉冲；也可使用行内进度条或方点脉冲。 */
  variant?: 'skeleton' | 'bar' | 'dots';
  className?: string;
  children?: ReactNode;
}

export const LoadingState = forwardRef<HTMLDivElement, LoadingStateProps>(function LoadingState(
  { label = '加载中…', variant = 'skeleton', className, children },
  ref
) {
  return (
    <div
      ref={ref}
      className={cx(styles.loading, variant === 'skeleton' && styles.loadingSkeleton, className)}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      {variant === 'skeleton' ? (
        <>
          {children ? <span>{children}</span> : <span>{label}</span>}
          <SkeletonPulse />
        </>
      ) : variant === 'bar' ? (
        <div className={styles.loadingBar} aria-hidden="true" />
      ) : (
        <div className={styles.loadingDots} aria-hidden="true">
          <div className={styles.loadingDot} />
          <div className={styles.loadingDot} />
          <div className={styles.loadingDot} />
        </div>
      )}
      {variant !== 'skeleton' ? (children ? <span>{children}</span> : <span>{label}</span>) : null}
    </div>
  );
});
