import type { CSSProperties, KeyboardEventHandler, MouseEventHandler, ReactNode, Ref } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/ui';
import { ChevronRightIcon, PanelIcon } from '../../components/icons/knowra';
import type { EffectiveEditorViewState } from './editorViewState';
import styles from './NoteEditorView.module.css';

interface EditorPageLayoutProps {
  view: EffectiveEditorViewState;
  inspectorOpen: boolean;
  titlebar: { enabled: boolean; host: HTMLElement | null };
  documentEdge: number | null;
  documentStageRef: Ref<HTMLDivElement>;
  paperRef: Ref<HTMLElement>;
  onKeyDownCapture: KeyboardEventHandler<HTMLElement>;
  onAttachmentLink: MouseEventHandler<HTMLDivElement>;
  onReturnToList(): void;
  onToggleInspector(): void;
  tabs: ReactNode;
  feedback: ReactNode;
  inspector: ReactNode;
  children: ReactNode;
}

// 只拥有页面布局；滚动、保存、正文和检查器状态由入口及各自的 hook 管理。
export function EditorPageLayout({
  view, inspectorOpen, titlebar, documentEdge, documentStageRef, paperRef,
  onKeyDownCapture, onAttachmentLink, onReturnToList, onToggleInspector,
  tabs, feedback, inspector, children
}: EditorPageLayoutProps) {
  return (
    <section
      className={styles.editor}
      onKeyDownCapture={onKeyDownCapture}
      data-view-mode={view.mode}
      data-content-mode={view.contentMode}
      data-inspector-open={inspectorOpen || undefined}
      data-window-tabs={Boolean(titlebar.host) || undefined}
      aria-label="笔记编辑页面骨架"
      style={documentEdge === null ? undefined : { '--doc-edge': `${documentEdge}px` } as CSSProperties}
    >
      {titlebar.host && tabs ? createPortal(tabs, titlebar.host) : tabs}
      {!titlebar.enabled ? <div className={styles.compactControls} role="group" aria-label="笔记导航与检查器">
        <Button variant="ghost" size="compact" onPress={onReturnToList}><span className={styles.backArrow}><ChevronRightIcon size={16} /></span>笔记列表</Button>
        <Button variant="ghost" size="compact" aria-label="打开文档检查器" aria-pressed={inspectorOpen} onPress={onToggleInspector}><PanelIcon size={16} />检查器</Button>
      </div> : null}
      {feedback}
      <div className={styles.workspace} data-editor-workspace>
        <div ref={documentStageRef} className={styles.documentStage} data-editor-scroll-root onClickCapture={onAttachmentLink} onAuxClickCapture={onAttachmentLink}>
          <article ref={paperRef} className={styles.paper} data-pdf-document="true" aria-labelledby="note-editor-title">
            {children}
          </article>
        </div>
      </div>
      {inspector}
    </section>
  );
}
