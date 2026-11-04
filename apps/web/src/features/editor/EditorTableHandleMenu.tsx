import { useRef, useState, useEffect } from 'react';
import { Menu, MenuHeader, MenuItem, MenuSection, MenuSeparator, PointMenu } from '../../components/ui';
import type { TableAction } from './editorTableModel';
import type { TableHandleLayout } from './editorTableHandleLayout';
import styles from './EditorTableHandles.module.css';
export type TableMenuAction = TableAction | 'move-up' | 'move-down' | 'move-left' | 'move-right';
const rowItems: Array<{ action: TableAction; label: string }> = [
  { action: 'row-before', label: '在上方插入行' }, { action: 'row-after', label: '在下方插入行' }
];
const columnItems: Array<{ action: TableAction; label: string }> = [
  { action: 'column-before', label: '在左侧插入列' }, { action: 'column-after', label: '在右侧插入列' }
];
const alignItems: Array<{ action: TableAction; label: string }> = [
  { action: 'align-left', label: '左对齐' }, { action: 'align-center', label: '居中' }, { action: 'align-right', label: '右对齐' }
];

export function EditorTableHandleMenu({ menu, layout, close, runAction }: {
  menu: { kind: 'row' | 'column' | 'table'; point: { x: number; y: number }; layout: TableHandleLayout } | null;
  layout: TableHandleLayout; close(): void; runAction(action: TableMenuAction): void;
}) {
  const [boundary, setBoundary] = useState<HTMLDivElement | null>(null);
  const availableHeight = Math.max(0, layout.clip.bottom - layout.clip.top - 24);
  useEffect(() => { if (menu && availableHeight < 44) close(); }, [menu, availableHeight, close]);
  const bounds = layout.boundaryElement?.getBoundingClientRect();
  const lastMenu = useRef(menu);
  if (menu) lastMenu.current = menu;
  const content = menu ?? lastMenu.current;
  const menuLayout = content?.layout ?? layout;
  return (<><div ref={setBoundary} aria-hidden="true" style={{ position: 'fixed', pointerEvents: 'none', left: bounds?.left ?? 0,
    top: layout.clip.top, width: bounds?.width ?? window.innerWidth, height: Math.max(0, layout.clip.bottom - layout.clip.top) }} />
    <PointMenu boundaryElement={boundary ?? undefined} maxHeight={availableHeight} popoverClassName={styles.menuViewport} point={availableHeight >= 44 ? menu?.point ?? null : null} onOpenChange={open => { if (!open) close(); }}>
      <Menu ariaLabel={content?.kind === 'row' ? '行操作' : content?.kind === 'column' ? '列操作' : '表格操作'} onClose={close}>
        {content?.kind === 'row' ? <>
          <MenuSection>
            <MenuHeader>插入</MenuHeader>
            {rowItems.map(({ action, label }) => <MenuItem key={action} id={action} isDisabled={action === 'row-before' && menuLayout.row === 0} onAction={() => runAction(action)}>{label}</MenuItem>)}
          </MenuSection>
          <MenuSeparator />
          <MenuSection>
            <MenuHeader>移动</MenuHeader>
            <MenuItem id="move-up" isDisabled={menuLayout.row <= 1} onAction={() => runAction('move-up')}>上移一行</MenuItem>
            <MenuItem id="move-down" isDisabled={menuLayout.row === 0 || menuLayout.row >= menuLayout.rowCount - 1} onAction={() => runAction('move-down')}>下移一行</MenuItem>
          </MenuSection>
          <MenuSeparator />
          <MenuItem id="delete-row" isDanger isDisabled={menuLayout.row === 0 || menuLayout.rowCount <= 2} onAction={() => runAction('delete-row')}>删除行</MenuItem>
        </> : null}
        {content?.kind === 'column' ? <>
          <MenuSection>
            <MenuHeader>插入</MenuHeader>
            {columnItems.map(({ action, label }) => <MenuItem key={action} id={action} onAction={() => runAction(action)}>{label}</MenuItem>)}
          </MenuSection>
          <MenuSeparator />
          <MenuSection>
            <MenuHeader>移动</MenuHeader>
            <MenuItem id="move-left" isDisabled={menuLayout.column === 0} onAction={() => runAction('move-left')}>左移一列</MenuItem>
            <MenuItem id="move-right" isDisabled={menuLayout.column >= menuLayout.columnCount - 1} onAction={() => runAction('move-right')}>右移一列</MenuItem>
          </MenuSection>
          <MenuSeparator />
          <MenuSection>
            <MenuHeader>对齐</MenuHeader>
            {alignItems.map(({ action, label }) => <MenuItem key={action} id={action} onAction={() => runAction(action)}>{label}</MenuItem>)}
          </MenuSection>
          <MenuSeparator />
          <MenuItem id="delete-column" isDanger isDisabled={menuLayout.columnCount <= 1} onAction={() => runAction('delete-column')}>删除列</MenuItem>
        </> : null}
        {content?.kind === 'table' ? <>
          <MenuItem id="select-table" onAction={() => runAction('select-table')}>选择整个表格</MenuItem>
          <MenuSeparator />
          <MenuItem id="delete-table" isDanger onAction={() => runAction('delete-table')}>删除整个表格</MenuItem>
        </> : null}
      </Menu>
    </PointMenu></>);
}
