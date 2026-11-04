// 首页小组件的内容部分：最近编辑、统计数字、热力图、状态分布、常用标签。
// 外壳（标题行、卡片外观）由 HomeWidget 提供，这里只负责各自的 body。

import { useMemo } from 'react';
import type { Note, Tag } from '@study-accelerator/web-core';
import { PressableButton } from '../components/ui/button/PressableButton';
import { MathText } from '../components/math/MathText';
import { ArrowUpRightIcon, NoteIcon } from '../components/icons/knowra';
import { NotesIndexArt } from '../features/notes/NotesIndexArt';
import { notePreview } from '../features/notes/NotesIndexItemMeta';
import { normalizeNoteStatus } from '../features/notes/notesIndexFilters';
import { buildNoteUpdateDistribution } from '../features/notes/notesIndexUpdateDistribution';
import { TagChip } from '../features/tags';
import { formatRecentTime, statusLabel, type HomeStats } from './homeViewModel';
import styles from './HomeView.module.css';

type OpenNote = (noteId: string, title: string) => void;

/** 最近编辑：首行带缩略图与摘要，其余为紧凑行，行间用发丝线分隔。 */
export function RecentNotes({ notes, tags, onOpen }: { notes: Note[]; tags: Tag[]; onOpen?: OpenNote }) {
  const [lead, ...rest] = notes;
  if (!lead) return null;
  const leadTitle = lead.title || '无标题';
  const leadTags = lead.tagIds.map(id => tags.find(tag => tag.id === id)).filter((tag): tag is Tag => Boolean(tag));
  const preview = notePreview(lead);
  return (
    <ul className={styles.recentList} aria-label="最近编辑">
      <li>
        <PressableButton
          type="button"
          className={styles.leadRow}
          onPress={onOpen ? () => onOpen(lead.id, leadTitle) : undefined}
          isDisabled={!onOpen}
          aria-label={`继续编辑 ${leadTitle}`}
        >
          <span className={styles.leadArt}>
            <NotesIndexArt item={{ kind: 'note', note: lead }} tags={leadTags} />
          </span>
          <span className={styles.leadBody}>
            <span className={styles.eyebrow}>
              继续上次编辑 ·{' '}
              <time dateTime={lead.updatedAt ?? lead.createdAt ?? ''}>
                {formatRecentTime(lead.updatedAt ?? lead.createdAt)}
              </time>
            </span>
            <span className={styles.leadTitle}>
              <MathText text={leadTitle} inlineOnly />
            </span>
            {preview ? (
              <span className={styles.leadSummary}>
                <MathText text={preview} inlineOnly />
              </span>
            ) : (
              <span className={styles.leadSummaryEmpty}>这篇笔记还没有内容。</span>
            )}
            <span className={styles.leadMeta}>
              <span className={styles.statusPill} data-status={normalizeNoteStatus(lead.status)}>
                {statusLabel(lead)}
              </span>
              {leadTags.slice(0, 3).map(tag => (
                <TagChip key={tag.id} tag={tag} />
              ))}
            </span>
          </span>
          <ArrowUpRightIcon size={14} className={styles.upNextArrow} aria-hidden="true" />
        </PressableButton>
      </li>
      {rest.map(note => {
        const title = note.title || '无标题';
        return (
          <li key={note.id}>
            <PressableButton
              type="button"
              className={styles.upNextRow}
              onPress={onOpen ? () => onOpen(note.id, title) : undefined}
              isDisabled={!onOpen}
            >
              <span className={styles.upNextIcon} aria-hidden="true">
                <NoteIcon size={14} />
              </span>
              <span className={styles.upNextTitle}>
                <MathText text={title} inlineOnly />
              </span>
              <span className={styles.upNextStatus}>{statusLabel(note)}</span>
              <time className={styles.upNextTime} dateTime={note.updatedAt ?? note.createdAt ?? ''}>
                {formatRecentTime(note.updatedAt ?? note.createdAt)}
              </time>
              <ArrowUpRightIcon size={14} className={styles.upNextArrow} aria-hidden="true" />
            </PressableButton>
          </li>
        );
      })}
    </ul>
  );
}

export function StatsTiles({ stats, tags }: { stats: HomeStats; tags: Tag[] }) {
  return (
    <dl className={styles.tiles}>
      <div>
        <dt>笔记</dt>
        <dd>{stats.activeNotes}</dd>
      </div>
      <div>
        <dt>文件夹</dt>
        <dd>{stats.folderCount}</dd>
      </div>
      <div>
        <dt>标签</dt>
        <dd>{tags.length}</dd>
      </div>
      <div>
        <dt>收藏</dt>
        <dd>{stats.favoriteCount}</dd>
      </div>
    </dl>
  );
}

export function HeatmapBlock({ notes }: { notes: Note[] }) {
  const { days, total } = useMemo(() => buildNoteUpdateDistribution(notes), [notes]);
  return (
    <div className={styles.blockBody}>
      <div className={styles.blockMeta}>{total} 篇有更新</div>
      <div className={styles.heat} role="img" aria-label={`已加载笔记中，${total} 篇的最近更新时间在近 12 周内`}>
        {days.map(day => (
          <span
            key={day.date}
            data-level={day.level}
            data-today={day.today || undefined}
            data-future={day.future || undefined}
            title={`${day.date}：${day.count} 篇`}
          />
        ))}
      </div>
    </div>
  );
}

export function StatusBlock({ stats }: { stats: HomeStats }) {
  const statusTotal = stats.statusSegments.reduce((sum, segment) => sum + segment.count, 0);
  if (!statusTotal) return <p className={styles.muted}>暂无笔记。</p>;
  return (
    <div className={styles.blockBody}>
      <div
        className={styles.statusBar}
        role="img"
        aria-label={stats.statusSegments.map(item => `${item.label} ${item.count}`).join('，')}
      >
        {stats.statusSegments.map(item => (
          <i key={item.key} data-status={item.key} style={{ flexGrow: item.count }} />
        ))}
      </div>
      <ul className={styles.statusLegend}>
        {stats.statusSegments.map(item => (
          <li key={item.key}>
            <i data-status={item.key} aria-hidden="true" />
            {item.label}
            <b>{item.count}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TagsBlock({ stats }: { stats: HomeStats }) {
  if (!stats.topTags.length) return <p className={styles.muted}>还没有给笔记打标签。</p>;
  return (
    <ul className={styles.topTags}>
      {stats.topTags.map(({ tag, count }) => (
        <li key={tag.id}>
          <TagChip tag={tag} />
          <small>{count}</small>
        </li>
      ))}
    </ul>
  );
}
