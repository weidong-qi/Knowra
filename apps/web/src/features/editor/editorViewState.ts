export type EditorContentMode = 'read' | 'edit';
export type EditorViewMode = EditorContentMode | 'focus';

export type EditorViewAction =
  | 'mode-read'
  | 'mode-edit'
  | 'mode-focus'
  | 'toggle-focus'
  | 'toggle-left-sidebar'
  | 'toggle-right-sidebar'
  | 'toggle-source-editor';

export interface EditorViewState {
  mode: EditorViewMode;
  modeBeforeFocus: EditorContentMode | null;
  showLeftSidebar: boolean;
  showRightSidebar: boolean;
  showSourceEditor: boolean;
}

export interface EffectiveEditorViewState extends EditorViewState {
  contentMode: EditorContentMode;
  preferredShowLeftSidebar: boolean;
  preferredShowRightSidebar: boolean;
}

export const initialEditorViewState: EditorViewState = {
  mode: 'edit',
  modeBeforeFocus: null,
  showLeftSidebar: true,
  showRightSidebar: false,
  showSourceEditor: false
};

export function getEffectiveEditorViewState(view: EditorViewState): EffectiveEditorViewState {
  const contentMode = view.mode === 'focus'
    ? view.modeBeforeFocus ?? 'edit'
    : view.mode;
  return {
    ...view,
    contentMode,
    preferredShowLeftSidebar: view.showLeftSidebar,
    preferredShowRightSidebar: view.showRightSidebar,
    showLeftSidebar: view.mode === 'focus' ? false : view.showLeftSidebar,
    showRightSidebar: view.mode === 'focus' ? false : view.showRightSidebar
  };
}

export function applyEditorViewAction(view: EditorViewState, action: EditorViewAction): EditorViewState {
  switch (action) {
    case 'mode-read':
      return { ...view, mode: 'read', modeBeforeFocus: null, showSourceEditor: false };
    case 'mode-edit':
      return { ...view, mode: 'edit', modeBeforeFocus: null, showSourceEditor: false };
    case 'mode-focus':
      return view.mode === 'focus'
        ? view
        : { ...view, mode: 'focus', modeBeforeFocus: view.mode };
    case 'toggle-focus':
      return view.mode === 'focus'
        ? { ...view, mode: view.modeBeforeFocus ?? 'edit', modeBeforeFocus: null }
        : { ...view, mode: 'focus', modeBeforeFocus: view.mode };
    case 'toggle-left-sidebar':
      return { ...view, showLeftSidebar: !view.showLeftSidebar };
    case 'toggle-right-sidebar':
      return { ...view, showRightSidebar: !view.showRightSidebar };
    case 'toggle-source-editor': {
      const opening = !view.showSourceEditor;
      if (!opening) return { ...view, showSourceEditor: false };
      if (view.mode === 'focus') {
        return {
          ...view,
          modeBeforeFocus: view.modeBeforeFocus === 'read' ? 'edit' : view.modeBeforeFocus,
          showSourceEditor: true
        };
      }
      return { ...view, mode: 'edit', modeBeforeFocus: null, showSourceEditor: true };
    }
  }
}

export function describeEditorViewAction(view: EffectiveEditorViewState, action: EditorViewAction): string {
  switch (action) {
    case 'mode-read': return '已切换到阅读模式';
    case 'mode-edit': return '已切换到编辑模式';
    case 'mode-focus': return '已进入专注模式';
    case 'toggle-focus': return view.mode === 'focus' ? '已退出专注模式' : '已进入专注模式';
    case 'toggle-left-sidebar': return view.preferredShowLeftSidebar ? '已隐藏左侧目录区' : '已显示左侧目录区';
    case 'toggle-right-sidebar': return view.preferredShowRightSidebar ? '已隐藏右侧辅助区' : '已显示右侧辅助区';
    case 'toggle-source-editor': return view.showSourceEditor ? '已隐藏源码编辑器' : '已显示源码编辑器';
  }
}
