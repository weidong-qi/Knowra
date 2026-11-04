import { cx } from '../classnames';
import styles from './Status.module.css';

export interface SkeletonPulseProps {
  className?: string;
}

/** 印格状态板 §7：四条宽度错落、同步呼吸的加载占位。 */
export function SkeletonPulse({ className }: SkeletonPulseProps) {
  return <div className={cx(styles.skeleton, className)} aria-hidden="true">
    <span className={styles.skeletonBar} />
    <span className={styles.skeletonBar} />
    <span className={styles.skeletonBar} />
    <span className={styles.skeletonBar} />
  </div>;
}
