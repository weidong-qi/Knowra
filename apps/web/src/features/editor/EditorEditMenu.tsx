import { Fragment } from 'react';
import { MenuItem, MenuSeparator } from '../../components/ui';
import type { EditorEditAction } from './editorCommands';
import { getEditorPageShortcutLabel } from './editorShortcuts';

export interface EditorEditMenuProps {
  canWrite: boolean;
  onAction(action: EditorEditAction): void;
}

const groups: Array<Array<{ action: EditorEditAction; label: string; kbd?: string; requiresWrite?: boolean }>> = [
  [
    { action: 'undo', label: '撤销', kbd: 'Mod+Z', requiresWrite: true },
    { action: 'redo', label: '重做', kbd: 'Mod+Shift+Z', requiresWrite: true }
  ],
  [
    { action: 'cut', label: '剪切', requiresWrite: true },
    { action: 'copy', label: '复制', kbd: 'Mod+C' },
    { action: 'paste', label: '粘贴', kbd: 'Mod+V', requiresWrite: true }
  ],
  [
    { action: 'find', label: '查找', kbd: 'Mod+F' },
    { action: 'replace', label: '替换', kbd: 'Mod+H', requiresWrite: true },
    { action: 'select-all', label: '全选', kbd: 'Mod+A' }
  ],
  [
    { action: 'repair-document', label: '检查异常格式', requiresWrite: true }
  ]
];

export function renderEditorEditMenu({ canWrite, onAction }: EditorEditMenuProps) {
  return groups.map((items, groupIndex) => (
    <Fragment key={items[0].action}>
      {groupIndex > 0 ? <MenuSeparator /> : null}
      {items.map((item) => (
        <MenuItem
          key={item.action}
          id={item.action}
          aria-label={item.label}
          kbd={item.kbd ? getEditorPageShortcutLabel(item.kbd) : undefined}
          isDisabled={item.requiresWrite && !canWrite}
          onAction={() => onAction(item.action)}
        >
          {item.label}
        </MenuItem>
      ))}
    </Fragment>
  ));
}
