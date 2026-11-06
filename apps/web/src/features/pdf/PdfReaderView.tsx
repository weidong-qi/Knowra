import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Note } from '@study-accelerator/web-core';
import type { PdfAnnotation, PdfSegment } from '@study-accelerator/shared/pdf';
import { Button, Dialog, DialogBody, DialogFooter, FileDropField, TextField } from '../../components/ui';
import { useAppStore } from '../../store/AppStoreProvider';
import { useDesktopTitlebar } from '../../shell/DesktopTitlebarContext';
import { readRuntimeConfig } from '../../app/runtimeConfig';
import { registerDesktopSave } from '../../app/desktopLifecycle';
import { registerNavigationGuard } from '../../app/navigationGuard';
import { useNavigate, useLocation } from '../../app/router';
import { downloadTextFile } from '../../browser/downloadFile';
import { writeClipboardText } from '../../browser/clipboard';
import { EditorTabs } from '../editor/EditorTabs';
import { downloadAttachment } from '../editor/attachmentAccess';
import { listPdfAnnotations, pdfFileUrl, pdfRequest, randomId } from './pdfApi';
import { usePdfViewer } from './usePdfViewer';
import { PdfConflictDialog, type PdfConflictReview } from './PdfConflictDialog';
import { PdfSession } from './pdfSession';
import { PdfHistory } from './pdfHistory';
import { exportPdfExcerpt, moveRect, noteRectAt, rectToPdf, rectToViewport, type PdfSelection } from './pdfGeometry';
import { paintPdfAnnotations, pdfAnnotationAtPoint, readPdfSelection } from './pdfOverlay';
import { buildPdfExtractNote } from './pdfExtract';
import { PdfNoteCard } from './PdfNoteCard';
import { PdfAnnotationTooltip } from './PdfAnnotationTooltip';
import { PdfAnnotationActions } from './PdfAnnotationActions';
import { PdfCommentEditor } from './PdfCommentEditor';
import { PdfDictionaryPopover } from './PdfDictionaryPopover';
import { normalizeDictionaryWord } from '../dictionary/localDictionary';
import { PdfSelectionBar, type PdfBarAnchor, type PdfTextMode } from './PdfSelectionBar';
import { PdfPageBar } from './PdfPageBar';
import { PdfReaderToolbar } from './PdfReaderToolbar';
import { PdfSidePanel, type PdfPanelTab } from './PdfSidePanel';
import { pdfViewerCss } from './pdfRuntime';
import styles from './PdfReader.module.css';

/** 跳转到标注时为顶部浮动工具栏预留的空间（px）。 */
const JUMP_TOP_CLEARANCE = 96;

export function PdfReaderView({
  note,
  canWrite,
  onOpenNote
}: {
  note: Note;
  canWrite: boolean;
  onOpenNote(id: string): void;
}) {
  const source = note.pdfSource!;
  const viewer = usePdfViewer(source.attachmentId, note.id, source.sha256);
  const navigate = useNavigate(),
    location = useLocation();
  const titlebar = useDesktopTitlebar();
  const store = useAppStore(state => state);
  const [, render] = useState(0);
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [annotationAction, setAnnotationAction] = useState<{ id: string; x: number; y: number } | null>(null);
  const [commentEditor, setCommentEditor] = useState<{ id: string; x: number; y: number } | null>(null);
  const annotationPress = useRef<{ id: string; x: number; y: number } | null>(null);
  const skipTextMouseUp = useRef(false);
  const scrollPosition = useRef({ top: 0, left: 0 });
  const [pending, setPending] = useState<{ value: PdfSelection; anchor: PdfBarAnchor } | null>(null);
  const [dictionary, setDictionary] = useState<{ value: PdfSelection; anchor: PdfBarAnchor } | null>(null);
  const [tool, setTool] = useState('text'),
    [panel, setPanel] = useState(true);
  const [ghost, setGhost] = useState<PdfSegment | null>(null);
  const [password, setPassword] = useState('');
  const [outline, setOutline] = useState<Array<{ title: string; dest: unknown; depth: number }>>([]);
  const [panelTab, setPanelTab] = useState<PdfPanelTab>('marks');
  const [saveDialog, setSaveDialog] = useState(false);
  const [review, setReview] = useState<PdfConflictReview | null>(null);
  const drag = useRef<{ index: number; x: number; y: number } | null>(null);
  const noteDrag = useRef<{
    id: string;
    pageIndex: number;
    x: number;
    y: number;
    rect: number[];
    moved: boolean;
    last?: PdfSegment;
  } | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [textMode, setTextMode] = useState<PdfTextMode>('highlight');
  const [noteMove, setNoteMove] = useState<{ id: string; segment: PdfSegment } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const permission = useRef(canWrite);
  permission.current = canWrite;
  const sessionRef = useRef<PdfSession | null>(null);
  if (!sessionRef.current) {
    const scope = `${readRuntimeConfig().cacheSuffix}:${note.spaceId ?? ''}`;
    sessionRef.current = new PdfSession(
      note.id,
      source.sha256,
      `knowra:pdf-draft:v1:${JSON.stringify([scope, note.id])}`,
      () => {
        if (alive.current) render(value => value + 1);
      },
      () => permission.current && alive.current,
      true
    );
  }
  const session = sessionRef.current;
  const historyRef = useRef<PdfHistory | null>(null);
  if (!historyRef.current)
    historyRef.current = new PdfHistory(
      session,
      () => {
        if (alive.current) render(value => value + 1);
      },
      () => permission.current && alive.current
    );
  const history = historyRef.current;
  const items = session.values();
  const editable = canWrite && loaded && Boolean(viewer.document) && !history.busy;
  const cardItem = cardOpen ? items.find(item => item.id === selected && item.type === 'note') : undefined;
  const cardAnchor = cardItem ? noteCardAnchor(cardItem) : null;
  const isTextSelection = pending?.value.type === 'highlight' || pending?.value.type === 'underline';
  const canLookup = isTextSelection && Boolean(normalizeDictionaryWord(pending!.value.quoteText));
  const actionItem = annotationAction ? items.find(item => item.id === annotationAction.id) : undefined;
  const editingItem = commentEditor ? items.find(item => item.id === commentEditor.id) : undefined;
  useEffect(() => {
    setAnnotationAction(null);
    setCommentEditor(null);
    setDictionary(null);
  }, [viewer.viewportRevision]);
  useEffect(() => {
    alive.current = true;
    void listPdfAnnotations(note.id)
      .then(values => {
        if (!alive.current) return;
        session.items = new Map(values.map(item => [item.id, item]));
        session.recover();
        setLoaded(true);
        render(value => value + 1);
        if (session.drafts.size) setError('已恢复未保存的 PDF 标注草稿，请核对后点击重试保存。');
      })
      .catch(reason => {
        if (alive.current) setError(reason instanceof Error ? reason.message : '标注加载失败');
      });
    const detachSave = registerDesktopSave(async mode => {
      await session.persist();
      if (mode !== 'recovery') await session.flush();
    });
    const detachGuard = registerNavigationGuard(() => {
      if (!session.drafts.size) return true;
      setSaveDialog(true);
      return false;
    });
    const unload = (event: BeforeUnloadEvent) => {
      if (session.drafts.size) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      detachSave();
      detachGuard();
      window.removeEventListener('beforeunload', unload);
      void session.persist().catch(() => undefined);
    };
  }, [note.id, session]);

  useEffect(() => {
    if (!viewer.document) return;
    let active = true;
    void viewer.document.getOutline().then(value => {
      const flatten = (nodes: NonNullable<typeof value>, depth = 0): typeof outline =>
        nodes.flatMap(node => [{ title: node.title, dest: node.dest, depth }, ...flatten(node.items, depth + 1)]);
      if (active) setOutline(flatten(value ?? []));
    });
    return () => {
      active = false;
    };
  }, [viewer.document]);
  useEffect(() => {
    if (!viewer.viewerRef.current) return;
    const painted = noteMove
      ? items.map(item => (item.id === noteMove.id ? { ...item, segments: [noteMove.segment] } : item))
      : items;
    paintPdfAnnotations(viewer.viewerRef.current, painted, selected, ghost);
  });
  const pendingJump = useRef<string | null>(null);
  const jump = useCallback(
    (item: PdfAnnotation) => {
      const first = item.segments[0],
        engine = viewer.viewerRef.current;
      if (!engine) return;
      if (!engine.pagesCount) {
        // PDF 页面尚未初始化：先选中并展开面板，页面就绪后由下方 effect 完成定位。
        pendingJump.current = item.id;
        setSelected(item.id);
        setPanel(true);
        setPanelTab('marks');
        return;
      }
      pendingJump.current = null;
      if (first.pageIndex >= engine.pagesCount) {
        setError('标注页码不在当前 PDF 内，草稿与原文件均已保留。');
        return;
      }
      engine.scrollPageIntoView({
        pageNumber: first.pageIndex + 1,
        destArray: [null, { name: 'XYZ' }, first.rect[0], first.rect[3], null],
        allowNegativeOffset: false
      });
      // 定位后把目标往下让出浮动工具栏的高度，避免标注被顶部操作栏遮住。
      const scroller = engine.container;
      if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollTop - JUMP_TOP_CLEARANCE);
      setSelected(item.id);
      setPanel(true);
      setPanelTab('marks');
    },
    [viewer.viewerRef]
  );
  useEffect(() => {
    if (!loaded || !viewer.count) return;
    const id = pendingJump.current ?? new URLSearchParams(location.pathname.split('?')[1]).get('pdfAnnotation');
    const item = session.values().find(value => value.id === id);
    if (item) jump(item);
  }, [loaded, viewer.count, location.pathname, session, jump]);
  async function flush() {
    try {
      await session.flush();
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败');
    }
  }
  async function reviewConflict() {
    try {
      const latest = await listPdfAnnotations(note.id);
      const conflictId = session.conflictId();
      const draft = (conflictId && session.drafts.get(conflictId)) || session.drafts.values().next().value;
      if (draft) setReview({ draft, remote: latest.find(item => item.id === draft.id) ?? null });
    } catch (reason) {
      setError(String(reason));
    }
  }
  function change(id: string, fields: Partial<PdfAnnotation>, remove = false) {
    if (!editable) return;
    void history.stage(id, fields, remove).catch(reason => setError(String(reason)));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush();
    }, 450);
  }
  async function moveHistory(redo = false) {
    if (!editable) return;
    if (timer.current) clearTimeout(timer.current);
    setAnnotationAction(null);
    setCommentEditor(null);
    setDictionary(null);
    setCardOpen(false);
    setPending(null);
    setGhost(null);
    try {
      const id = await history.move(redo);
      setSelected(id);
      await flush();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '撤销或重做失败，草稿已保留。');
    }
  }
  const historyActionRef = useRef(moveHistory);
  historyActionRef.current = moveHistory;
  useEffect(
    () =>
      window.knowraDesktop?.onPdfHistory?.(redo => {
        void historyActionRef.current(redo);
      }),
    []
  );
  function createMark(value: PdfSelection, kind: string, comment = '') {
    if (!editable) return;
    if (value.segments.length > 2000 || value.quoteText.length > 100000) {
      setError('本次选区过长，请分成几条标注保存。');
      return;
    }
    const id = randomId();
    change(id, { ...value, kind, comment });
    setSelected(id);
    if (value.type === 'note') setCardOpen(true);
    else {
      setPanel(true);
      setPanelTab('marks');
    }
    setPending(null);
    setDictionary(null);
    setGhost(null);
    window.getSelection()?.removeAllRanges();
  }
  function saveDictionary(comment: string) {
    if (!dictionary || !editable) return;
    const value = { ...dictionary.value, type: textMode };
    const existing = items.find(
      item =>
        item.type === value.type &&
        item.quoteText === value.quoteText &&
        JSON.stringify(item.segments) === JSON.stringify(value.segments) &&
        item.comment === comment
    );
    if (existing) {
      setSelected(existing.id);
      setPanel(true);
      setPanelTab('marks');
      setDictionary(null);
      window.getSelection()?.removeAllRanges();
      return;
    }
    createMark(value, 'supplement', comment);
  }
  function textAnchor(): PdfBarAnchor | null {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const rects = selection.getRangeAt(0).getClientRects();
    const last = rects[rects.length - 1],
      first = rects[0];
    if (!first || !last) return null;
    return { x: (first.left + first.right) / 2, top: first.top, bottom: last.bottom };
  }

  function pageGeometry(index: number) {
    const page = viewer.viewerRef.current?.getPageView(index);
    const canvas = page && (page.div as HTMLElement).querySelector<HTMLElement>('.canvasWrapper');
    if (!page?.viewport || !canvas) return null;
    return { viewport: page.viewport, bounds: canvas.getBoundingClientRect() };
  }
  /** 便签卡片贴在图标右侧；放不下时翻到左侧，图标滚出可视区域则不显示。 */
  function noteCardAnchor(item: PdfAnnotation) {
    const segment = item.segments[0],
      geo = pageGeometry(segment.pageIndex),
      frame = viewer.containerRef.current?.getBoundingClientRect();
    if (!geo || !frame) return null;
    const box = rectToViewport(geo.viewport, segment.rect);
    const kx = geo.bounds.width / geo.viewport.width,
      ky = geo.bounds.height / geo.viewport.height;
    const top = geo.bounds.top + box.y * ky;
    if (top < frame.top - 20 || top > frame.bottom) return null;
    const right = geo.bounds.left + (box.x + box.width) * kx + 8;
    const left = right + 220 > window.innerWidth - 8 ? geo.bounds.left + box.x * kx - 228 : right;
    return { left: Math.max(8, left), top };
  }
  function syncScrollPosition(element: HTMLElement) {
    const { scrollTop: top, scrollLeft: left } = element;
    const moved = scrollPosition.current.top !== top || scrollPosition.current.left !== left;
    scrollPosition.current = { top, left };
    return moved;
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    syncScrollPosition(event.currentTarget);
    setAnnotationAction(null);
    setDictionary(null);
    annotationPress.current = null;
    skipTextMouseUp.current = false;
    if (tool === 'text' && event.target instanceof Element) {
      const id = pdfAnnotationAtPoint(event.target, event.clientX, event.clientY);
      if (items.some(item => item.id === id && (item.type === 'highlight' || item.type === 'underline')))
        annotationPress.current = { id: id!, x: event.clientX, y: event.clientY };
    }
    const icon = (event.target as Element).closest<SVGElement>('[data-note-id]');
    const iconItem = icon && items.find(item => item.id === icon.dataset.noteId);
    if (iconItem) {
      setPending(null);
      setGhost(null);
      setSelected(iconItem.id);
      setCardOpen(true);
      if (!editable) return;
      noteDrag.current = {
        id: iconItem.id,
        pageIndex: iconItem.segments[0].pageIndex,
        x: event.clientX,
        y: event.clientY,
        rect: iconItem.segments[0].rect,
        moved: false
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    // 点到页面任意空白处都先收起候选色条和预览框，再按当前工具决定是否开始新的标注。
    setCardOpen(false);
    if (!annotationPress.current) setSelected(null);
    setPending(null);
    setGhost(null);
    if (!editable || (tool !== 'region' && tool !== 'note')) return;
    const element = (event.target as Element).closest<HTMLElement>('.page');
    if (!element) return;
    if (tool === 'note') {
      const index = Number(element.dataset.pageNumber) - 1,
        geo = pageGeometry(index);
      if (!geo) return;
      const segment = { pageIndex: index, rect: noteRectAt(geo.viewport, geo.bounds, event.clientX, event.clientY) };
      setGhost(segment);
      setPending({
        value: { type: 'note', segments: [segment], quoteText: '' },
        anchor: { x: event.clientX, top: event.clientY - 12, bottom: event.clientY + 12 }
      });
      event.preventDefault();
      return;
    }
    drag.current = { index: Number(element.dataset.pageNumber) - 1, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function dragSegment(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current,
      engine = viewer.viewerRef.current;
    if (!start || !engine) return null;
    const page = engine.getPageView(start.index),
      canvas = (page.div as HTMLElement).querySelector<HTMLElement>('.canvasWrapper');
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    const clampX = (value: number) => Math.max(bounds.left, Math.min(bounds.right, value));
    const clampY = (value: number) => Math.max(bounds.top, Math.min(bounds.bottom, value));
    const left = clampX(Math.min(start.x, event.clientX)),
      right = clampX(Math.max(start.x, event.clientX));
    const top = clampY(Math.min(start.y, event.clientY)),
      bottom = clampY(Math.max(start.y, event.clientY));
    if (right - left < 5 || bottom - top < 5) return null;
    return { pageIndex: start.index, rect: rectToPdf(page.viewport, bounds, { left, right, top, bottom }) };
  }
  async function exportExcerpt() {
    try {
      await session.flush();
      downloadTextFile(
        `${note.title}.标注.md`,
        exportPdfExcerpt(note.title, note.id, session.values()),
        'text/markdown;charset=utf-8'
      );
    } catch (reason) {
      setError(String(reason));
    }
  }
  async function extractToNote() {
    try {
      await session.flush();
      const markdown = buildPdfExtractNote(note.title, note.id, session.values());
      if (!markdown) {
        setError('还没有可提取的标注。');
        return;
      }
      const id = await store.createNote(note.folderId, `${note.title} · 摘录`);
      await store.saveNoteContent(id, markdown);
      onOpenNote(id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  async function downloadOriginal() {
    try {
      const attachments = await store.listNoteAttachments(note.id);
      const attachment = attachments.find(item => item.id === source.attachmentId);
      if (attachment) await downloadAttachment(attachment);
    } catch (reason) {
      setError(String(reason));
    }
  }
  const openNotes = store.navigation.openNoteTabs.flatMap(id =>
    store.serverData.notes.filter(item => item.id === id && !item.deleted)
  );
  const tabs: ReactNode = (
    <EditorTabs
      notes={openNotes}
      activeNoteId={note.id}
      canWrite={canWrite}
      windowTitlebar={Boolean(titlebar.host)}
      onOpenNote={onOpenNote}
      onCloseNote={id => {
        const next = store.closeNoteTab(id);
        if (id === note.id) {
          if (next) onOpenNote(next);
          else navigate('/materials');
        }
      }}
      onCloseOtherNotes={store.closeOtherNoteTabs}
      onReorderNotes={store.reorderNoteTabs}
      onCopyTabPath={item => {
        void navigator.clipboard.writeText(item.title);
      }}
      onCreateNote={() => {
        void store.createNote(note.folderId, '未命名笔记').then(onOpenNote);
      }}
    />
  );
  return (
    <section
      className={styles.reader}
      data-knowra-pdf
      aria-label="PDF 阅读与标注"
      onKeyDown={event => {
        if (
          !(event.metaKey || event.ctrlKey) ||
          (event.target as Element).closest('input, textarea, [contenteditable="true"]')
        )
          return;
        const key = event.key.toLowerCase();
        if (key !== 'z' && !(event.ctrlKey && key === 'y')) return;
        event.preventDefault();
        event.stopPropagation();
        void moveHistory(event.shiftKey || key === 'y');
      }}
    >
      <style>{pdfViewerCss}</style>
      {titlebar.host ? createPortal(tabs, titlebar.host) : tabs}
      <div
        className={`${styles.feedback} ${session.error || error || viewer.error ? '' : styles.feedbackQuiet}`}
        role="status"
      >
        {session.busy
          ? '正在保存标注…'
          : session.drafts.size
            ? '有未保存标注'
            : loaded
              ? '标注已保存'
              : '正在加载标注…'}
        {session.error || error || viewer.error ? (
          <>
            <span role="alert">{session.error || error || viewer.error}</span>
            {session.errorCode === 'PDF_ANNOTATION_CONFLICT' ? (
              <Button size="mini" isDisabled={!canWrite} onPress={() => void reviewConflict()}>
                核对最新标注
              </Button>
            ) : null}
            {session.drafts.size ? (
              <>
                <Button size="mini" onPress={() => void flush()}>
                  重试保存
                </Button>
                <Button
                  size="mini"
                  variant="ghost"
                  onPress={() =>
                    downloadTextFile(
                      `${note.title}.PDF未保存标注.json`,
                      JSON.stringify(
                        { version: 1, sha256: source.sha256, drafts: [...session.drafts.values()] },
                        null,
                        2
                      ),
                      'application/json'
                    )
                  }
                >
                  导出未保存草稿
                </Button>
              </>
            ) : null}
            {viewer.error ? (
              <FileDropField
                label="恢复原 PDF"
                description="选择与原文件大小和校验值一致的 PDF。修订过的文件请重新导入为资料。"
                accept=".pdf,application/pdf"
                isDisabled={!canWrite}
                onSelect={files => {
                  const file = files[0];
                  if (file && canWrite)
                    void pdfRequest(pdfFileUrl(source.attachmentId), {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/pdf' },
                      body: file
                    })
                      .then(() => window.location.reload())
                      .catch(reason => setError(String(reason)));
                }}
              />
            ) : null}
          </>
        ) : null}
      </div>
      <div className={styles.workspace} data-panel-open={panel || undefined}>
        <div className={styles.stage}>
          <PdfReaderToolbar
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={() => void moveHistory()}
            onRedo={() => void moveHistory(true)}
            note={note}
            viewer={viewer}
            canWrite={canWrite}
            editable={editable}
            loaded={loaded}
            panel={panel && panelTab === 'marks'}
            outlineOpen={panel && panelTab === 'outline'}
            tool={tool}
            onBack={() => navigate('/materials')}
            onFavorite={async () => {
              try {
                await store.setNoteFavorite(note.id, !note.favorite);
              } catch (reason) {
                setError(String(reason));
              }
            }}
            onOutline={() => {
              setPanel(panel && panelTab === 'outline' ? false : true);
              setPanelTab('outline');
            }}
            onDownload={downloadOriginal}
            onExport={exportExcerpt}
            onExtract={extractToNote}
            onPanel={() => {
              setPanel(panel && panelTab === 'marks' ? false : true);
              setPanelTab('marks');
            }}
            onTool={next => {
              setAnnotationAction(null);
              setCommentEditor(null);
              setDictionary(null);
              setTool(next);
              setPending(null);
              setGhost(null);
            }}
          />
          <div
            ref={viewer.containerRef}
            className={styles.viewport}
            data-region-tool={tool === 'region' || undefined}
            data-note-tool={tool === 'note' || undefined}
            aria-label="PDF 页面"
            tabIndex={0}
            onPointerDown={pointerDown}
            onPointerMove={event => {
              const move = noteDrag.current;
              if (move) {
                const dx = event.clientX - move.x,
                  dy = event.clientY - move.y;
                if (!move.moved && Math.hypot(dx, dy) < 4) return;
                const geo = pageGeometry(move.pageIndex);
                if (!geo) return;
                move.moved = true;
                move.last = { pageIndex: move.pageIndex, rect: moveRect(geo.viewport, geo.bounds, move.rect, dx, dy) };
                setNoteMove({ id: move.id, segment: move.last });
                return;
              }
              if (drag.current) setGhost(dragSegment(event));
            }}
            onPointerCancel={() => {
              annotationPress.current = null;
              noteDrag.current = null;
              setNoteMove(null);
              drag.current = null;
              setGhost(null);
            }}
            onPointerUp={event => {
              const press = annotationPress.current;
              annotationPress.current = null;
              if (
                press &&
                Math.hypot(event.clientX - press.x, event.clientY - press.y) < 4 &&
                event.target instanceof Element &&
                pdfAnnotationAtPoint(event.target, event.clientX, event.clientY) === press.id &&
                window.getSelection()?.isCollapsed !== false
              ) {
                skipTextMouseUp.current = true;
                syncScrollPosition(event.currentTarget);
                setSelected(press.id);
                setPending(null);
                setAnnotationAction({ id: press.id, x: event.clientX, y: event.clientY + 12 });
                return;
              }
              const move = noteDrag.current;
              if (move) {
                noteDrag.current = null;
                setNoteMove(null);
                if (move.moved && move.last) change(move.id, { segments: [move.last] });
                return;
              }
              if (drag.current) {
                const segment = dragSegment(event);
                drag.current = null;
                setGhost(segment);
                if (segment)
                  setPending({
                    value: { type: 'region', segments: [segment], quoteText: '' },
                    anchor: { x: event.clientX, top: event.clientY, bottom: event.clientY }
                  });
              }
            }}
            onMouseUp={() => {
              if (skipTextMouseUp.current) {
                skipTextMouseUp.current = false;
                return;
              }
              if (tool !== 'text' || !viewer.viewerRef.current) return;
              const value = readPdfSelection(viewer.viewerRef.current, viewer.containerRef.current!);
              const anchor = value && textAnchor();
              setPending(value && anchor ? { value, anchor } : null);
              if (!value) setGhost(null);
            }}
            onDoubleClick={event => {
              if (
                tool !== 'text' ||
                !viewer.viewerRef.current ||
                !(event.target instanceof Element) ||
                !event.target.closest('.textLayer')
              )
                return;
              const value = readPdfSelection(viewer.viewerRef.current, viewer.containerRef.current!);
              const anchor = value && textAnchor();
              if (!value || !anchor || !normalizeDictionaryWord(value.quoteText)) return;
              setAnnotationAction(null);
              setCommentEditor(null);
              setPending(null);
              setDictionary({ value, anchor });
            }}
            onScroll={event => {
              // 布局调整的 scroll 事件可能晚于标注点击派发；当前位置没变时，浮层仍有效。
              if (!syncScrollPosition(event.currentTarget)) return;
              setAnnotationAction(null);
              setCommentEditor(null);
              setDictionary(null);
              if (cardOpen) render(value => value + 1);
              // 文字选区随滚动重新定位；框选的位置无法回算，滚动即收起。
              setPending(current => {
                if (!current) return current;
                if (current.value.type === 'region') {
                  setGhost(null);
                  return null;
                }
                const anchor = textAnchor();
                return anchor ? { ...current, anchor } : null;
              });
            }}
            onKeyDown={event => {
              if (event.key !== 'Escape') return;
              setAnnotationAction(null);
              setDictionary(null);
              setCardOpen(false);
              setSelected(null);
              if (pending) {
                setPending(null);
                setGhost(null);
              }
            }}
          >
            <div className="pdfViewer" />
          </div>
          <PdfPageBar viewer={viewer} />
          <PdfAnnotationTooltip
            containerRef={viewer.containerRef}
            items={items}
            enabled={tool === 'text' && !pending && !dictionary && !cardOpen && !annotationAction && !commentEditor}
            revision={viewer.revision}
          />
          {actionItem && annotationAction ? (
            <PdfAnnotationActions
              item={actionItem}
              point={annotationAction}
              canWrite={editable}
              onEdit={() => {
                setCommentEditor(annotationAction);
                setAnnotationAction(null);
              }}
              onClose={() => {
                setAnnotationAction(null);
                setSelected(null);
              }}
              onCopy={() => {
                void writeClipboardText(actionItem.quoteText)
                  .then(copied => {
                    if (copied) setAnnotationAction(null);
                    else setError('复制失败，请重试或从标注面板选择原文复制。');
                  })
                  .catch(() => setError('复制失败，请重试或从标注面板选择原文复制。'));
              }}
              onKind={kind => {
                change(actionItem.id, { kind });
                setAnnotationAction(null);
              }}
              onDelete={() => {
                change(actionItem.id, {}, true);
                setSelected(null);
                setAnnotationAction(null);
              }}
            />
          ) : null}
          {editingItem && commentEditor ? (
            <PdfCommentEditor
              item={editingItem}
              point={commentEditor}
              canWrite={editable}
              onChange={comment => change(editingItem.id, { comment })}
              onClose={() => {
                setCommentEditor(null);
                setSelected(null);
              }}
            />
          ) : null}
          {cardItem && cardAnchor && !noteMove ? (
            <PdfNoteCard
              left={cardAnchor.left}
              top={cardAnchor.top}
              value={cardItem.comment}
              disabled={!editable}
              onChange={comment => change(cardItem.id, { comment })}
              onDelete={() => {
                setCardOpen(false);
                setSelected(null);
                change(cardItem.id, {}, true);
              }}
            />
          ) : null}
          {dictionary ? (
            <PdfDictionaryPopover
              text={dictionary.value.quoteText}
              anchor={dictionary.anchor}
              canSave={editable}
              onSave={saveDictionary}
              onClose={() => setDictionary(null)}
            />
          ) : null}
          {pending && (editable || canLookup) ? (
            <PdfSelectionBar
              anchor={pending.anchor}
              mode={isTextSelection ? textMode : undefined}
              onMode={isTextSelection ? setTextMode : undefined}
              canAnnotate={editable}
              onLookup={
                canLookup
                  ? () => {
                      setDictionary(pending);
                      setPending(null);
                      setAnnotationAction(null);
                    }
                  : undefined
              }
              onPick={kind => createMark(isTextSelection ? { ...pending.value, type: textMode } : pending.value, kind)}
            />
          ) : null}
        </div>
        {panel ? (
          <PdfSidePanel
            tab={panelTab}
            onTab={setPanelTab}
            onClose={() => setPanel(false)}
            items={items}
            outline={outline}
            selected={selected}
            canWrite={editable}
            onSelect={jump}
            onChange={change}
            onDelete={id => change(id, {}, true)}
            onOutlineItem={item => {
              if (item.dest) void viewer.linkRef.current?.goToDestination(item.dest as string);
            }}
          />
        ) : null}
      </div>
      {viewer.passwordRequest ? (
        <Dialog
          title="解锁 PDF"
          isOpen
          onOpenChange={open => {
            if (!open) navigate('/materials');
          }}
        >
          <DialogBody>
            {viewer.passwordRequest.wrong ? <p role="alert">密码不正确，请重新输入。</p> : null}
            <TextField label="PDF 密码" type="password" value={password} onChange={setPassword} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onPress={() => navigate('/materials')}>
              取消
            </Button>
            <Button
              onPress={() => {
                viewer.passwordRequest?.update(password);
                setPassword('');
                viewer.setPasswordRequest(null);
              }}
            >
              解锁
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
      {review ? (
        <PdfConflictDialog
          review={review}
          onClose={() => setReview(null)}
          onResolve={keepLocal => {
            if (!canWrite) return;
            void session
              .reconcile(review.draft.id, review.remote, keepLocal)
              .then(id => {
                history.clear();
                setSelected(id);
                setReview(null);
                return flush();
              })
              .catch(reason => setError(String(reason)));
          }}
        />
      ) : null}
      {saveDialog ? (
        <Dialog title="有未保存的 PDF 标注" isOpen onOpenChange={setSaveDialog}>
          <DialogBody>
            <p>请先保存标注。保存失败时，草稿会保留在当前资料库。</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onPress={() => setSaveDialog(false)}>
              继续阅读
            </Button>
            <Button
              onPress={() =>
                void session
                  .flush()
                  .then(() => setSaveDialog(false))
                  .catch(reason => setError(String(reason)))
              }
            >
              保存标注
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </section>
  );
}
