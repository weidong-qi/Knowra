import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { Popover, PopoverDialog, PressableButton, SegmentedButton, SegmentedControl } from '../../components/ui';
import { CalendarIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, SettingsIcon, StatusRingIcon, TagIcon } from '../../components/icons/knowra';
import { FILTER_LABELS, NOTE_STATUS_LABELS, STATUS_ORDER, normalizeNoteStatus, type FilterLevel, type UpdatedWithin } from './notesIndexFilters';
import { StatusGlyph } from './NotesIndexItemMeta';
import { normalizeTagColor } from '../tags';
import { notesIndexAppearanceProps } from './NotesIndexAppearance';
import { useNotesIndexAppearance } from './notesIndexAppearanceModel';
import type { NotesIndexController } from './useNotesIndexController';
import styles from './NotesIndexMenus.module.css';

type RowRole = 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';

/** 菜单行：键盘上下移动由列表容器统一处理。 */
export function Row({ role = 'menuitem', checked, icon, count, box, trailing, children, onPress }: {
  role?: RowRole; checked?: boolean; icon?: ReactNode; count?: ReactNode; box?: boolean; trailing?: ReactNode;
  children: ReactNode; onPress(): void;
}) {
  return <PressableButton className={styles.row} role={role} aria-checked={role === 'menuitem' ? undefined : checked} data-checked={checked || undefined} onPress={onPress}>
    {box ? <span className={styles.box} data-checked={checked || undefined} aria-hidden="true">{checked ? <CheckIcon size={11} /> : null}</span> : null}
    {icon ? <span className={styles.rowIcon} aria-hidden="true">{icon}</span> : null}
    <span className={styles.rowLabel}>{children}</span>
    {trailing}
    {count !== undefined && count !== '' ? <small className={styles.count}>{count}</small> : null}
    {!box && role !== 'menuitem' && checked ? <CheckIcon size={13} className={styles.tick} aria-hidden="true" /> : null}
  </PressableButton>;
}

export function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
  if (!rows.length) return;
  event.preventDefault();
  const index = rows.indexOf(document.activeElement as HTMLElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
    : event.key === 'ArrowDown' ? (index + 1) % rows.length : (index - 1 + rows.length) % rows.length;
  rows[next]?.focus();
}

/** 筛选菜单：根 → 状态 / 标签 / 更新时间；选择后不关闭，可连续勾选。 */
export function NotesIndexFilterMenu({ c }: { c: NotesIndexController }) {
  const theme = notesIndexAppearanceProps(useNotesIndexAppearance());
  const { filterMenu, filters, urlTagIds, tagMatch } = c;
  const level = filterMenu?.level ?? 'root';
  const setLevel = (next: FilterLevel) => c.setFilterMenu({ level: next });
  const { statusCounts, tagCounts } = useMemo(() => {
    const status: Record<string, number> = {};
    for (const item of c.data.items) if (item.kind === 'note') { const key = normalizeNoteStatus(item.note.status); status[key] = (status[key] ?? 0) + 1; }
    const tag: Record<string, number> = {};
    for (const note of c.serverData.notes) if (!note.deleted) for (const id of note.tagIds) tag[id] = (tag[id] ?? 0) + 1;
    return { statusCounts: status, tagCounts: tag };
  }, [c.data.items, c.serverData.notes]);
  const statusKeys = [...STATUS_ORDER, ...Object.keys(statusCounts).filter(key => !(STATUS_ORDER as readonly string[]).includes(key))];

  const toggleStatus = (status: string) => c.setFilters(value => ({ ...value,
    statuses: value.statuses.includes(status) ? value.statuses.filter(item => item !== status) : [...value.statuses, status] }));
  const toggleTag = (id: string) => c.changeTags(urlTagIds.includes(id) ? urlTagIds.filter(item => item !== id) : [...urlTagIds, id]);
  const back = <Row icon={<ChevronLeftIcon size={14} />} onPress={() => setLevel('root')}>返回</Row>;

  return <Popover triggerRef={c.filterAnchorRef as { current: Element | null }} isOpen={Boolean(filterMenu)} onOpenChange={open => { if (!open) c.setFilterMenu(null); }}
    placement="bottom end" offset={6} {...theme}>
    <PopoverDialog aria-label="筛选" className={styles.panel}>
      <div className={styles.list} role="menu" aria-label={level === 'root' ? '筛选维度' : level === 'status' ? '状态' : level === 'tags' ? '标签' : '更新时间'} onKeyDown={moveFocus}>
        {level === 'root' ? <>
          <Row icon={<StatusRingIcon size={14} />} count={filters.statuses.length || ''} trailing={<ChevronRightIcon size={12} className={styles.chevron} />} onPress={() => setLevel('status')}>状态</Row>
          <Row icon={<TagIcon size={14} />} count={urlTagIds.length || ''} trailing={<ChevronRightIcon size={12} className={styles.chevron} />} onPress={() => setLevel('tags')}>标签</Row>
          <Row icon={<CalendarIcon size={14} />} count={filters.updatedWithin ? 1 : ''} trailing={<ChevronRightIcon size={12} className={styles.chevron} />} onPress={() => setLevel('updated')}>更新时间</Row>
        </> : null}
        {level === 'status' ? <>
          {back}<hr className={styles.sep} />
          {statusKeys.map(status => <Row key={status} role="menuitemcheckbox" checked={filters.statuses.includes(status)}
            icon={<span className={styles.statusIcon} data-status={status}><StatusGlyph status={NOTE_STATUS_LABELS[status] ?? status} size={14} /></span>}
            count={statusCounts[status] ?? 0} onPress={() => toggleStatus(status)}>{NOTE_STATUS_LABELS[status] ?? status}</Row>)}
          <p className={styles.hint}>状态筛选仅作用于已加载笔记。</p>
        </> : null}
        {level === 'tags' ? <>
          {back}<hr className={styles.sep} />
          <div className={styles.matchRow}><span>匹配</span>
            <SegmentedControl density="compact" aria-label="多标签匹配方式">
              <SegmentedButton aria-pressed={tagMatch === 'any'} onPress={() => c.changeTags(urlTagIds, 'any')}>任一</SegmentedButton>
              <SegmentedButton aria-pressed={tagMatch === 'all'} onPress={() => c.changeTags(urlTagIds, 'all')}>全部</SegmentedButton>
            </SegmentedControl></div>
          <hr className={styles.sep} />
          <div className={styles.scroll}>
            {c.serverData.tags.length ? c.serverData.tags.map(tag => <Row key={tag.id} role="menuitemcheckbox" box checked={urlTagIds.includes(tag.id)}
              icon={<i className={styles.tagDot} data-color={normalizeTagColor(tag.color)} />} count={tagCounts[tag.id] ?? 0}
              onPress={() => toggleTag(tag.id)}>{tag.name || '未命名标签'}</Row>) : <p className={styles.hint}>暂无标签</p>}
          </div>
          <hr className={styles.sep} />
          <Row icon={<SettingsIcon size={14} />} onPress={() => { c.setFilterMenu(null); c.navigate('/materials/tags'); }}>管理标签</Row>
        </> : null}
        {level === 'updated' ? <>
          {back}<hr className={styles.sep} />
          <Row role="menuitemradio" checked={!filters.updatedWithin} onPress={() => c.setFilters(value => ({ ...value, updatedWithin: null }))}>不限</Row>
          {(Object.keys(FILTER_LABELS) as Exclude<UpdatedWithin, null>[]).map(key => <Row key={key} role="menuitemradio" checked={filters.updatedWithin === key}
            onPress={() => c.setFilters(value => ({ ...value, updatedWithin: key }))}>{FILTER_LABELS[key]}</Row>)}
          <p className={styles.hint}>时间筛选仅作用于已加载笔记。</p>
        </> : null}
      </div>
    </PopoverDialog>
  </Popover>;
}
