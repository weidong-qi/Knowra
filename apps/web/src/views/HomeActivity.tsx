// 首页小组件的内容部分：最近编辑、统计数字、热力图、状态分布、常用标签。
// 外壳（标题行、卡片外观）由 HomeWidget 提供，这里只负责各自的 body。

import { useMemo } from 'react';
import type { Note, Tag } from '@study-accelerator/web-core';
import { PressableButton } from '../components/ui/button/PressableButton';
import { MathText } from '../components/math/MathText';
import { NotesIndexArt } from '../features/notes/NotesIndexArt';
import { buildNoteUpdateDistribution } from '../features/notes/notesIndexUpdateDistribution';
import { TagChip } from '../features/tags';
import { formatRecentTime, statusLabel, type HomeStats } from './homeViewModel';
import styles from './HomeView.module.css';

type OpenNote = (noteId: string, title: string) => void;

/** 最近编辑：横排卡片，缩略图在上；第一张是「继续上次编辑」。 */
export function RecentCards({ notes, tags, onOpen }: { notes: Note[]; tags: Tag[]; onOpen?: OpenNote }) {
  if (!notes.length) return null;
  return (
    <ul className={styles.cards} aria-label="最近编辑">
      {notes.map((note, index) => {
        const title = note.title || '无标题';
        const noteTags = note.tagIds
          .map(id => tags.find(tag => tag.id === id))
          .filter((tag): tag is Tag => Boolean(tag));
        return (
          <li key={note.id}>
            <PressableButton
              type="button"
              className={styles.card}
              data-lead={index === 0 || undefined}
              onPress={onOpen ? () => onOpen(note.id, title) : undefined}
              isDisabled={!onOpen}
              aria-label={index === 0 ? `继续编辑 ${title}` : undefined}
            >
              <span className={styles.cardArt}>
                <NotesIndexArt item={{ kind: 'note', note }} tags={noteTags} />
              </span>
              <span className={styles.cardBody}>
                <span className={styles.cardEyebrow}>
                  {index === 0 ? '继续上次编辑' : statusLabel(note)}
                  {' · '}
                  <time dateTime={note.updatedAt ?? note.createdAt ?? ''}>
                    {formatRecentTime(note.updatedAt ?? note.createdAt)}
                  </time>
                </span>
                <span className={styles.cardTitle}>
                  <MathText text={title} inlineOnly />
                </span>
              </span>
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
