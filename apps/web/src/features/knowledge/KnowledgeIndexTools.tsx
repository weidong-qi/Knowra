import { useState, type RefObject } from 'react';
import { IconButton, Menu, MenuItem, MenuPopover, MenuTrigger, Popover, PopoverDialog, PopoverTrigger, SearchBox, SegmentedButton, SegmentedControl, Switch, Tooltip, TooltipTrigger } from '../../components/ui';
import { DisplayOptionsIcon, FilterLinesIcon, MoreHorizontalIcon, PlusIcon, RefreshIcon, SearchIcon } from '../../components/icons/knowra';
import { notesIndexAppearanceProps } from '../notes/NotesIndexAppearance';
import { useNotesIndexAppearance } from '../notes/notesIndexAppearanceModel';
import { Row, moveFocus } from '../notes/NotesIndexFilterMenu';
import menuStyles from '../notes/NotesIndexMenus.module.css';
import { KNOWLEDGE_FILTER_OPTIONS, setKnowledgeDisplay, type KnowledgeDisplay, type KnowledgeGroup, type KnowledgeSort, type KnowledgeView } from './knowledgeIndexModel';
import styles from './KnowledgeIndex.module.css';

const LAYOUTS: readonly [KnowledgeView, string][] = [['list', '列表'], ['card', '卡片']];
const GROUPS: readonly [KnowledgeGroup, string][] = [['status', '状态'], ['type', '类型'], ['updated', '时间'], ['none', '不分组']];
const SORTS: readonly [KnowledgeSort, string][] = [['updated-desc', '最近'], ['updated-asc', '最早'], ['name-asc', '名称']];
const PROPERTIES: readonly [keyof KnowledgeDisplay['properties'], string][] = [['statement', '核心陈述'], ['type', '类型'], ['status', '状态'], ['updated', '更新时间']];

function Field<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly [T, string][]; onChange(value: T): void }) {
  return <div className={menuStyles.field}><span>{label}</span>
    <SegmentedControl density="compact" aria-label={label}>
      {options.map(([key, text]) => <SegmentedButton key={key} aria-pressed={value === key} onPress={() => onChange(key)}>{text}</SegmentedButton>)}
    </SegmentedControl></div>;
}

export interface KnowledgeIndexToolsProps {
  compact: boolean;
  query: string; onQueryChange(value: string): void; searchRef: RefObject<HTMLInputElement | null>;
  status: string; onStatusChange(value: string): void; counts: Record<string, number>;
  display: KnowledgeDisplay;
  canWrite: boolean; busy: boolean;
  onRefresh(): void; onCreate(): void;
}

/** 并入标题行的工具：搜索（默认收成图标）、状态筛选、显示选项、刷新、新建。 */
export function KnowledgeIndexTools(props: KnowledgeIndexToolsProps) {
  const { compact, query, display, status } = props;
  const theme = notesIndexAppearanceProps(useNotesIndexAppearance());
  const filtering = status !== 'all';
  const customized = display.sort !== 'updated-desc' || display.group !== 'status';
  const search = <div className={styles.searchSlot} onClick={() => props.searchRef.current?.focus()}>
    <SearchBox label="搜索知识" icon={<SearchIcon size={15} />} ref={props.searchRef} name="knowledge-search" autoComplete="off" value={query}
      onChange={event => props.onQueryChange(event.target.value)} placeholder="搜索标题、陈述或解释…" shortcut="/"
      onClear={query ? () => props.onQueryChange('') : undefined}
      surfaceProps={{ 'data-shadow-owner': 'search', 'data-shadow-token': '--shadow-search-rest' }} /></div>;
  // 浮层展开时卸载提示，避免提示在触发器被浮层接管后失去锚点。
  const [filterOpen, setFilterOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const filter = <PopoverTrigger isOpen={filterOpen} onOpenChange={setFilterOpen}>
    <TooltipTrigger><IconButton size={28} className={menuStyles.dotHost} data-filtering={filtering || undefined} aria-label="筛选"><FilterLinesIcon size={16} /></IconButton>{filterOpen ? null : <Tooltip>筛选</Tooltip>}</TooltipTrigger>
    <Popover placement="bottom end" offset={6} {...theme}>
      <PopoverDialog aria-label="按知识状态筛选" className={menuStyles.panel}>
        <div className={menuStyles.list} role="menu" aria-label="知识状态" onKeyDown={moveFocus}>
          {KNOWLEDGE_FILTER_OPTIONS.map(([key, label]) => <Row key={key} role="menuitemradio" checked={status === key} count={props.counts[key] ?? 0}
            onPress={() => props.onStatusChange(key)}>{label}</Row>)}
        </div>
      </PopoverDialog>
    </Popover>
  </PopoverTrigger>;
  const displayMenu = <PopoverTrigger isOpen={displayOpen} onOpenChange={setDisplayOpen}>
    <TooltipTrigger><IconButton size={28} className={menuStyles.dotHost} data-on={customized || undefined} aria-label="显示选项（布局、分组、排序、属性）"><DisplayOptionsIcon size={16} /></IconButton>{displayOpen ? null : <Tooltip>显示选项</Tooltip>}</TooltipTrigger>
    <Popover placement="bottom end" offset={6} {...theme}>
      <PopoverDialog aria-label="知识显示选项" className={menuStyles.panel}>
        <div className={menuStyles.displayBody}>
          <Field label="布局" value={display.view} options={LAYOUTS} onChange={view => setKnowledgeDisplay({ view })} />
          <Field label="分组" value={display.group} options={GROUPS} onChange={group => setKnowledgeDisplay({ group })} />
          <Field label="排序" value={display.sort} options={SORTS} onChange={sort => setKnowledgeDisplay({ sort })} />
          <hr className={menuStyles.sep} />
          <div className={menuStyles.propsHead}>显示属性</div>
          {PROPERTIES.map(([key, text]) => <Switch key={key} isSelected={display.properties[key]}
            onChange={value => setKnowledgeDisplay({ properties: { [key]: value } })}>{text}</Switch>)}
        </div>
      </PopoverDialog>
    </Popover>
  </PopoverTrigger>;
  const create = <IconButton tone="floating" aria-label="新建知识候选" title="新建知识候选"
    disabled={!props.canWrite || props.busy} onPress={props.onCreate}><PlusIcon size={16} /></IconButton>;

  if (compact) {
    return <div className={styles.compactTools} role="toolbar" aria-label="知识库工具栏">
      {search}{filter}{displayMenu}
      <MenuTrigger>
        <IconButton size={30} aria-label="更多操作"><MoreHorizontalIcon size={16} /></IconButton>
        <MenuPopover {...theme}><Menu ariaLabel="更多操作" onAction={() => props.onRefresh()}>
          <MenuItem id="refresh" icon={<RefreshIcon size={14} />} isDisabled={props.busy}>刷新</MenuItem>
        </Menu></MenuPopover>
      </MenuTrigger>
      {create}
    </div>;
  }
  return <div className={styles.desktopTools} role="toolbar" aria-label="知识库工具栏">
    {search}{filter}{displayMenu}
    <span className={styles.separator} />
    <TooltipTrigger><IconButton size={28} aria-label="刷新" isDisabled={props.busy} onPress={props.onRefresh}><RefreshIcon size={16} /></IconButton><Tooltip>刷新</Tooltip></TooltipTrigger>
    {create}
  </div>;
}
