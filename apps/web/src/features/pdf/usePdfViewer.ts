import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfjs, PDFViewer, EventBus, PDFLinkService, PDFFindController, pdfResourceOptions } from './pdfRuntime';
import { pdfFileUrl, pdfHeaders } from './pdfApi';
import { readRuntimeConfig } from '../../app/runtimeConfig';
import { attachPdfPinchZoom } from './pdfPinchZoom';

export function usePdfViewer(attachmentId: string, noteId: string, sha256: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const eventRef = useRef<EventBus | null>(null);
  const linkRef = useRef<PDFLinkService | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');
  const [passwordRequest, setPasswordRequest] = useState<{ update(value: string): void; wrong: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  // 后台页绘制只重画标注；真正的视口变化才让坐标浮层失效。
  const [viewportRevision, setViewportRevision] = useState(0);
  useEffect(() => {
    const container = containerRef.current!;
    const runtime = readRuntimeConfig();
    const key = `knowra:pdf-view:v1:${runtime.cacheSuffix}:${noteId}:${attachmentId}:${sha256}`;
    let position: { page?: number; scale?: string | number; rotation?: number; top?: number; left?: number } = {};
    try {
      position = JSON.parse(localStorage.getItem(key) ?? '{}');
    } catch {
      /* 使用默认阅读位置。 */
    }
    let location = { top: position.top, left: position.left };
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const bus = new EventBus();
    const links = new PDFLinkService({ eventBus: bus, externalLinkTarget: 2, externalLinkRel: 'noopener noreferrer' });
    const find = new PDFFindController({ eventBus: bus, linkService: links });
    const viewer = new PDFViewer({
      container,
      viewer: container.querySelector<HTMLDivElement>('.pdfViewer')!,
      eventBus: bus,
      linkService: links,
      findController: find,
      imageResourcesPath: '/pdf-assets/images/',
      annotationMode: 1,
      annotationEditorMode: -1,
      removePageBorders: true
    });
    viewerRef.current = viewer;
    const detachPinchZoom = attachPdfPinchZoom(container, viewer);
    eventRef.current = bus;
    linkRef.current = links;
    links.setViewer(viewer);
    function persist() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(
            key,
            JSON.stringify({
              page: viewer.currentPageNumber,
              scale: viewer.currentScaleValue,
              rotation: viewer.pagesRotation,
              ...location
            })
          );
        } catch {
          /* 阅读位置失败不影响标注保存。 */
        }
      }, 250);
    }
    bus.on('pagesinit', () => {
      if (!active) return;
      if ([0, 90, 180, 270].includes(position.rotation ?? -1)) viewer.pagesRotation = position.rotation!;
      viewer.currentScaleValue = position.scale ? String(position.scale) : 'page-width';
      if (position.page && position.page <= viewer.pagesCount) viewer.currentPageNumber = position.page;
      if (position.top !== undefined)
        viewer.scrollPageIntoView({
          pageNumber: viewer.currentPageNumber,
          destArray: [null, { name: 'XYZ' }, position.left ?? 0, position.top, null]
        });
      setCount(viewer.pagesCount);
      setRevision(value => value + 1);
    });
    bus.on('updateviewarea', (event: { location: { top: number; left: number } }) => {
      location = { top: event.location.top, left: event.location.left };
      persist();
    });
    const resize = new ResizeObserver(() => {
      if (!active || !viewer.pagesCount) return;
      const preset = viewer.currentScaleValue;
      if (['page-width', 'page-fit', 'auto'].includes(preset)) {
        const anchor = { ...location };
        viewer.currentScaleValue = preset;
        viewer.scrollPageIntoView({
          pageNumber: viewer.currentPageNumber,
          destArray: [null, { name: 'XYZ' }, anchor.left ?? 0, anchor.top ?? null, null]
        });
      }
      viewer.update();
    });
    resize.observe(container);
    bus.on('pagechanging', (event: { pageNumber: number }) => {
      if (!active) return;
      setPage(event.pageNumber);
      setViewportRevision(value => value + 1);
      persist();
    });
    for (const name of ['pagerendered', 'textlayerrendered'])
      bus.on(name, () => {
        if (active) setRevision(value => value + 1);
      });
    for (const name of ['scalechanging', 'rotationchanging'])
      bus.on(name, () => {
        if (!active) return;
        setRevision(value => value + 1);
        setViewportRevision(value => value + 1);
        persist();
      });
    const loading = pdfjs.getDocument({
      url: pdfFileUrl(attachmentId),
      httpHeaders: pdfHeaders(),
      withCredentials: true,
      ...pdfResourceOptions
    });
    loading.onPassword = (update: (password: string) => void, reason: number) => {
      if (active) setPasswordRequest({ update, wrong: reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD });
    };
    void loading.promise
      .then(pdf => {
        if (!active) return;
        viewer.setDocument(pdf);
        links.setDocument(pdf);
        setDocument(pdf);
        setError('');
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'PDF 无法读取');
      });
    return () => {
      active = false;
      detachPinchZoom();
      clearTimeout(timer);
      resize.disconnect();
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            page: viewer.currentPageNumber,
            scale: viewer.currentScaleValue,
            rotation: viewer.pagesRotation,
            ...location
          })
        );
      } catch {
        /* 使用默认位置。 */
      }
      viewer.setDocument(null);
      links.setDocument(null);
      void loading.destroy();
      viewerRef.current = null;
      eventRef.current = null;
      linkRef.current = null;
    };
  }, [attachmentId, noteId, sha256]);
  return {
    containerRef,
    viewerRef,
    eventRef,
    linkRef,
    document,
    page,
    count,
    error,
    passwordRequest,
    setPasswordRequest,
    revision,
    viewportRevision
  };
}
