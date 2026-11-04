import { lazy, Suspense, type ComponentProps } from 'react';
import { EditorContextMenu } from './EditorContextMenu';
import { EditorSourcePane } from './EditorSourcePane';
import type { EffectiveEditorViewState } from './editorViewState';
import styles from './NoteEditorView.module.css';

const MilkdownNoteEditor = lazy(async () => {
  const module = await import('./MilkdownNoteEditor');
  return { default: module.MilkdownNoteEditor };
});

interface EditorContentPanesProps {
  showSourceEditor: boolean;
  contentMode: EffectiveEditorViewState['contentMode'];
  contentLoaded: boolean;
  sourceProps: ComponentProps<typeof EditorSourcePane>;
  contextMenuProps: Omit<ComponentProps<typeof EditorContextMenu>, 'children'>;
  editorProps: ComponentProps<typeof MilkdownNoteEditor>;
}

// 各槽使用目标组件本身的契约，不引入第二套编辑器业务状态或命令接口。
export function EditorContentPanes({
  showSourceEditor, contentMode, contentLoaded, sourceProps, contextMenuProps, editorProps
}: EditorContentPanesProps) {
  return (
    <div className={styles.editorPanes} data-source-open={showSourceEditor || undefined}>
      {showSourceEditor ? <EditorSourcePane {...sourceProps} /> : null}
      <EditorContextMenu {...contextMenuProps}>
        <div className={styles.content} aria-label={contentMode === 'read' ? '笔记正文阅读区' : '笔记正文编辑器'}>
          {contentLoaded ? (
            <Suspense fallback={<div className={styles.emptyBody}><p>正在启动编辑器…</p></div>}>
              <MilkdownNoteEditor {...editorProps} key={editorProps.noteId} />
            </Suspense>
          ) : <div className={styles.emptyBody}><h2>正在加载正文…</h2><p>标题与标签页可以先使用，正文会在详情接口返回后启用。</p></div>}
        </div>
      </EditorContextMenu>
    </div>
  );
}
