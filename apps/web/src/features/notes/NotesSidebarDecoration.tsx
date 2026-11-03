import { useMemo } from 'react';
import type { Note } from '@study-accelerator/web-core';
import { buildNoteUpdateDistribution } from './notesIndexUpdateDistribution';
import { ACCENT } from '../../components/icons/knowra';
import styles from './NotesContextSidebar.module.css';

export function NotesUpdateDistribution({ notes }: { notes: readonly Note[] }) {
  const { days, total } = useMemo(() => buildNoteUpdateDistribution(notes), [notes]);
  return <section className={styles.updateDistribution} aria-label="已加载笔记 · 最近更新时间分布">
    <div className={styles.distributionHeader}>已加载笔记 · 最近更新时间分布</div>
    <p className={styles.distributionExplanation}><span>每篇仅计一次</span><span>近 12 周 <b>{total}</b> 篇</span></p>
    <div className={styles.heatGrid} role="img" aria-label={`已加载存活笔记中，${total} 篇的最近更新时间在近 12 周内；非完整编辑历史。`}>
      {days.map(day => <span key={day.date} data-level={day.level} data-today={day.today || undefined} data-future={day.future || undefined} title={`${day.date}：${day.count} 篇笔记`} />)}
    </div>
    <div className={styles.heatLegend} aria-hidden="true">少{[0, 1, 2, 3, 4].map(level => <i key={level} data-level={level} />)}多</div>
  </section>;
}

export function NotesTrashDecoration({ full }: { full: boolean }) {
  return <svg className={styles.trashIcon} data-full={full || undefined} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g className={styles.trashLid}><path d="M3 6h18M9 6V3h6v3" /></g>
    <path d="M19 6l-1 14H6L5 6" />
    {full ? <path className={styles.trashScrap} d="m9.6 8.2 1.4 1.6m2.6-2.2.9 2" /> : null}
  </svg>;
}



/** 笔记库：一个六边形格子，中心一枚主色“核”；形状极简，15px 下依然清晰。 */
export function NotesLibraryDecoration() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4Z" />
    <circle cx="12" cy="12" r="2.2" fill={ACCENT} stroke={ACCENT} />
  </svg>;
}
