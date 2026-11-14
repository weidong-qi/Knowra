import { useRef, useState } from 'react';
import {
  IconButton,
  Menu,
  MenuItem,
  MenuPopover,
  MenuTrigger,
  Popover,
  PopoverDialog,
  PopoverTrigger,
  SearchBox,
  Switch
} from '../../../components/ui';
import {
  DisplayOptionsIcon,
  FilterLinesIcon,
  MoreHorizontalIcon,
  PanelIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon
} from '../../../components/icons/knowra';
import { LibraryDisplayField } from '../../../components/workspace/LibraryDisplayField';
import { Row, moveFocus } from '../../notes/NotesIndexFilterMenu';
import { CONCEPT_SCOPES } from '../library/knowledgeLibraryRoute';
import { setConceptDisplay, type ConceptDisplay } from './conceptIndexModel';
import indexStyles from '../KnowledgeIndex.module.css';
import menuStyles from '../../notes/NotesIndexMenus.module.css';
export function ConceptIndexTools({
  query,
  onQueryChange,
  scope,
  onScopeChange,
  display,
  counts,
  canWrite,
  busy,
  inspectorOpen,
  onToggleInspector,
  onRefresh,
  onCreate
}: {
  query: string;
  onQueryChange(value: string): void;
  scope: string;
  onScopeChange(value: string): void;
  display: ConceptDisplay;
  counts: Record<string, number>;
  canWrite: boolean;
  busy: boolean;
  inspectorOpen: boolean;
  onToggleInspector(): void;
  onRefresh(): void;
  onCreate(): void;
}) {
  const search = useRef<HTMLInputElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  return (
    <div className={indexStyles.desktopTools} role="toolbar" aria-label="概念工具栏">
      <div className={indexStyles.searchSlot} onClick={() => search.current?.focus()}>
        <SearchBox
          label="搜索概念"
          ref={search}
          icon={<SearchIcon size={15} />}
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder="名称、别名或区分标签"
          shortcut="/"
          onClear={query ? () => onQueryChange('') : undefined}
        />
      </div>
      <PopoverTrigger isOpen={filterOpen} onOpenChange={setFilterOpen}>
        <IconButton size={28} aria-label="筛选概念" title="筛选概念" aria-pressed={scope !== 'all'}>
          <FilterLinesIcon size={16} />
        </IconButton>
        <Popover placement="bottom end">
          <PopoverDialog aria-label="概念筛选" className={menuStyles.panel}>
            <div role="menu" aria-label="概念范围" className={menuStyles.list} onKeyDown={moveFocus}>
              {CONCEPT_SCOPES.map(([key, text]) => (
                <Row
                  key={key}
                  role="menuitemradio"
                  checked={scope === key}
                  count={counts[key]}
                  onPress={() => {
                    onScopeChange(key);
                    setFilterOpen(false);
                  }}
                >
                  {text}
                </Row>
              ))}
            </div>
          </PopoverDialog>
        </Popover>
      </PopoverTrigger>
      <PopoverTrigger isOpen={displayOpen} onOpenChange={setDisplayOpen}>
        <IconButton size={28} aria-label="概念显示选项" title="显示选项">
          <DisplayOptionsIcon size={16} />
        </IconButton>
        <Popover placement="bottom end">
          <PopoverDialog aria-label="概念显示选项" className={menuStyles.panel}>
            <div className={menuStyles.displayBody}>
              <LibraryDisplayField
                label="布局"
                value={display.view}
                options={[
                  ['list', '列表'],
                  ['card', '卡片']
                ]}
                onChange={view => setConceptDisplay({ view })}
              />
              <LibraryDisplayField
                label="排序"
                value={display.sort}
                options={[
                  ['updated-desc', '最近'],
                  ['updated-asc', '最早'],
                  ['name-asc', '名称']
                ]}
                onChange={sort => setConceptDisplay({ sort })}
              />
              <hr className={menuStyles.sep} />
              <div className={menuStyles.propsHead}>显示属性</div>
              {(
                [
                  ['sense', '区分标签'],
                  ['counts', '挂靠数量'],
                  ['status', '状态'],
                  ['updated', '更新时间']
                ] as const
              ).map(([key, text]) => (
                <Switch
                  key={key}
                  isSelected={display.properties[key]}
                  onChange={value => setConceptDisplay({ properties: { [key]: value } })}
                >
                  {text}
                </Switch>
              ))}
            </div>
          </PopoverDialog>
        </Popover>
      </PopoverTrigger>
      <IconButton
        size={28}
        aria-label="概念详情栏"
        title="详情栏"
        aria-pressed={inspectorOpen}
        onPress={onToggleInspector}
      >
        <PanelIcon size={16} />
      </IconButton>
      <MenuTrigger>
        <IconButton size={28} aria-label="概念列表更多操作" title="更多操作">
          <MoreHorizontalIcon size={16} />
        </IconButton>
        <MenuPopover>
          <Menu ariaLabel="概念列表操作" onAction={() => onRefresh()}>
            <MenuItem id="refresh" icon={<RefreshIcon size={14} />} isDisabled={busy}>
              刷新概念
            </MenuItem>
          </Menu>
        </MenuPopover>
      </MenuTrigger>
      <IconButton
        tone="floating"
        aria-label="新建概念"
        title="新建概念"
        isDisabled={!canWrite || busy}
        onPress={onCreate}
      >
        <PlusIcon size={16} />
      </IconButton>
    </div>
  );
}
