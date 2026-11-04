import { MenuItem, MenuSeparator } from '../../components/ui/overlay';
import type { EditorCommand } from './editorCommands';
import { getEditorPageShortcutLabel, getEditorShortcutLabel } from './editorShortcuts';

export function renderEditorFormatMenu({ onCommand, onInsertImage, canInsertImage = true }: {
  onCommand(command: EditorCommand): void;
  onInsertImage(): void;
  canInsertImage?: boolean;
}) {
  const command = (value: EditorCommand) => () => onCommand(value);
  return (
    <>
      <MenuItem id="image" aria-label="图片" kbd={getEditorPageShortcutLabel('Mod+Ctrl+I')} isDisabled={!canInsertImage} onAction={onInsertImage}>图片</MenuItem>
      <MenuItem id="internal-link" aria-label="内部链接" kbd={getEditorShortcutLabel('internal-link')} onAction={command('internal-link')}>内部链接</MenuItem>
      <MenuSeparator />
      <MenuItem id="bold" kbd={getEditorShortcutLabel('bold')} onAction={command('bold')}>加粗</MenuItem>
      <MenuItem id="italic" aria-label="斜体" kbd={getEditorShortcutLabel('italic')} onAction={command('italic')}>斜体</MenuItem>
      <MenuItem id="strikethrough" aria-label="删除线" kbd={getEditorShortcutLabel('strikethrough')} onAction={command('strikethrough')}>删除线</MenuItem>
      <MenuItem id="inline-code" kbd={getEditorShortcutLabel('inline-code')} onAction={command('inline-code')}>行内代码</MenuItem>
      <MenuItem id="highlight" kbd={getEditorShortcutLabel('highlight')} onAction={command('highlight')}>高亮</MenuItem>
      <MenuItem id="math-inline" onAction={command('math-inline')}>行内公式</MenuItem>
    </>
  );
}
