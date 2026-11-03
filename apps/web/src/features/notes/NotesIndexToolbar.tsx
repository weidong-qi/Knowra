import { useRef, type ReactNode } from 'react';
import { IconButton, SearchBox, SegmentedButton, SegmentedControl } from '../../components/ui';
import { ComponentLibraryIcon, ListIcon, SearchIcon, FilterLinesIcon, PanelIcon } from '../../components/icons/knowra';
import { NotesIndexDisplayMenu } from './NotesIndexDisplayMenu';
import type { NotesIndexController } from './useNotesIndexController';
import styles from './NotesIndexView.module.css';
import menuStyles from './NotesIndexMenus.module.css';

function IndexSearch({ c }: { c: NotesIndexController }) {
  return <div className={styles.searchSlot} onClick={() => c.searchRef.current?.focus()}><SearchBox label="搜索笔记索引" icon={<SearchIcon size={15} />} ref={c.searchRef}
    name="notes-index-search" autoComplete="off" value={c.notesIndex.query}
    onChange={event => c.store.setNotesQuery(event.target.value)} placeholder="在当前索引中搜索…" shortcut="/"
    onClear={c.notesIndex.query ? () => c.store.setNotesQuery('') : undefined}
    surfaceProps={{ 'data-shadow-owner': 'search', 'data-shadow-token': '--shadow-search-rest' }} /></div>;
}

function IndexFilterButton({ c }: { c: NotesIndexController }) {
  const filterButton = useRef<HTMLButtonElement>(null);
  return <span className={menuStyles.tipHost} data-tip="筛选"><IconButton size={28} ref={filterButton} className={menuStyles.dotHost} aria-label="筛选" aria-haspopup="menu"
    data-filtering={c.filters.statuses.length > 0 || Boolean(c.filters.updatedWithin) || c.urlTagIds.length > 0 || undefined}
    aria-expanded={Boolean(c.filterMenu)} onPress={() => c.openFilterMenu(filterButton.current)}><FilterLinesIcon size={16} /></IconButton></span>;
}

/** 触屏/窄屏：搜索（默认收成图标）、筛选、显示选项并入标题行；类型筛选收进显示选项。 */
export function NotesIndexCompactTools({ c, more, create }: { c: NotesIndexController; more: ReactNode; create: ReactNode }) {
  return <div className={styles.compactTools} role="toolbar" aria-label="笔记索引工具栏">
    <IndexFilterButton c={c} /><NotesIndexDisplayMenu c={c} showType showPreview /><IndexSearch c={c} />{more}{create}
  </div>;
}

/** 桌面：工具并入标题行；搜索默认收成无底图标，聚焦或有关键词时展开；类型筛选收进显示选项。 */
export function NotesIndexDesktopTools({ c, more, create }: { c: NotesIndexController; more: ReactNode; create: ReactNode }) {
  return <div className={styles.desktopTools} role="toolbar" aria-label="笔记索引工具栏">
    <IndexSearch c={c} />
    <IndexFilterButton c={c} />
    <NotesIndexDisplayMenu c={c} showType />
    <span className={styles.separator} />
    <IconButton size={28} aria-label="预览栏" aria-pressed={c.peekOpen}
      onPress={() => c.setPeekOpen(value => !value)}><PanelIcon size={16} /></IconButton>
    <SegmentedControl density="compact" aria-label="视图切换">
      <SegmentedButton iconOnly aria-label="列表视图" aria-pressed={c.view === 'list'} onPress={() => c.setView('list')}><ListIcon size={15} /></SegmentedButton>
      <SegmentedButton iconOnly aria-label="图标视图" aria-pressed={c.view === 'grid'} onPress={() => c.setView('grid')}><ComponentLibraryIcon size={15} /></SegmentedButton>
      <SegmentedButton iconOnly aria-label="卡片视图" aria-pressed={c.view === 'card'} onPress={() => c.setView('card')}><CardViewIcon /></SegmentedButton>
    </SegmentedControl>
    {more}{create}
  </div>;
}
function CardViewIcon() {
  return <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="1.8" y="2.2" width="6" height="13" rx="1.8" /><rect x="10.2" y="2.2" width="6" height="13" rx="1.8" /><path d="M2 8h5.5M10.5 8h5.5" /></svg>;
}
