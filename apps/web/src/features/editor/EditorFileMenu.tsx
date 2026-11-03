import { MenuItem, MenuSeparator } from '../../components/ui/overlay';
import type { EditorFileAction } from './editorCommands';
import { getEditorPageShortcutLabel } from './editorShortcuts';

export function renderEditorFileMenu({ canWrite, favorite, onAction }: {
  canWrite: boolean;
  favorite: boolean;
  onAction(action: EditorFileAction): void;
}) {
  const action = (value: EditorFileAction) => () => onAction(value);
  return (
    <>
      <MenuItem id="new-note" isDisabled={!canWrite} onAction={action('new-note')}>新建笔记</MenuItem>
      <MenuItem id="new-folder" isDisabled={!canWrite} onAction={action('new-folder')}>新建文件夹</MenuItem>
      <MenuItem id="import-markdown" isDisabled={!canWrite} onAction={action('import-markdown')}>导入 Markdown</MenuItem>
      <MenuSeparator />
      <MenuItem id="save" aria-label="保存" kbd={getEditorPageShortcutLabel('Mod+S')} isDisabled={!canWrite} onAction={action('save')}>保存</MenuItem>
      <MenuItem id="save-as" aria-label="另存为" kbd={getEditorPageShortcutLabel('Mod+Shift+S')} isDisabled={!canWrite} onAction={action('save-as')}>另存为</MenuItem>
      <MenuItem id="rename" isDisabled={!canWrite} onAction={action('rename')}>重命名</MenuItem>
      <MenuItem id="favorite-note" isDisabled={!canWrite} onAction={action('favorite-note')}>
        {favorite ? '取消收藏' : '收藏笔记'}
      </MenuItem>
      <MenuItem id="delete-note" isDanger isDisabled={!canWrite} onAction={action('delete-note')}>删除</MenuItem>
      <MenuSeparator />
      <MenuItem id="export-markdown" onAction={action('export-markdown')}>导出 Markdown</MenuItem>
      <MenuItem id="export-pdf" onAction={action('export-pdf')}>导出 PDF</MenuItem>
    </>
  );
}
