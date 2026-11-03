import { IconButton, Popover, PopoverDialog, PopoverTrigger, SegmentedButton, SegmentedControl, Switch } from '../../components/ui';
import { DisplayOptionsIcon } from '../../components/icons/knowra';
import type { GroupMode, IndexDisplayProperties, SortMode, ViewMode } from './notesIndexPresentation';
import { notesIndexAppearanceProps } from './NotesIndexAppearance';
import { useNotesIndexAppearance } from './notesIndexAppearanceModel';
import type { NotesIndexController } from './useNotesIndexController';
import styles from './NotesIndexMenus.module.css';

type TypeFilter = NotesIndexController['typeFilter'];
const TYPES: readonly [TypeFilter, string][] = [['all', '全部'], ['folder', '文件夹'], ['note', '笔记']];
const LAYOUTS: readonly [ViewMode, string][] = [['list', '列表'], ['grid', '图标'], ['card', '卡片']];
const ICON_SIZES: readonly ['s' | 'm' | 'l', string][] = [['s', '小'], ['m', '中'], ['l', '大']];
const GROUPS: readonly [GroupMode, string][] = [['updated', '时间'], ['folder', '文件夹'], ['status', '状态'], ['none', '不分组']];
const SORTS: readonly [SortMode, string, readonly SortMode[]][] = [['updated-desc', '最近', ['updated-desc']], ['updated-asc', '最早', ['updated-asc']], ['name-asc', '名称', ['name-asc', 'name-desc']]];
const NAME_ARROW: Partial<Record<SortMode, string>> = { 'name-asc': ' ↑', 'name-desc': ' ↓' };
const PROPERTIES: readonly [keyof IndexDisplayProperties, string][] = [['summary', '摘要'], ['tags', '标签'], ['status', '状态'], ['location', '位置'], ['updated', '更新时间']];

function Field<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly [T, string][]; onChange(value: T): void }) {
  return <div className={styles.field}><span>{label}</span>
    <SegmentedControl density="compact" aria-label={label}>
      {options.map(([key, text]) => <SegmentedButton key={key} aria-pressed={value === key} onPress={() => onChange(key)}>{text}</SegmentedButton>)}
    </SegmentedControl></div>;
}

/** 显示选项：布局、图标大小、分组、排序与属性开关合并在一个浮层里；偏离默认分组/排序时按钮亮点。 */
export function NotesIndexDisplayMenu({ c, showType = false, showPreview = false }: { c: NotesIndexController; showType?: boolean; showPreview?: boolean }) {
  const theme = notesIndexAppearanceProps(useNotesIndexAppearance());
  const customized = c.sort !== 'updated-desc' || c.group !== 'updated';
  return <PopoverTrigger>
    <span className={styles.tipHost} data-tip="显示选项"><IconButton size={28} className={styles.dotHost} data-on={customized || undefined}
      aria-label="显示选项（布局、分组、排序、属性）"><DisplayOptionsIcon size={16} /></IconButton></span>
    <Popover placement="bottom end" offset={6} {...theme}>
      <PopoverDialog aria-label="索引显示选项" className={styles.panel}>
        <div className={styles.displayBody}>
          {showType ? <Field label="类型" value={c.typeFilter} options={TYPES.map(([key, text]) => [key, `${text} ${c.data.counts[key]}`] as [TypeFilter, string])} onChange={value => c.setTypeFilter(value)} /> : null}
          <Field label="布局" value={c.view} options={LAYOUTS} onChange={value => c.setView(value)} />
          {c.view === 'grid' ? <Field label="图标大小" value={c.iconSize} options={ICON_SIZES} onChange={value => c.setIconSize(value)} /> : null}
          <Field label="分组" value={c.group} options={GROUPS} onChange={value => { c.setGroup(value); c.setCollapsed(new Set()); }} />
          <Field label="排序" value={SORTS.find(([, , modes]) => modes.includes(c.sort))?.[0] ?? 'updated-desc'} options={SORTS.map(([key, text]) => [key, key === 'name-asc' ? `${text}${NAME_ARROW[c.sort] ?? ''}` : text] as [SortMode, string])}
            onChange={value => c.setSort(value === 'name-asc' && c.sort === 'name-asc' ? 'name-desc' : value)} />
          {showPreview ? <Switch isSelected={c.peekOpen} onChange={c.setPeekOpen}>预览栏</Switch> : null}
          <hr className={styles.sep} />
          <div className={styles.propsHead}>显示属性</div>
          {PROPERTIES.map(([key, text]) => <Switch key={key} isSelected={c.properties[key]}
            onChange={value => c.setProperties(current => ({ ...current, [key]: value }))}>{text}</Switch>)}
        </div>
      </PopoverDialog>
    </Popover>
  </PopoverTrigger>;
}
