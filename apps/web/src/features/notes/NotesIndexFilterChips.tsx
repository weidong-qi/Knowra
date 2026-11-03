import type { ReactNode } from 'react';
import { PressableButton } from '../../components/ui';
import { CalendarIcon, CloseIcon, StatusRingIcon, TagIcon } from '../../components/icons/knowra';
import { FILTER_LABELS, NOTE_STATUS_LABELS, type FilterLevel } from './notesIndexFilters';
import type { NotesIndexController } from './useNotesIndexController';
import styles from './NotesIndexMenus.module.css';

function Chip({ icon, label, children, onRemove, removeLabel }: { icon: ReactNode; label: string; children: ReactNode; onRemove(): void; removeLabel: string }) {
  return <span className={styles.chip}>
    <span className={styles.chipLabel}>{icon}{label}</span>
    {children}
    <PressableButton className={styles.chipX} aria-label={removeLabel} onPress={onRemove}><CloseIcon size={11} /></PressableButton>
  </span>;
}

/** 已启用的筛选条件：“维度 · 关系 · 值 ×”，点击值回到对应维度继续调整。 */
export function NotesIndexFilterChips({ c }: { c: NotesIndexController }) {
  const { filters, urlTagIds, tagMatch } = c;
  if (!filters.statuses.length && !filters.updatedWithin && !urlTagIds.length) return null;
  const open = (level: FilterLevel) => (event: { target: EventTarget }) => c.openFilterMenu(event.target as Element, level);
  const tagNames = urlTagIds.map(id => c.serverData.tags.find(tag => tag.id === id)?.name || '未命名标签');
  const hasLocal = filters.statuses.length > 0 || Boolean(filters.updatedWithin);
  return <div className={styles.chips} role="group" aria-label="已启用的筛选">
    {filters.statuses.length ? <Chip icon={<StatusRingIcon size={12} />} label="状态" removeLabel="移除状态筛选" onRemove={() => c.setFilters(value => ({ ...value, statuses: [] }))}>
      <span className={styles.chipPart}>{filters.statuses.length > 1 ? '是任一' : '是'}</span>
      <PressableButton className={styles.chipValue} onPress={open('status')}>{filters.statuses.map(status => NOTE_STATUS_LABELS[status] ?? status).join('、')}</PressableButton>
    </Chip> : null}
    {urlTagIds.length ? <Chip icon={<TagIcon size={12} />} label="标签" removeLabel="移除标签筛选" onRemove={() => c.changeTags([])}>
      {urlTagIds.length > 1
        ? <PressableButton className={styles.chipPartButton} aria-label={`标签匹配方式：${tagMatch === 'all' ? '包含全部' : '包含任一'}，点击切换`} onPress={() => c.changeTags(urlTagIds, tagMatch === 'all' ? 'any' : 'all')}>{tagMatch === 'all' ? '包含全部' : '包含任一'}</PressableButton>
        : <span className={styles.chipPart}>包含</span>}
      <PressableButton className={styles.chipValue} onPress={open('tags')}>{tagNames.join('、')}</PressableButton>
    </Chip> : null}
    {filters.updatedWithin ? <Chip icon={<CalendarIcon size={12} />} label="更新时间" removeLabel="移除更新时间筛选" onRemove={() => c.setFilters(value => ({ ...value, updatedWithin: null }))}>
      <span className={styles.chipPart}>在</span>
      <PressableButton className={styles.chipValue} onPress={open('updated')}>{FILTER_LABELS[filters.updatedWithin]}</PressableButton>
    </Chip> : null}
    <PressableButton className={styles.clear} onPress={c.clearFilters}>清除全部</PressableButton>
    {hasLocal ? <span className={styles.note}>状态与时间仅筛选已加载笔记{c.data.remotePage?.hasNext ? '，可在底部加载更多' : ''}</span> : null}
  </div>;
}
