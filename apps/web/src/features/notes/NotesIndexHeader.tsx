import type { ReactNode } from 'react';
import { CreateEntryMenu } from './CreateEntryMenu';
import { IconButton, Menu, MenuItem, MenuPopover, MenuTrigger, MenuSeparator, SubmenuTrigger } from '../../components/ui';
import { PathTrail } from '../../shell/PathTrail';
import type { PathSegment } from '../../shell/path';
import { PlusIcon, MoreHorizontalIcon, SettingsIcon, CheckIcon, NoteIcon } from '../../components/icons/knowra';
import { notesIndexAppearanceProps } from './NotesIndexAppearance';
import { useNotesIndexAppearance } from './notesIndexAppearanceModel';
import styles from './NotesIndexView.module.css';

export function NotesIndexHeader({ path, count, canWrite, isRecycleView, selectionMode, onToggleSelection, onImport, onCreate, onOpenSpaces, renderTools }: {
  /** 触屏/窄屏：标题行内的工具排布（筛选、显示、更多、搜索、新建）；导入收进新建菜单。 */
  renderTools?(slots: { more: ReactNode; create: ReactNode }): ReactNode;
  path: PathSegment[]; count: number; canWrite: boolean; isRecycleView: boolean; selectionMode: boolean;
  onToggleSelection(): void; onImport(): void; onCreate(mode: 'note' | 'folder'): void; onOpenSpaces(): void;
}) {
  const theme = notesIndexAppearanceProps(useNotesIndexAppearance());
  // 容器可因桌面侧栏变窄；菜单路径始终可达，不依赖视口断点。
  const ancestors = path.filter((segment, index) => index < path.length - 1 && !segment.current && segment.onNavigate);
  const more = <MenuTrigger><IconButton size={30} aria-label="更多操作" aria-pressed={selectionMode}><MoreHorizontalIcon size={16} /></IconButton>
    <MenuPopover {...theme}><Menu ariaLabel="更多操作" onAction={key => { if (key === 'spaces') onOpenSpaces(); else if (key === 'batch') onToggleSelection(); }}>
      {ancestors.length ? <SubmenuTrigger>
        <MenuItem id="path-navigation">路径导航</MenuItem>
        <MenuPopover {...theme}><Menu ariaLabel="路径导航" onAction={key => ancestors.find(segment => segment.id === key)?.onNavigate?.()}>
          {ancestors.map(segment => <MenuItem id={segment.id} key={segment.id}>{segment.label}</MenuItem>)}
        </Menu></MenuPopover>
      </SubmenuTrigger> : null}
      {ancestors.length ? <MenuSeparator /> : null}
      <MenuItem id="spaces" icon={<SettingsIcon size={14} />}>空间管理</MenuItem>
      <MenuItem id="batch" icon={<CheckIcon size={14} />} isDisabled={!canWrite || isRecycleView}>{selectionMode ? '退出批量管理' : '批量管理'}</MenuItem>
    </Menu></MenuPopover>
  </MenuTrigger>;
  const create = <CreateEntryMenu canWrite={canWrite && !isRecycleView} onCreate={onCreate} onImport={onImport}>
    <IconButton tone="floating" aria-label="新建" title="新建" disabled={!canWrite || isRecycleView}><PlusIcon size={16} /></IconButton>
  </CreateEntryMenu>;
  return <header className={styles.header}>
    <div className={styles.heading}><NoteIcon size={17} /><strong>{path.at(-1)?.label ?? '笔记索引'}</strong><span title="当前已加载范围内的项目数，包含笔记与文件夹" aria-label={`已加载 ${count} 项`}>{count}</span></div>
    <nav className={styles.breadcrumb} aria-label="当前位置" title={path.map(segment => segment.label).join(' / ')}><PathTrail path={path} variant="top" /></nav>
    {renderTools ? renderTools({ more, create }) : <div className={styles.headerActions} aria-label="笔记操作">
      {more}
      {create}
    </div>}
  </header>;
}
