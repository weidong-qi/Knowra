import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Note } from '@study-accelerator/web-core';
import type { PdfAnnotation, PdfSegment } from '@study-accelerator/shared/pdf';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  FileDropField,
  PressableButton,
  TextField
} from '../../components/ui';
import { useAppStore } from '../../store/AppStoreProvider';
import { useDesktopTitlebar } from '../../shell/DesktopTitlebarContext';
import { readRuntimeConfig } from '../../app/runtimeConfig';
import { registerDesktopSave } from '../../app/desktopLifecycle';
import { registerNavigationGuard } from '../../app/navigationGuard';
import { useNavigate, useLocation } from '../../app/router';
import { downloadTextFile } from '../../browser/downloadFile';
import { EditorTabs } from '../editor/EditorTabs';
import { downloadAttachment } from '../editor/attachmentAccess';
import { listPdfAnnotations, pdfFileUrl, pdfRequest, randomId } from './pdfApi';
import { usePdfViewer } from './usePdfViewer';
import { PdfConflictDialog, type PdfConflictReview } from './PdfConflictDialog';
import { PdfSession } from './pdfSession';
import { exportPdfExcerpt, rectToPdf, type PdfSelection } from './pdfGeometry';
import { paintPdfAnnotations, readPdfSelection } from './pdfOverlay';
import { PdfReaderToolbar } from './PdfReaderToolbar';
import { PdfAnnotationsPanel } from './PdfAnnotationsPanel';
import { pdfViewerCss } from './pdfRuntime';
import styles from './PdfReader.module.css';

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
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [tool, setTool] = useState('text'),
    [panel, setPanel] = useState(true);
  const [ghost, setGhost] = useState<PdfSegment | null>(null);
  const [password, setPassword] = useState('');
  const [outline, setOutline] = useState<Array<{ title: string; dest: unknown; depth: number }>>([]);
  const [showOutline, setShowOutline] = useState(false);
  const [saveDialog, setSaveDialog] = useState(false);
  const [review, setReview] = useState<PdfConflictReview | null>(null);
  const drag = useRef<{ index: number; x: number; y: number } | null>(null);
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
      () => permission.current && alive.current
    );
  }
  const session = sessionRef.current;
  const items = session.values();
  const editable = canWrite && loaded && Boolean(viewer.document);
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
    if (viewer.viewerRef.current) paintPdfAnnotations(viewer.viewerRef.current, items, selected, ghost);
  });
  const jump = useCallback(
    (item: PdfAnnotation) => {
      const first = item.segments[0],
        engine = viewer.viewerRef.current;
      if (!engine) return;
      if (first.pageIndex >= engine.pagesCount) {
        setError('标注页码不在当前 PDF 内，草稿与原文件均已保留。');
        return;
      }
      engine.scrollPageIntoView({
        pageNumber: first.pageIndex + 1,
        destArray: [null, { name: 'XYZ' }, first.rect[0], first.rect[3], null],
        allowNegativeOffset: false
      });
      setSelected(item.id);
      setPanel(true);
    },
    [viewer.viewerRef]
  );
  useEffect(() => {
    if (!loaded || !viewer.count) return;
    const id = new URLSearchParams(location.pathname.split('?')[1]).get('pdfAnnotation');
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
      const draft = session.drafts.values().next().value;
      if (draft) setReview({ draft, remote: latest.find(item => item.id === draft.id) ?? null });
    } catch (reason) {
      setError(String(reason));
    }
  }
  function change(id: string, fields: Partial<PdfAnnotation>, remove = false) {
    if (!editable) return;
    void session.stage(id, fields, remove).catch(reason => setError(String(reason)));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush();
    }, 450);
  }
  function createMark(value: PdfSelection) {
    if (!editable) return;
    if (value.segments.length > 2000 || value.quoteText.length > 100000) {
      setError('本次选区过长，请分成几条标注保存。');
      return;
    }
    const id = randomId();
    change(id, { ...value, kind: 'important', importance: 'normal', comment: '' });
    setSelected(id);
    setPanel(true);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (tool !== 'region' || !editable || event.button !== 0) return;
    const element = (event.target as Element).closest<HTMLElement>('.page');
    if (!element) return;
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
    <section className={styles.reader} data-knowra-pdf aria-label="PDF 阅读与标注">
      <style>{pdfViewerCss}</style>
      {titlebar.host ? createPortal(tabs, titlebar.host) : tabs}
      <div className={styles.feedback} role="status">
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
        {showOutline ? (
          <aside className={styles.outline} aria-label="PDF 目录">
            <h2>目录</h2>
            {outline.length ? (
              outline.map((item, index) => (
                <PressableButton
                  key={index}
                  className={styles.outlineItem}
                  style={{ paddingLeft: `${12 + item.depth * 12}px` }}
                  onPress={() => {
                    if (item.dest) void viewer.linkRef.current?.goToDestination(item.dest as string);
                  }}
                >
                  {item.title}
                </PressableButton>
              ))
            ) : (
              <p>这份 PDF 没有目录。</p>
            )}
          </aside>
        ) : null}
        <div className={styles.stage}>
          <PdfReaderToolbar
            note={note}
            viewer={viewer}
            canWrite={canWrite}
            editable={editable}
            loaded={loaded}
            panel={panel}
            outlineOpen={showOutline}
            tool={tool}
            selection={Boolean(selection)}
            onBack={() => navigate('/materials')}
            onFavorite={async () => {
              try {
                await store.setNoteFavorite(note.id, !note.favorite);
              } catch (reason) {
                setError(String(reason));
              }
            }}
            onOutline={() => setShowOutline(value => !value)}
            onDownload={downloadOriginal}
            onExport={exportExcerpt}
            onPanel={() => setPanel(value => !value)}
            onTool={setTool}
            onHighlight={() => {
              if (selection) createMark(selection);
            }}
          />
          <div
            ref={viewer.containerRef}
            className={styles.viewport}
            data-region-tool={tool === 'region' || undefined}
            aria-label="PDF 页面"
            tabIndex={0}
            onPointerDown={pointerDown}
            onPointerMove={event => {
              if (drag.current) setGhost(dragSegment(event));
            }}
            onPointerCancel={() => {
              drag.current = null;
              setGhost(null);
            }}
            onPointerUp={event => {
              if (drag.current) {
                const segment = dragSegment(event);
                drag.current = null;
                setGhost(null);
                if (segment) createMark({ type: 'region', segments: [segment], quoteText: '' });
              }
            }}
            onMouseUp={() => {
              if (tool === 'text' && viewer.viewerRef.current)
                setSelection(readPdfSelection(viewer.viewerRef.current, viewer.containerRef.current!));
            }}
          >
            <div className="pdfViewer" />
          </div>
        </div>
        {panel ? (
          <PdfAnnotationsPanel
            items={items}
            selected={selected}
            canWrite={editable}
            onSelect={jump}
            onChange={change}
            onDelete={id => change(id, {}, true)}
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
