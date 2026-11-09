import { MenuItem, MenuSeparator } from '../../components/ui';
import type { EditorViewAction, EffectiveEditorViewState } from './editorViewState';

export function renderEditorViewMenu({
  view,
  onAction
}: {
  view: EffectiveEditorViewState;
  onAction(action: EditorViewAction): void;
}) {
  return (
    <>
      <ViewMenuItem active={view.mode === 'read'} action="mode-read" label="阅读模式" onAction={onAction} />
      <ViewMenuItem active={view.mode === 'edit'} action="mode-edit" label="编辑模式" onAction={onAction} />
      <ViewMenuItem active={view.mode === 'focus'} action="mode-focus" label="专注模式" onAction={onAction} />
      <MenuSeparator />
      <ViewMenuItem
        active={view.preferredShowLeftSidebar}
        action="toggle-left-sidebar"
        label={`${view.preferredShowLeftSidebar ? '隐藏' : '显示'}左侧目录区`}
        onAction={onAction}
      />
      <ViewMenuItem
        active={view.preferredShowRightSidebar}
        action="toggle-right-sidebar"
        label={`${view.preferredShowRightSidebar ? '隐藏' : '显示'}右侧辅助区`}
        onAction={onAction}
      />
      <ViewMenuItem
        active={view.showSourceEditor}
        action="toggle-source-editor"
        label={`${view.showSourceEditor ? '隐藏' : '显示'}源码编辑器`}
        onAction={onAction}
      />
    </>
  );
}

function ViewMenuItem({
  active,
  action,
  label,
  onAction
}: {
  active: boolean;
  action: EditorViewAction;
  label: string;
  onAction(action: EditorViewAction): void;
}) {
  return (
    <MenuItem id={action} aria-label={label} isActive={active} onAction={() => onAction(action)}>
      {label}
    </MenuItem>
  );
}
