export type EditorCommand =
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'paragraph'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'inline-code'
  | 'highlight'
  | 'internal-link'
  | 'bullet-list'
  | 'ordered-list'
  | 'task-list'
  | 'blockquote'
  | 'code-block'
  | 'math-block'
  | 'math-inline'
  | 'horizontal-rule'
  | 'table'
  | 'delete-selection'
  | 'indent'
  | 'outdent'
  | 'paragraph-above'
  | 'paragraph-below'
  | 'undo'
  | 'redo';

export type EditorEditAction =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'find'
  | 'replace'
  | 'repair-document'
  | 'select-all';

export type EditorClipboardAction = Extract<EditorEditAction, 'cut' | 'copy' | 'paste' | 'select-all'>;
export type EditorFindMode = Extract<EditorEditAction, 'find' | 'replace'>;
export type EditorFindDirection = 'next' | 'previous';

export interface EditorEditResult {
  ok: boolean;
  reason?: 'empty-selection' | 'clipboard-empty' | 'clipboard-denied' | 'unsupported' | 'context-changed';
}

export interface EditorFindResult {
  found: boolean;
  count: number;
  index: number;
  replaced?: number;
}

export interface EditorCommandTarget {
  captureNoteLinkEdit?(): import('./editorNoteLinks').NoteLinkEditSession | null;
  applyNoteLinkEdit?(session: import('./editorNoteLinks').NoteLinkEditSession, targetId: string | null, label: string): boolean;
  selectNoteLinkOccurrence?(locator: import('@study-accelerator/content-anchor').NoteLinkLocator): boolean;
  matchesMarkdownDocument?(markdown: string): boolean;
  run(command: EditorCommand): boolean;
  /** 按指定行列数（含表头行）在当前光标处插入表格。 */
  insertTable?(rows: number, columns: number): boolean;
  runEdit(action: EditorClipboardAction): Promise<EditorEditResult>;
  find(query: string, currentIndex: number, direction: EditorFindDirection): EditorFindResult;
  replaceCurrent(query: string, replacement: string, currentIndex: number): EditorFindResult;
  replaceAll(query: string, replacement: string): EditorFindResult;
  clearFind(): void;
  navigateToHeading(index: number, behavior?: ScrollBehavior): boolean;
  getAnnotationSelection(scopeType?: 'selection' | 'blocks' | 'section' | 'list', options?: { restoreSelection?: boolean }): import('./annotationPayloads').AnnotationSelection | null;
  setAnnotations(annotations: import('@study-accelerator/web-core').Annotation[], focusedId?: string | null): void;
  selectAnnotation(annotationId: string): boolean;
  /** 内联重点（正文标记）操作；只改正文，保存后由服务端派生重点行。 */
  inlineAnnotations?: {
    create(scope: import('./editorInlineAnnotations').InlineAnnotationScope, importance?: import('./editorInlineAnnotations').InlineAnnotationImportance): string;
    remove(markId: string): import('./editorInlineAnnotations').InlineAnnotationSnapshot;
    restore(snapshot: import('./editorInlineAnnotations').InlineAnnotationSnapshot): void;
    update(markId: string, patch: { kind?: string; importance?: import('./editorInlineAnnotations').InlineAnnotationImportance | null }): void;
    reanchor(markId: string, scope: import('./editorInlineAnnotations').InlineAnnotationScope): void;
    exclude(markId: string): void;
  };
  insertImage(url: string, alt: string): boolean;
  insertLink(url: string, label: string): boolean;
  setMarkdown(markdown: string): void;
  replaceMarkdown(markdown: string): boolean;
  focus(): void;
  getMarkdown(): string;
  getHtml(): string;
}

export type EditorFileAction =
  | 'new-note'
  | 'new-folder'
  | 'import-markdown'
  | 'save'
  | 'save-as'
  | 'rename'
  | 'favorite-note'
  | 'delete-note'
  | 'export-markdown'
  | 'export-pdf';
