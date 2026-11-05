import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';

/** Chromium 将触控板捏合发送为 ctrl+wheel；只缩放 PDF，保持鼠标下的页面坐标不动。 */
export function attachPdfPinchZoom(container: HTMLElement, viewer: Pick<PDFViewer, 'pagesCount' | 'updateScale'>) {
  let frame = 0;
  let delta = 0;
  let origin = [0, 0];
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey || !viewer.pagesCount || !event.cancelable || event.defaultPrevented) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 30 : event.deltaMode === 2 ? container.clientHeight : 1;
    delta += event.deltaY * unit;
    origin = [event.clientX, event.clientY];
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      viewer.updateScale({
        scaleFactor: Math.exp(-Math.max(-100, Math.min(100, delta)) / 100),
        origin,
        drawingDelay: 100
      });
      delta = 0;
    });
  };
  container.addEventListener('wheel', wheel, { passive: false });
  return () => {
    container.removeEventListener('wheel', wheel);
    if (frame) cancelAnimationFrame(frame);
  };
}
