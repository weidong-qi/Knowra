import { forwardRef, useState, useCallback, useEffect, useLayoutEffect, useImperativeHandle, useRef, type KeyboardEvent } from 'react';
import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  parserCtx,
  rootCtx
} from '@milkdown/kit/core';
import {
  history,
  historyProviderConfig,
  redoCommand,
  undoCommand
} from '@milkdown/kit/plugin/history';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { closeHistory } from '@milkdown/kit/prose/history';
import { Slice } from '@milkdown/kit/prose/model';
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state';
import { selectTextblockEnd, selectTextblockStart } from '@milkdown/kit/prose/commands';
import {
  linkSchema,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand
} from '@milkdown/kit/preset/commonmark';
import { gfm, insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { callCommand, getHTML, getMarkdown, replaceAll as replaceAllMarkdown } from '@milkdown/kit/utils';
import {
  insertParagraphNearSelection,
  runCodeBlockCommand,
  runDeleteSelectionCommand,
  runHeadingCommand,
  runIndentCommand,
  runListCommand,
  runOutdentCommand,
  runParagraphCommand,
  isSelectionInsideTable,
  runTableNavigationCommand
} from './editorBlockCommands';
import type { EditorCommand, EditorCommandTarget } from './editorCommands';
import { runEditorClipboardAction } from './editorClipboard';
import {
  clearFindHighlights,
  findAndSelect,
  findHighlightBehavior,
  replaceAllMatches,
  replaceCurrentMatch
} from './editorFind';
import { resolveEditorShortcutCommand } from './editorShortcuts';
import { scrollEditorSelectionIntoView } from './editorSelectionScroll';
import { editorInputBehavior } from './editorInputBehavior';
import { createEditorPasteBehavior } from './editorPasteBehavior';
import { highlightRemark, highlightSchema, toggleHighlightCommand } from './editorHighlight';
import { commonmarkPreset } from './editorHardbreakMarks';
import {
  insertInternalLinkCommand,
  internalLinkRemark,
  internalLinkSchema
} from './editorInternalLink';
import { taskListClickBehavior, turnIntoTaskListCommand } from './editorTaskList';
import { createKnowraMarksCodec, knowraMarkSchema } from './editorKnowraMarks';
import { configureNoteMarkdownStringify } from './editorMarkdownStringify';
import {
  createInlineAnnotation, excludeBlockFromInlineAnnotation, inlineAnnotationHighlightBehavior, inlineMarkIdOf, isInlineAnnotation,
  reanchorInlineAnnotation, removeInlineAnnotation, restoreInlineAnnotation, selectInlineAnnotation, setInlineAnnotationRows, updateInlineAnnotation
} from './editorInlineAnnotations';
import { annotationMarkSchema, annotationSerializerGuard, configureBlockIdentitySchema, createBlockIdentityBehavior, IDENTITY_META, stripIdentityFromHtml, withoutIdentity } from './editorBlockIdentity';
import { annotationShadowBehavior, applyBlockIdentity, captureIdentitySnapshot, type AnnotationIdentitySnapshot } from './annotationShadow';
import type { Annotation } from '@study-accelerator/web-core';
import {
  annotationPluginKey,
  createAnnotationHighlightBehavior,
  getAnnotationSelection,
  selectEditorAnnotation,
  setEditorAnnotations
} from './editorAnnotations';
import { createCodeFromFence, indentCode, leaveCode, moveToCodeLineBoundary, newlineInCode, removeEmptyCode, selectCodeBlockContentsAt } from './editorCodeCommands';
import { createCodeBlockBehavior } from './editorCodeBlock';
import { insertMathInline, mathInlineBehavior, mathInlineInputRule, mathInlineSchema } from './editorMathInline';
import { configureMathBlockDocument, mathBlockSerializerGuard, normalizeTrailingMathBlock, createMathFromFence, insertMathBlock, mathBlockBehavior, mathBlockSchema } from './editorMathBlock';
import { mathInlineGuardRemark, mathRemark } from './editorMathMarkdown';
import styles from './MilkdownNoteEditor.module.css';
import { EditorAnnotationActions } from './EditorAnnotationActions';
import { EditorTableHandles } from './EditorTableHandles';
import { EditorImageControls } from './EditorImageControls';
import { configureImageSize, createEditorImageBehavior, IMAGE_RESOURCE_POLICY_EVENT, imageHtmlWithRenderedSizes } from './editorImageBehavior';
import { editorTableBehavior } from './editorTableBehavior';
import { TABLE_DEFAULT_SIZE, clampTableSize } from './editorTableModel';
import { createTableColumnWidths } from './editorTableColumnWidths';
import { noteLinkSchema, noteLinkDomBehavior, captureNoteLinkEdit, applyNoteLinkEdit, selectNoteLinkOccurrence, type NoteLinkEditSession } from './editorNoteLinks';
import { parseNoteLinkUrl, type NoteLinkLocator } from '@study-accelerator/content-anchor';

export interface MilkdownNoteEditorProps {
  /** Optional host boundary; omitted for ordinary private notes. */
  resourcePolicy?: { resolveImage(source: string): string | null; disableLinks: boolean };
  onRequestNoteLink?(session: NoteLinkEditSession): void;
  onOpenNoteLink?(locator: NoteLinkLocator): void;
  noteLinkStatuses?: Record<string, 'active' | 'deleted'>;
  noteId: string;
  markdown: string;
  readOnly: boolean;
  allowExternalSync?: boolean;
  annotations?: Annotation[];
  focusedAnnotationId?: string | null;
  onCreateAnnotation?(scope: 'selection' | 'blocks' | 'section' | 'list', importance?: 'normal' | 'important' | 'core'): Promise<void>;
  onChange(markdown: string, options?: { editIntent?: import('./annotationEditJournal').AnnotationEditIntent; identity?: AnnotationIdentitySnapshot }): void;
  /** 服务端保存的块身份表；只在加载笔记与整篇替换正文时沿用，之后以编辑器为准。 */
  blockIdentity?: import('@study-accelerator/web-core').AnnotationIdentityTable | null;
  onSelectAnnotation?(annotationIds: string[]): void;
  onStatus?(message: string): void;
  onReady?(): void | Promise<void>;
  onUploadImage?(file: File): Promise<{ url: string; alt: string }>;
}


/** 旧链路插件只处理旧重点；v3（正文标记）由内联重点插件显示。 */
function applyEditorAnnotations(editor: Editor, annotations: Annotation[], focusedId: string | null) {
  setEditorAnnotations(editor, annotations.filter(annotation => !isInlineAnnotation(annotation)), focusedId);
  setInlineAnnotationRows(editor.ctx.get(editorViewCtx), annotations, focusedId);
}

export const MilkdownNoteEditor = forwardRef<EditorCommandTarget, MilkdownNoteEditorProps>(
  function MilkdownNoteEditor({ resourcePolicy, noteId, markdown, readOnly, allowExternalSync = true, annotations = [], focusedAnnotationId = null, blockIdentity = null, onChange, onCreateAnnotation, onSelectAnnotation, onStatus, onReady, onUploadImage, onRequestNoteLink, onOpenNoteLink, noteLinkStatuses }, ref) {
    const resourcePolicyRef = useRef(resourcePolicy);
    resourcePolicyRef.current = resourcePolicy;
    const hostRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<Editor | null>(null);
    const onChangeRef = useRef(onChange);
    const blockIdentityRef = useRef(blockIdentity);
    const onStatusRef = useRef(onStatus);
    const noteLinkCallbacks = useRef({ onRequestNoteLink, onOpenNoteLink, noteLinkStatuses });
    noteLinkCallbacks.current = { onRequestNoteLink, onOpenNoteLink, noteLinkStatuses };
    const requestNoteLink = (editor: Editor) => {
      const session = captureNoteLinkEdit(editor.ctx.get(editorViewCtx));
      if (!session) { onStatusRef.current?.('请先选中同一段落内不含换行或图片的连续文字，或将光标放在已有笔记链接内'); return true; }
      noteLinkCallbacks.current.onRequestNoteLink?.(session);
      return true;
    };
    const decorateNoteLinks = () => {
      const view = readyRef.current ? editorRef.current?.ctx.get(editorViewCtx) : null;
      if (view) view.dispatch(view.state.tr.setMeta('noteLinkStatusesChanged', true).setMeta('addToHistory', false));
    };
    const [operationStatus, setOperationStatus] = useState('');
    const reportOperationStatus = useCallback((message: string) => {
      if (!mountedRef.current) return;
      setOperationStatus(message);
      onStatusRef.current?.(message);
    }, []);
    const onReadyRef = useRef(onReady);
    const onUploadImageRef = useRef(onUploadImage);
    const annotationsRef = useRef(annotations);
    const focusedAnnotationIdRef = useRef(focusedAnnotationId);
    const onSelectAnnotationRef = useRef(onSelectAnnotation);
    const incomingMarkdownRef = useRef(markdown);
    const editorMarkdownRef = useRef(markdown);
    const emittedMarkdownRef = useRef(markdown);
    const applyingRemoteRef = useRef(false);
    const latestLocalMarkdownRef = useRef(markdown);
    const readyRef = useRef(false);
    const readOnlyRef = useRef(readOnly);
    const mountedRef = useRef(true);
    useLayoutEffect(() => {
      mountedRef.current = true;
      return () => { mountedRef.current = false; };
    }, []);
    const userInteractionRef = useRef(false);
    const composingRef = useRef(false);
    const compositionFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSelectionRef = useRef<{ from: number; to: number } | null>(null);
    onChangeRef.current = onChange;
    blockIdentityRef.current = blockIdentity;
    onStatusRef.current = onStatus;
    onReadyRef.current = onReady;
    onUploadImageRef.current = onUploadImage;
    annotationsRef.current = annotations;
    focusedAnnotationIdRef.current = focusedAnnotationId;
    onSelectAnnotationRef.current = onSelectAnnotation;
    incomingMarkdownRef.current = markdown;
    readOnlyRef.current = readOnly;

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      const editor = editorRef.current;
      if (!editor) return;
      if (event.target instanceof Element && event.target.closest('[data-code-toolbar]')) return;
      const view = editor.ctx.get(editorViewCtx);
      if (event.nativeEvent.isComposing || event.keyCode === 229 || composingRef.current || view.composing) return;
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'a') {
        const selection = window.getSelection();
        if (selection?.anchorNode && selection.focusNode
          && view.dom.contains(selection.anchorNode) && view.dom.contains(selection.focusNode)) {
          const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
          const focus = view.posAtDOM(selection.focusNode, selection.focusOffset);
          if (selectCodeBlockContentsAt(view.state, anchor, focus, view.dispatch)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }
      }
      if (readOnlyRef.current) return;
      userInteractionRef.current = true;
      if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (createCodeFromFence(view.state, view.dispatch) || createMathFromFence(view.state, view.dispatch))) {
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (view.state.selection.$from.parent.isBlock && view.state.selection.$from.parent.type.spec.code) {
        let handled = false;
        if (['Backspace', 'Delete'].includes(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) handled = removeEmptyCode(view.state, view.dispatch);
        else if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) handled = indentCode(event.shiftKey)(view.state, view.dispatch);
        else if (event.key === 'Enter' && !event.altKey) handled = (event.ctrlKey || event.metaKey ? leaveCode : newlineInCode)(view.state, view.dispatch, view);
        else if (['Home', 'End'].includes(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) handled = moveToCodeLineBoundary(event.key === 'End', event.shiftKey)(view.state, view.dispatch);
        if (handled) { event.preventDefault(); event.stopPropagation(); return; }
      }
      if (
        !event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && !event.shiftKey
        && (event.key === 'Home' || event.key === 'End')
      ) {
        const view = editor.ctx.get(editorViewCtx);
        // Ctrl+A 的 AllSelection 位于文档边界，文本块命令不会处理它。
        // 仅在边界可落到文本光标时同步收起，避免离焦后恢复旧全选。
        if (view.state.selection instanceof AllSelection) {
          const selection = event.key === 'Home'
            ? TextSelection.atStart(view.state.doc)
            : TextSelection.atEnd(view.state.doc);
          if (selection instanceof TextSelection && selection.empty) {
            view.dispatch(view.state.tr.setSelection(selection));
            event.preventDefault();
            return;
          }
        }
        const command = event.key === 'Home' ? selectTextblockStart : selectTextblockEnd;
        if (command(view.state, view.dispatch, view)) event.preventDefault();
        return;
      }
      const command = resolveEditorShortcutCommand(event);
      if (!command) return;
      if (command === 'indent' || command === 'outdent') {
        if (isSelectionInsideTable(editor)) {
          runTableNavigationCommand(editor, command === 'indent' ? 'next' : 'previous');
          event.preventDefault();
          return;
        }
        commandResolvers[command](editor);
        event.preventDefault();
        return;
      }
      if (command === 'internal-link' && noteLinkCallbacks.current.onRequestNoteLink) {
        requestNoteLink(editor); event.preventDefault(); return;
      }
      if (commandResolvers[command](editor)) event.preventDefault();
    };

    const handleCompositionStart = () => {
      userInteractionRef.current = true;
      if (compositionFlushTimerRef.current) clearTimeout(compositionFlushTimerRef.current);
      compositionFlushTimerRef.current = null;
      composingRef.current = true;
    };

    const handleCompositionEnd = () => {
      if (compositionFlushTimerRef.current) clearTimeout(compositionFlushTimerRef.current);
      // ProseMirror finishes an IME composition in a 20 ms follow-up task. Keep
      // code-block shortcuts dormant until that DOM reconciliation has settled.
      compositionFlushTimerRef.current = setTimeout(() => {
        compositionFlushTimerRef.current = null;
        composingRef.current = false;
        const editor = editorRef.current;
        if (!editor || !readyRef.current) return;
        const nextMarkdown = editor.action(getMarkdown());
        editorMarkdownRef.current = nextMarkdown;
        if (nextMarkdown === emittedMarkdownRef.current) return;
        emittedMarkdownRef.current = nextMarkdown;
        latestLocalMarkdownRef.current = nextMarkdown;
        onChangeRef.current(nextMarkdown, { identity: captureIdentitySnapshot(editor.ctx.get(editorViewCtx).state, nextMarkdown) });
      }, 30);
    };

    const inlineView = () => {
      const editor = editorRef.current;
      if (!editor || !readyRef.current) throw new Error('编辑器尚未就绪，请稍后再试');
      if (readOnlyRef.current) throw new Error('阅读模式下无法修改重点');
      return editor.ctx.get(editorViewCtx);
    };

    useImperativeHandle(ref, () => ({
      run(command) {
        const editor = editorRef.current;
        if (!editor || readOnlyRef.current) return false;
        restoreRememberedSelection(editor, lastSelectionRef.current);
        if (command === 'internal-link' && noteLinkCallbacks.current.onRequestNoteLink) return requestNoteLink(editor);
        const resolver = commandResolvers[command];
        return resolver ? resolver(editor) : false;
      },
      captureNoteLinkEdit() {
        const editor = editorRef.current;
        if (!editor || !readyRef.current || readOnlyRef.current) return null;
        restoreRememberedSelection(editor, lastSelectionRef.current);
        return captureNoteLinkEdit(editor.ctx.get(editorViewCtx));
      },
      applyNoteLinkEdit(session, targetId, label) {
        const editor = editorRef.current;
        return Boolean(editor && readyRef.current && !readOnlyRef.current && applyNoteLinkEdit(editor.ctx.get(editorViewCtx), session, targetId, label));
      },
      selectNoteLinkOccurrence(locator) {
        const editor = editorRef.current;
        return Boolean(editor && readyRef.current && selectNoteLinkOccurrence(editor.ctx.get(editorViewCtx), editor.action(getMarkdown()), locator));
      },
      matchesMarkdownDocument(markdown) {
        const editor = editorRef.current;
        if (!editor || !readyRef.current) return false;
        // 编辑器文档带块 ID 与重点 mark，重新解析的文档没有；比较正文时忽略身份信息。
        try { return withoutIdentity(editor.ctx.get(editorViewCtx).state.doc).eq(normalizeTrailingMathBlock(editor.ctx.get(parserCtx)(markdown))); }
        catch { return false; }
      },
      async runEdit(action) {
        const editor = editorRef.current;
        if (!editor || readOnlyRef.current && (action === 'cut' || action === 'paste')) {
          return { ok: false, reason: 'unsupported' };
        }
        restoreRememberedSelection(editor, lastSelectionRef.current);
        return runEditorClipboardAction(editor, action, () => mountedRef.current && editorRef.current === editor && !readOnlyRef.current);
      },
      find(query, currentIndex, direction) {
        const editor = editorRef.current;
        return editor ? findAndSelect(editor, query, currentIndex, direction) : { found: false, count: 0, index: -1 };
      },
      replaceCurrent(query, replacement, currentIndex) {
        const editor = editorRef.current;
        if (!editor || readOnlyRef.current) return { found: false, count: 0, index: -1, replaced: 0 };
        return replaceCurrentMatch(editor, query, replacement, currentIndex);
      },
      replaceAll(query, replacement) {
        const editor = editorRef.current;
        if (!editor || readOnlyRef.current) return { found: false, count: 0, index: -1, replaced: 0 };
        return replaceAllMatches(editor, query, replacement);
      },
      clearFind() {
        const editor = editorRef.current;
        if (editor) clearFindHighlights(editor);
      },
      navigateToHeading(index, behavior = 'smooth') {
        const editor = editorRef.current;
        if (!editor || !readyRef.current || index < 0) return false;
        const view = editor.ctx.get(editorViewCtx);
        let headingPosition: number | null = null;
        let headingIndex = 0;
        view.state.doc.descendants((node, position) => {
          if (headingPosition !== null) return false;
          if (node.type.name !== 'heading' || Number(node.attrs.level) > 4) return true;
          if (headingIndex === index) {
            headingPosition = position;
            return false;
          }
          headingIndex += 1;
          return true;
        });
        if (headingPosition === null) return false;

        const selectionPosition = Math.min(headingPosition + 1, view.state.doc.content.size);
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(selectionPosition))));
        view.focus();
        const heading = view.nodeDOM(headingPosition);
        if (heading instanceof HTMLElement) {
          heading.scrollIntoView({ block: 'start', behavior });
        }
        return true;
      },
      getAnnotationSelection(scopeType = 'selection', options) {
        const editor = editorRef.current;
        if (!editor || !readyRef.current) return null;
        if (options?.restoreSelection !== false) restoreRememberedSelection(editor, lastSelectionRef.current);
        return getAnnotationSelection(editor, editor.action(getMarkdown()), scopeType);
      },
      setAnnotations(nextAnnotations, focusedId = null) {
        const editor = editorRef.current;
        if (editor && readyRef.current) applyEditorAnnotations(editor, nextAnnotations, focusedId);
      },
      selectAnnotation(annotationId) {
        const editor = editorRef.current;
        if (!editor || !readyRef.current) return false;
        const inline = annotationsRef.current.find(item => item.id === annotationId && isInlineAnnotation(item));
        if (inline) return selectInlineAnnotation(editor.ctx.get(editorViewCtx), inlineMarkIdOf(inline) ?? '');
        return selectEditorAnnotation(editor, annotationId);
      },
      inlineAnnotations: {
        create(scope, importance) { return createInlineAnnotation(inlineView(), scope, importance); },
        remove(markId) { return removeInlineAnnotation(inlineView(), markId); },
        restore(snapshot) { restoreInlineAnnotation(inlineView(), snapshot); },
        update(markId, patch) { updateInlineAnnotation(inlineView(), markId, patch); },
        reanchor(markId, scope) { restoreRememberedSelection(editorRef.current!, lastSelectionRef.current); reanchorInlineAnnotation(inlineView(), markId, scope); },
        exclude(markId) { restoreRememberedSelection(editorRef.current!, lastSelectionRef.current); excludeBlockFromInlineAnnotation(inlineView(), markId); }
      },
      insertTable(rows, columns) {
        const editor = editorRef.current;
        if (!editor || readOnlyRef.current) return false;
        restoreRememberedSelection(editor, lastSelectionRef.current);
        return Boolean(editor.action(callCommand(insertTableCommand.key, clampTableSize(rows, columns))));
      },
      insertImage(url, alt) {
        const editor = editorRef.current;
        if (!editor || readOnlyRef.current || !url) return false;
        restoreRememberedSelection(editor, lastSelectionRef.current);
        const view = editor.ctx.get(editorViewCtx);
        const imageType = view.state.schema.nodes.image;
        if (!imageType) return false;
        const image = imageType.create({ src: url, alt, title: null });
        view.dispatch(view.state.tr.replaceSelectionWith(image).scrollIntoView());
        return true;
      },
      insertLink(url, label) {
        const editor = editorRef.current;
        if (!editor || readOnlyRef.current || !url) return false;
        restoreRememberedSelection(editor, lastSelectionRef.current);
        const view = editor.ctx.get(editorViewCtx);
        const linkType = view.state.schema.marks.link;
        if (!linkType) return false;
        const link = view.state.schema.text(
          label.trim() || '附件',
          [linkType.create({ href: url, title: null })]
        );
        view.dispatch(view.state.tr.replaceSelectionWith(link, false).scrollIntoView());
        return true;
      },
      setMarkdown(nextMarkdown) {
        const editor = editorRef.current;
        if (!editor || nextMarkdown === editorMarkdownRef.current) return;
        editorMarkdownRef.current = nextMarkdown;
        emittedMarkdownRef.current = nextMarkdown;
        editor.action(replaceAllMarkdown(nextMarkdown, true));
      },
      replaceMarkdown(nextMarkdown) {
        const editor = editorRef.current;
        if (!editor || readOnlyRef.current || nextMarkdown === editorMarkdownRef.current) return false;
        const parsed = editor.ctx.get(parserCtx)(nextMarkdown);
        if (!parsed || typeof parsed === 'string') return false;
        const view = editor.ctx.get(editorViewCtx);
        view.dispatch(closeHistory(view.state.tr.replace(
          0,
          view.state.doc.content.size,
          new Slice(parsed.content, 0, 0)
        )).scrollIntoView());
        return true;
      },
      focus() {
        const editor = editorRef.current;
        if (editor) restoreRememberedSelection(editor, lastSelectionRef.current);
        else hostRef.current?.querySelector<HTMLElement>('.ProseMirror')?.focus();
      },
      getMarkdown() {
        return editorRef.current?.action(getMarkdown()) ?? editorMarkdownRef.current;
      },
      getHtml() {
        const editor = editorRef.current;
        return editor ? stripIdentityFromHtml(imageHtmlWithRenderedSizes(editor.action(getHTML()), editor.ctx.get(editorViewCtx))) : '';
      }
    }), []);

    useEffect(() => {
      const root = hostRef.current;
      if (!root) return;
      let cancelled = false;
      root.dataset.editorReady = 'false';
      readyRef.current = false;
      composingRef.current = false;
      userInteractionRef.current = false;
      editorMarkdownRef.current = incomingMarkdownRef.current;
      emittedMarkdownRef.current = incomingMarkdownRef.current;
      latestLocalMarkdownRef.current = incomingMarkdownRef.current;
      const editor = Editor.make()
        .config((ctx) => {
          configureImageSize(ctx, resourcePolicy ? source => resourcePolicyRef.current?.resolveImage(source) ?? null : undefined);
          if (resourcePolicy?.disableLinks) ctx.update(linkSchema.key, original => schemaCtx => ({ ...original(schemaCtx), toDOM: () => ['span', { 'data-disabled-link': '' }, 0] }));
          configureMathBlockDocument(ctx);
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, incomingMarkdownRef.current);
          ctx.set(historyProviderConfig.key, { depth: 500, newGroupDelay: 750 });
          ctx.set(editorViewOptionsCtx, {
            editable: () => !readOnlyRef.current,
            handleScrollToSelection: (view) => !userInteractionRef.current || scrollEditorSelectionIntoView(view),
            attributes: {
              'aria-label': '笔记正文',
              'aria-multiline': 'true',
              'aria-keyshortcuts': 'Tab Shift+Tab Meta+0 Meta+1 Meta+2 Meta+3 Meta+4 Meta+B Meta+I Meta+E Meta+Shift+Backquote Meta+Shift+H Meta+Shift+X Meta+Alt+U Meta+Alt+O Meta+Alt+Q Meta+Alt+C Meta+Alt+T Meta+Alt+R Meta+Alt+K Control+0 Control+1 Control+2 Control+3 Control+4 Control+B Control+I Control+E Control+Shift+H Control+Shift+X Control+Shift+Backquote',
              spellcheck: 'true'
            }
          });
          configureNoteMarkdownStringify(ctx);
          // Document transactions publish synchronously through the annotation plugin.
          // A debounced Markdown listener can replay an older document over a newer draft.
        })
        .use(commonmarkPreset)
        .use(resourcePolicy?.disableLinks ? [] : noteLinkSchema)
        .use(resourcePolicy?.disableLinks ? [] : noteLinkDomBehavior(() => noteLinkCallbacks.current.noteLinkStatuses))
        .use(createCodeBlockBehavior((message) => onStatusRef.current?.(message)))
        .use(gfm)
        .use(mathRemark)
        .use(mathInlineGuardRemark)
        .use(mathBlockSchema)
        .use(mathBlockBehavior)
        .use(mathBlockSerializerGuard)
        .use(mathInlineSchema)
        .use(mathInlineBehavior)
        .use(mathInlineInputRule)
        .use(editorTableBehavior)
        .use(createTableColumnWidths(noteId))
        .use(createEditorImageBehavior(resourcePolicy ? source => resourcePolicyRef.current?.resolveImage(source) ?? null : undefined))
        .use(highlightRemark)
        .use(highlightSchema)
        .use(toggleHighlightCommand)
        .use(internalLinkRemark)
        .use(internalLinkSchema)
        .use(insertInternalLinkCommand)
        .use(createEditorPasteBehavior(
          reportOperationStatus,
          (file) => {
            const upload = onUploadImageRef.current;
            if (!upload) return Promise.reject(new Error('当前无法上传图片'));
            return upload(file);
          }
        ))
        .use(clipboard)
        .use(findHighlightBehavior)
        .use(createAnnotationHighlightBehavior((annotationIds) => onSelectAnnotationRef.current?.(annotationIds), (nextMarkdown, editIntent, state) => {
          if (applyingRemoteRef.current || !readyRef.current || composingRef.current || (nextMarkdown === editorMarkdownRef.current && !editIntent.deletedEmptyAnnotationIds?.length && !editIntent.preserveEmptyBlock)) return;
          editorMarkdownRef.current = nextMarkdown;
          emittedMarkdownRef.current = nextMarkdown;
          latestLocalMarkdownRef.current = nextMarkdown;
          onChangeRef.current(nextMarkdown, { editIntent, identity: captureIdentitySnapshot(state, nextMarkdown) });
        }, (selection) => { lastSelectionRef.current = selection; }))
        .use(annotationMarkSchema)
        .use(createBlockIdentityBehavior((state) => new Set(annotationPluginKey.getState(state)?.annotations.map((annotation) => annotation.id) ?? []),
          state => annotationPluginKey.getState(state)?.editIntent.moveKind === 'paste'))
        .use(annotationShadowBehavior)
        .use(annotationSerializerGuard)
        .use(knowraMarkSchema)
        .use(inlineAnnotationHighlightBehavior)
        .use(createKnowraMarksCodec())
        .use(turnIntoTaskListCommand)
        .use(taskListClickBehavior)
        .use(editorInputBehavior)
        .use(history)
        .use(listener)
        .config(configureBlockIdentitySchema);
      void editor.create().then(async () => {
        if (cancelled) return void editor.destroy();
        editorRef.current = editor;
        const incomingMarkdown = incomingMarkdownRef.current;
        const currentMarkdown = editor.action(getMarkdown());
        editorMarkdownRef.current = currentMarkdown;
        if (incomingMarkdown !== currentMarkdown) {
          editorMarkdownRef.current = incomingMarkdown;
          editor.action(replaceAllMarkdown(incomingMarkdown, true));
        }
        const identityView = editor.ctx.get(editorViewCtx);
        identityView.dispatch(identityView.state.tr.setMeta(IDENTITY_META, true).setMeta('addToHistory', false));
        applyBlockIdentity(identityView, editorMarkdownRef.current, blockIdentityRef.current);
        readyRef.current = true;
        applyEditorAnnotations(editor, annotationsRef.current, focusedAnnotationIdRef.current);
        const selection = editor.ctx.get(editorViewCtx).state.selection;
        lastSelectionRef.current = { from: selection.from, to: selection.to };
        await onReadyRef.current?.();
        if (cancelled) return;
        root.dataset.editorReady = 'true';
        decorateNoteLinks();
      });
      return () => {
        cancelled = true;
        readyRef.current = false;
        editorRef.current = null;
        lastSelectionRef.current = null;
        composingRef.current = false;
        if (compositionFlushTimerRef.current) clearTimeout(compositionFlushTimerRef.current);
        compositionFlushTimerRef.current = null;
        delete root.dataset.editorReady;
        void editor.destroy();
      };
    }, [noteId]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || !readyRef.current) return;
      editor.ctx.get(editorViewCtx).setProps({ editable: () => !readOnly });
    }, [readOnly]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || !readyRef.current || !allowExternalSync || composingRef.current) return;
      if (markdown === editorMarkdownRef.current) return;
      if (markdown === latestLocalMarkdownRef.current) {
        editorMarkdownRef.current = markdown;
        return;
      }
      editorMarkdownRef.current = markdown;
      emittedMarkdownRef.current = markdown;
      const view = editor.ctx.get(editorViewCtx);
      const scrollRoot = view.dom.closest<HTMLElement>('[data-editor-scroll-root]');
      const scrollTop = scrollRoot?.scrollTop;
      applyingRemoteRef.current = true;
      try {
        // 远端整篇正文是新的编辑基线，不能混入本地撤销历史或沿用旧正文的重点范围快照。
        editor.action(replaceAllMarkdown(markdown, true));
        view.dispatch(view.state.tr.setMeta(IDENTITY_META, true).setMeta('addToHistory', false));
        applyBlockIdentity(view, markdown, blockIdentityRef.current);
        applyEditorAnnotations(editor, annotationsRef.current, focusedAnnotationIdRef.current);
      }
      finally { applyingRemoteRef.current = false; }
      latestLocalMarkdownRef.current = markdown;
      if (scrollRoot && scrollTop !== undefined) {
        scrollRoot.scrollTop = scrollTop;
        window.requestAnimationFrame(() => {
          if (scrollRoot.isConnected) scrollRoot.scrollTop = scrollTop;
        });
      }
      void onReadyRef.current?.();
    }, [allowExternalSync, markdown]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || !readyRef.current) return;
      applyEditorAnnotations(editor, annotations, focusedAnnotationId);
    }, [annotations, focusedAnnotationId]);

    const getView = useCallback(() => readyRef.current ? editorRef.current?.ctx.get(editorViewCtx) ?? null : null, []);
    useEffect(decorateNoteLinks, [markdown, noteLinkStatuses]);
    useEffect(() => {
      if (resourcePolicy && readyRef.current) editorRef.current?.ctx.get(editorViewCtx).dom.dispatchEvent(new Event(IMAGE_RESOURCE_POLICY_EVENT));
    }, [resourcePolicy]);

    return (
      <> <div
        ref={hostRef}
        className={styles.milkdownEditor}
        data-readonly={readOnly || undefined}
        onKeyDownCapture={handleKeyDown}
        onClickCapture={(event) => {
          const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
          if (anchor && resourcePolicyRef.current?.disableLinks) { event.preventDefault(); event.stopPropagation(); return; }
          const parsed = anchor && parseNoteLinkUrl(anchor.getAttribute('data-note-link-url'));
          if (!parsed) return;
          event.preventDefault(); event.stopPropagation();
          noteLinkCallbacks.current.onOpenNoteLink?.(parsed);
        }}
        onBeforeInputCapture={() => { userInteractionRef.current = true; }}
        onPointerDownCapture={() => { userInteractionRef.current = true; }}
        onCompositionStartCapture={handleCompositionStart}
        onCompositionEndCapture={handleCompositionEnd}
      />
      {!readOnly && onCreateAnnotation ? <EditorAnnotationActions hostRef={hostRef} getView={getView} onCreate={onCreateAnnotation} onStatus={reportOperationStatus} onCommand={(command) => { const editor = editorRef.current; if (editor) { restoreRememberedSelection(editor, lastSelectionRef.current); if (command === 'internal-link' && noteLinkCallbacks.current.onRequestNoteLink) requestNoteLink(editor); else commandResolvers[command](editor); } }} /> : null}
      {!readOnly ? <EditorTableHandles hostRef={hostRef} getView={getView} /> : null}
      {!readOnly ? <EditorImageControls hostRef={hostRef} getView={getView} /> : null}
      {operationStatus ? <p className={styles.operationStatus} role="status" data-pdf-exclude="true">{operationStatus}</p> : null}
      </>
    );
  }
);

function restoreRememberedSelection(
  editor: Editor,
  remembered: { from: number; to: number } | null
): void {
  const view = editor.ctx.get(editorViewCtx);
  if (!remembered) {
    view.focus();
    return;
  }
  const docSize = view.state.doc.content.size;
  const from = view.state.doc.resolve(Math.max(0, Math.min(remembered.from, docSize)));
  const to = view.state.doc.resolve(Math.max(0, Math.min(remembered.to, docSize)));
  const selection = TextSelection.between(from, to);
  if (!selection.eq(view.state.selection)) {
    view.dispatch(view.state.tr.setSelection(selection));
  }
  view.focus();
}

const commandResolvers: Record<EditorCommand, (editor: Editor) => boolean> = {
  'heading-1': (editor) => runHeadingCommand(editor, 1),
  'heading-2': (editor) => runHeadingCommand(editor, 2),
  'heading-3': (editor) => runHeadingCommand(editor, 3),
  'heading-4': (editor) => runHeadingCommand(editor, 4),
  paragraph: runParagraphCommand,
  bold: (editor) => Boolean(editor.action(callCommand(toggleStrongCommand.key))),
  italic: (editor) => Boolean(editor.action(callCommand(toggleEmphasisCommand.key))),
  strikethrough: (editor) => Boolean(editor.action(callCommand(toggleStrikethroughCommand.key))),
  'inline-code': (editor) => Boolean(editor.action(callCommand(toggleInlineCodeCommand.key))),
  highlight: (editor) => Boolean(editor.action(callCommand(toggleHighlightCommand.key))),
  'internal-link': (editor) => Boolean(editor.action(callCommand(insertInternalLinkCommand.key))),
  'bullet-list': (editor) => runListCommand(editor, 'bullet_list'),
  'ordered-list': (editor) => runListCommand(editor, 'ordered_list'),
  'task-list': (editor) => Boolean(editor.action(callCommand(turnIntoTaskListCommand.key))),
  blockquote: (editor) => Boolean(editor.action(callCommand(wrapInBlockquoteCommand.key))),
  'code-block': runCodeBlockCommand,
  'math-block': (editor) => {
    const view = editor.ctx.get(editorViewCtx);
    return insertMathBlock(view.state, view.dispatch);
  },
  'math-inline': (editor) => {
    const view = editor.ctx.get(editorViewCtx);
    return insertMathInline(view.state, view.dispatch);
  },
  'horizontal-rule': (editor) => Boolean(editor.action(callCommand(insertHrCommand.key))),
  table: (editor) => Boolean(editor.action(callCommand(insertTableCommand.key, TABLE_DEFAULT_SIZE))),
  'delete-selection': runDeleteSelectionCommand,
  indent: runIndentCommand,
  outdent: runOutdentCommand,
  'paragraph-above': (editor) => insertParagraphNearSelection(editor, 'above'),
  'paragraph-below': (editor) => insertParagraphNearSelection(editor, 'below'),
  undo: (editor) => Boolean(editor.action(callCommand(undoCommand.key))),
  redo: (editor) => Boolean(editor.action(callCommand(redoCommand.key)))
};
