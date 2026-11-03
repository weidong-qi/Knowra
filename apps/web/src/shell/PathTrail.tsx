import type { ReactNode } from 'react';
import type { PathSegment } from './path';
import styles from './PathTrail.module.css';

export interface PathTrailProps {
  path: PathSegment[];
  variant?: 'status' | 'top';
  /** `null` renders all supplied segments as non-current parents. */
  currentId?: string | null;
  currentAria?: 'location' | 'page';
  className?: string;
  renderSegment?(segment: PathSegment, isCurrent: boolean): ReactNode;
}

export function PathTrail({
  path,
  variant = 'status',
  currentId,
  currentAria = variant === 'top' ? 'page' : 'location',
  className,
  renderSegment
}: PathTrailProps) {
  if (path.length === 0) return null;
  const lastIndex = path.length - 1;
  const trailClass = [styles.trail, variant === 'top' ? styles.top : styles.status, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={trailClass}>
      {path.map((segment, index) => {
        const isCurrent = currentId === null
          ? false
          : currentId !== undefined
            ? segment.id === currentId
            : segment.current ?? index === lastIndex;
        return (
          <span key={segment.id} className={styles.fragment}>
            {index > 0 ? <span className={styles.separator} aria-hidden="true">{' / '}</span> : null}
            {renderSegment ? renderSegment(segment, isCurrent) : (
              <TrailSegment segment={segment} isCurrent={isCurrent} currentAria={currentAria} />
            )}
          </span>
        );
      })}
    </span>
  );
}

function TrailSegment({
  segment,
  isCurrent,
  currentAria
}: {
  segment: PathSegment;
  isCurrent: boolean;
  currentAria: 'location' | 'page';
}) {
  const isLink = !isCurrent && typeof segment.onNavigate === 'function';
  if (isLink) {
    return (
      <button
        type="button"
        className={styles.link}
        onClick={segment.onNavigate}
        aria-label={`跳转到「${segment.label}」`}
      >
        {segment.label}
      </button>
    );
  }
  return (
    <span className={styles.current} aria-current={isCurrent ? currentAria : undefined}>
      {segment.label}
    </span>
  );
}
