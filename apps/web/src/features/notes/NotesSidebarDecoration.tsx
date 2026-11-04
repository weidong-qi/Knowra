import { useMemo } from 'react';
import type { Note } from '@study-accelerator/web-core';
import { buildNoteUpdateDistribution } from './notesIndexUpdateDistribution';
import styles from './NotesContextSidebar.module.css';

export function NotesUpdateDistribution({ notes }: { notes: readonly Note[] }) {
  const { days, total } = useMemo(() => buildNoteUpdateDistribution(notes), [notes]);
  return (
    <section className={styles.updateDistribution} aria-label="已加载笔记 · 最近更新时间分布">
      <div className={styles.distributionHeader}>已加载笔记 · 最近更新时间分布</div>
      <p className={styles.distributionExplanation}>
        <span>每篇仅计一次</span>
        <span>
          近 12 周 <b>{total}</b> 篇
        </span>
      </p>
      <div
        className={styles.heatGrid}
        role="img"
        aria-label={`已加载存活笔记中，${total} 篇的最近更新时间在近 12 周内；非完整编辑历史。`}
      >
        {days.map(day => (
          <span
            key={day.date}
            data-level={day.level}
            data-today={day.today || undefined}
            data-future={day.future || undefined}
            title={`${day.date}：${day.count} 篇笔记`}
          />
        ))}
      </div>
      <div className={styles.heatLegend} aria-hidden="true">
        少
        {[0, 1, 2, 3, 4].map(level => (
          <i key={level} data-level={level} />
        ))}
        多
      </div>
    </section>
  );
}

export function NotesTrashDecoration({ full }: { full: boolean }) {
  return (
    <svg
      className={styles.trashIcon}
      data-full={full || undefined}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g className={styles.trashLid}>
        <path d="M3 6h18M9 6V3h6v3" />
      </g>
      <path d="M19 6l-1 14H6L5 6" />
      {full ? <path className={styles.trashScrap} d="m9.6 8.2 1.4 1.6m2.6-2.2.9 2" /> : null}
    </svg>
  );
}

/** 笔记库：三本并排的书脊，线性单色，与文件夹、笔记图标同一线宽。 */
export function NotesLibraryDecoration() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 4.5h4.2v15H4.5Z" />
      <path d="M10.8 4.5H15v15h-4.2Z" />
      <path d="m16.9 5.9 3.9-.9 2.6 14.2-3.9.9Z" transform="translate(-2.2 0)" />
    </svg>
  );
}
