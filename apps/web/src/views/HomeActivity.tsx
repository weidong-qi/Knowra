import { useMemo } from 'react';
import type { Note, Tag } from '@study-accelerator/web-core';
import { PressableButton } from '../components/ui/button/PressableButton';
import { Button } from '../components/ui/button/Button';
import { MathText } from '../components/math/MathText';
import { ArrowUpRightIcon } from '../components/icons/knowra';
import { NotesIndexArt } from '../features/notes/NotesIndexArt';
import { notePreview } from '../features/notes/NotesIndexItemMeta';
import { normalizeNoteStatus } from '../features/notes/notesIndexFilters';
import { buildNoteUpdateDistribution } from '../features/notes/notesIndexUpdateDistribution';
import { TagChip } from '../features/tags';
import { formatRecentTime, statusLabel, type HomeStats } from './homeViewModel';
import styles from './HomeView.module.css';

export function FeaturedNote({ note, tags, onOpen }: { note: Note; tags: Tag[]; onOpen?: (noteId: string, title: string) => void }) {
  const title = note.title || '无标题';
  const noteTags = note.tagIds.map(id => tags.find(tag => tag.id === id)).filter((tag): tag is Tag => Boolean(tag));
  const preview = notePreview(note);
  const open = onOpen ? () => onOpen(note.id, title) : undefined;
  return (
    <article className={styles.featured} aria-label="继续上次编辑">
      <div className={styles.featuredArt}><NotesIndexArt item={{ kind: 'note', note }} tags={noteTags} /></div>
      <div className={styles.featuredBody}>
        <p className={styles.eyebrow}>
          继续上次编辑 · <time dateTime={note.updatedAt ?? note.createdAt ?? ''}>{formatRecentTime(note.updatedAt ?? note.createdAt)}</time>
        </p>
        <h3 className={styles.featuredTitle}>
          <PressableButton type="button" className={styles.featuredLink} onPress={open} isDisabled={!open}><MathText text={title} inlineOnly /></PressableButton>
        </h3>
        {preview ? <p className={styles.featuredSummary}><MathText text={preview} inlineOnly /></p> : <p className={styles.featuredSummaryEmpty}>这篇笔记还没有内容。</p>}
        <div className={styles.featuredMeta}>
          <span className={styles.statusPill} data-status={normalizeNoteStatus(note.status)}>{statusLabel(note)}</span>
          {noteTags.slice(0, 3).map(tag => <TagChip key={tag.id} tag={tag} />)}
          <Button className={styles.continueButton} variant="primary" size="compact" onClick={open} isDisabled={!open} aria-label={`继续编辑 ${title}`}>
            继续编辑<ArrowUpRightIcon size={14} />
          </Button>
        </div>
      </div>
    </article>
  );
}

export function ActivityPanel({ stats, notes, tags }: { stats: HomeStats; notes: Note[]; tags: Tag[] }) {
  const { days, total } = useMemo(() => buildNoteUpdateDistribution(notes), [notes]);
  const statusTotal = stats.statusSegments.reduce((sum, segment) => sum + segment.count, 0);
  return (
    <aside className={styles.activity} aria-label="活动概览">
      <dl className={styles.tiles}>
        <div><dt>笔记</dt><dd>{stats.activeNotes}</dd></div>
        <div><dt>文件夹</dt><dd>{stats.folderCount}</dd></div>
        <div><dt>标签</dt><dd>{tags.length}</dd></div>
        <div><dt>收藏</dt><dd>{stats.favoriteCount}</dd></div>
      </dl>

      <section className={styles.block} aria-label="近 12 周更新分布">
        <header className={styles.blockHead}><h3>近 12 周</h3><span>{total} 篇有更新</span></header>
        <div className={styles.heat} role="img" aria-label={`已加载笔记中，${total} 篇的最近更新时间在近 12 周内`}>
          {days.map(day => <span key={day.date} data-level={day.level} data-today={day.today || undefined} data-future={day.future || undefined} title={`${day.date}：${day.count} 篇`} />)}
        </div>
      </section>

      <section className={styles.block} aria-label="状态分布">
        <header className={styles.blockHead}><h3>状态</h3><span>{statusTotal} 篇</span></header>
        {statusTotal ? (
          <>
            <div className={styles.statusBar} role="img" aria-label={stats.statusSegments.map(item => `${item.label} ${item.count}`).join('，')}>
              {stats.statusSegments.map(item => <i key={item.key} data-status={item.key} style={{ flexGrow: item.count }} />)}
            </div>
            <ul className={styles.statusLegend}>
              {stats.statusSegments.map(item => <li key={item.key}><i data-status={item.key} aria-hidden="true" />{item.label}<b>{item.count}</b></li>)}
            </ul>
          </>
        ) : <p className={styles.muted}>暂无笔记。</p>}
      </section>

      <section className={styles.block} aria-label="常用标签">
        <header className={styles.blockHead}><h3>常用标签</h3></header>
        {stats.topTags.length ? (
          <ul className={styles.topTags}>
            {stats.topTags.map(({ tag, count }) => <li key={tag.id}><TagChip tag={tag} /><small>{count}</small></li>)}
          </ul>
        ) : <p className={styles.muted}>还没有给笔记打标签。</p>}
      </section>
    </aside>
  );
}
