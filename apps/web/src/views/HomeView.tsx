// V5 首页：以“继续编辑”为主线，旁边是真实数据的活动面板，底部是三个工作域入口。
// 所有数字、时间、标签均来自工作区数据；训练域尚未上线时保持锁定。

import { useMemo, type ReactNode } from 'react';
import { PressableButton } from '../components/ui/button/PressableButton';
import type { Note, Folder, Tag } from '@study-accelerator/web-core';
import { Button } from '../components/ui/button/Button';
import { EmptyState, LoadingState } from '../components/ui/status';
import { cx } from '../components/ui/classnames';
import { MathText } from '../components/math/MathText';
import {
  ArrowUpRightIcon,
  ClockIcon,
  FolderIcon,
  NodesIcon,
  NoteIcon,
  RefreshIcon,
  TargetIcon,
  type KnowraIconProps
} from '../components/icons/knowra';
import styles from './HomeView.module.css';
import { FeaturedNote, ActivityPanel } from './HomeActivity';
import { HomeHeader } from './HomeHeader';
import { computeStats, greetingFor, formatToday, formatRecentTime, statusLabel, summaryLine } from './homeViewModel';

interface DomainCardEntry {
  id: 'materials' | 'knowledge' | 'training';
  label: string;
  description: string;
  Icon: (props: KnowraIconProps) => ReactNode;
  available: boolean;
}

const DOMAIN_CARDS: readonly DomainCardEntry[] = [
  { id: 'materials', label: '笔记工作台', description: 'Markdown 笔记的采集、编辑与整理。', Icon: FolderIcon, available: true },
  { id: 'knowledge', label: '知识工作台', description: '整理知识候选、人工确认与来源追溯。', Icon: NodesIcon, available: true },
  { id: 'training', label: '训练工作台', description: '题目库与考试场景。后端联调未完成。', Icon: TargetIcon, available: false }
] as const;

export interface HomeViewProps {
  loadState: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  dataMode: 'loading' | 'api' | 'cache' | 'local';
  notes: Note[];
  folders: Folder[];
  tags: Tag[];
  isWritable: boolean;
  onRetry(): void;
  onOpenMaterials?(): void;
  onOpenKnowledge?(): void;
  onOpenSearch?(): void;
  onOpenCreate?(): void;
  onOpenSchedule?(): void;
  onSelectNote?(noteId: string, title: string): void;
}

export function HomeView({
  loadState,
  error,
  dataMode,
  notes,
  folders,
  tags,
  isWritable,
  onRetry,
  onOpenMaterials,
  onOpenKnowledge,
  onOpenSearch,
  onOpenCreate,
  onOpenSchedule,
  onSelectNote
}: HomeViewProps) {
  const stats = useMemo(() => computeStats(notes, folders, tags), [notes, folders, tags]);
  const greeting = useMemo(() => greetingFor(new Date()), []);
  const today = useMemo(() => formatToday(), []);

  if (loadState === 'loading' && notes.length === 0 && dataMode !== 'cache') {
    return (
      <div className={styles.view}>
        <HomeHeader id="home-title-loading" today={today} title={greeting} subtitle="正在连接资料服务，加载目录与笔记…"
          onOpenCreate={onOpenCreate} onOpenSchedule={onOpenSchedule} onOpenSearch={onOpenSearch} />
        <LoadingState label="正在加载资料…" />
      </div>
    );
  }

  if (loadState === 'error' && notes.length === 0) {
    return (
      <div className={styles.view}>
        <HomeHeader id="home-title-error" today={today} title={greeting} subtitle="资料服务暂时不可用，请稍后重试。"
          onOpenCreate={onOpenCreate} onOpenSchedule={onOpenSchedule} onOpenSearch={onOpenSearch} />
        <EmptyState
          title="资料加载失败"
          description={error ?? '请检查 API 端口或稍后重试。'}
          primaryAction={<Button variant="primary" onClick={onRetry}><RefreshIcon size={14} /><span>重试</span></Button>}
          secondaryAction={onOpenSearch ? <Button onClick={onOpenSearch}>本地搜索</Button> : undefined}
        />
      </div>
    );
  }

  const [featured, ...others] = stats.recentNotes;
  const upNext = others.slice(0, 5);

  return (
    <div className={styles.view}>
      <HomeHeader
        id="home-title"
        today={today}
        title={greeting}
        subtitle={loadState === 'error' ? '当前显示最近一次本地缓存。连接恢复后可继续编辑。' : summaryLine(stats)}
        onOpenCreate={onOpenCreate}
        onOpenSchedule={onOpenSchedule}
        onOpenSearch={onOpenSearch}
      />

      {loadState === 'error' ? (
        <div className={styles.errorBanner} role="alert">
          <span className={styles.errorDot} aria-hidden="true" />
          <span>{error ?? '资料服务暂时不可用。'}</span>
          <Button variant="ghost" onClick={onRetry}><RefreshIcon size={14} /><span>重试</span></Button>
        </div>
      ) : null}

      <div className={styles.main}>
        <section className={styles.recent} aria-labelledby="home-recent-title">
          <div className={styles.sectionHead}>
            <h2 id="home-recent-title" className={styles.sectionTitle}><ClockIcon size={16} aria-hidden="true" />最近编辑</h2>
            <Button className={styles.viewAllButton} variant="ghost" size="compact" onClick={onOpenMaterials} isDisabled={!onOpenMaterials}>查看全部</Button>
          </div>

          {!featured ? (
            <div className={styles.recentEmpty}>
              <EmptyState
                title="还没有资料"
                description={isWritable ? '创建第一篇笔记，开始整理资料与知识。' : '当前为只读模式：连接资料服务后可继续操作。'}
                primaryAction={onOpenCreate ? <Button variant="primary" onClick={onOpenCreate}>新建笔记</Button> : undefined}
                secondaryAction={onOpenSearch ? <Button onClick={onOpenSearch}>打开全局搜索</Button> : undefined}
              />
            </div>
          ) : (
            <>
              <FeaturedNote note={featured} tags={tags} onOpen={onSelectNote} />
              {upNext.length ? (
                <ul className={styles.upNext} aria-label="更多最近编辑">
                  {upNext.map(note => {
                    const title = note.title || '无标题';
                    return (
                      <li key={note.id}>
                        <PressableButton type="button" className={styles.upNextRow} onPress={onSelectNote ? () => onSelectNote(note.id, title) : undefined} isDisabled={!onSelectNote}>
                          <span className={styles.upNextIcon} aria-hidden="true"><NoteIcon size={14} /></span>
                          <span className={styles.upNextTitle}><MathText text={title} inlineOnly /></span>
                          <span className={styles.upNextStatus}>{statusLabel(note)}</span>
                          <time className={styles.upNextTime} dateTime={note.updatedAt ?? note.createdAt ?? ''}>{formatRecentTime(note.updatedAt ?? note.createdAt)}</time>
                          <ArrowUpRightIcon size={14} className={styles.upNextArrow} aria-hidden="true" />
                        </PressableButton>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </>
          )}
        </section>

        <ActivityPanel stats={stats} notes={notes} tags={tags} />
      </div>

      <section className={styles.workbenches} aria-label="工作域">
        <div className={styles.workbenchGrid}>
          {DOMAIN_CARDS.map(entry => (
            <WorkbenchCard
              key={entry.id}
              entry={entry}
              activeNoteCount={stats.activeNotes}
              onActivate={entry.id === 'knowledge' ? onOpenKnowledge : entry.available ? onOpenMaterials : undefined}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

interface WorkbenchCardProps {
  entry: DomainCardEntry;
  activeNoteCount: number;
  onActivate?: () => void;
}

function WorkbenchCard({ entry, activeNoteCount, onActivate }: WorkbenchCardProps) {
  const Icon = entry.Icon;
  const locked = !entry.available;
  return (
    <PressableButton
      type="button"
      className={cx(styles.workbench, entry.available ? styles.workbenchActive : styles.workbenchLocked)}
      onPress={entry.available ? onActivate : undefined}
      aria-label={entry.available ? entry.label : `${entry.label}（尚未上线）`}
      isDisabled={locked}
    >
      <span className={styles.workbenchIcon} aria-hidden="true"><Icon size={20} /></span>
      <span className={styles.workbenchCopy}>
        <span className={styles.workbenchTitleRow}>
          <h2 className={styles.workbenchTitle}>{entry.label}</h2>
          {locked ? <span className={styles.lockedBadge}>即将开放</span> : null}
        </span>
        <span className={styles.workbenchDescription}>{entry.description}</span>
      </span>
      <span className={styles.workbenchStatus}>
        <span className={cx(styles.statusDot, entry.available ? styles.statusDotActive : styles.statusDotLocked)} aria-hidden="true" />
        {entry.available ? (entry.id === 'materials' ? `${activeNoteCount} 篇笔记` : '知识整理') : '待联调'}
      </span>
      {entry.available ? <ArrowUpRightIcon size={16} className={styles.workbenchArrow} aria-hidden="true" /> : null}
    </PressableButton>
  );
}
