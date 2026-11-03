import { Fragment } from 'react';
import { MenuItem, MenuSeparator } from '../../components/ui/overlay';
import type { EditorCommand } from './editorCommands';
import { getEditorShortcutLabel } from './editorShortcuts';

export interface EditorParagraphMenuProps {
  onCommand(command: EditorCommand): void;
}

const blockItems: Array<{ command: EditorCommand; label: string }> = [
  { command: 'paragraph', label: '正文' },
  { command: 'heading-1', label: 'H1' },
  { command: 'heading-2', label: 'H2' },
  { command: 'heading-3', label: 'H3' },
  { command: 'heading-4', label: 'H4' }
];

const listItems: Array<{ command: EditorCommand; label: string }> = [
  { command: 'bullet-list', label: '无序列表' },
  { command: 'ordered-list', label: '有序列表' },
  { command: 'task-list', label: '任务列表' }
];

const insertItems: Array<{ command: EditorCommand; label: string }> = [
  { command: 'blockquote', label: '引用块' },
  { command: 'code-block', label: '代码块' },
  { command: 'math-block', label: '公式块' },
  { command: 'horizontal-rule', label: '分割线' },
  { command: 'table', label: '表格' }
];

export function renderEditorParagraphMenu({ onCommand }: EditorParagraphMenuProps) {
  const renderItems = (items: Array<{ command: EditorCommand; label: string }>) => items.map((item) => (
    <MenuItem
      key={item.command}
      id={item.command}
      aria-label={item.label}
      kbd={getEditorShortcutLabel(item.command)}
      onAction={() => onCommand(item.command)}
    >
      {item.label}
    </MenuItem>
  ));

  return (
    <Fragment>
      {renderItems(blockItems)}
      <MenuSeparator />
      {renderItems(listItems)}
      <MenuSeparator />
      {renderItems(insertItems)}
    </Fragment>
  );
}
