import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { PdfAnnotation, PdfSegment } from '@study-accelerator/shared/pdf';
import { noteRectOnPage, rectToViewport } from './pdfGeometry';

type Pointer = Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId'>;
type Drag = {
  id: string;
  start: Pointer;
  point: Pointer;
  container: HTMLDivElement;
  original: PdfSegment;
  last: PdfSegment;
  size: { width: number; height: number };
  grab: { x: number; y: number };
  moved: boolean;
};
const sameSegment = (a: PdfSegment, b: PdfSegment) =>
  a.pageIndex === b.pageIndex && a.rect.every((value, index) => Math.abs(value - b.rect[index]) < 0.001);
const inside = (point: Pointer, bounds: DOMRect) =>
  point.clientX >= bounds.left &&
  point.clientX <= bounds.right &&
  point.clientY >= bounds.top &&
  point.clientY <= bounds.bottom;

/** 边缘 56px 内逐渐加速，最大每秒 700px；只滚动阅读容器。 */
function edgeSpeed(value: number, start: number, end: number) {
  const edge = Math.min(56, (end - start) / 4);
  if (edge <= 0) return 0;
  if (value < start + edge) return -700 * (1 - (value - start) / edge);
  if (value > end - edge) return 700 * (1 - (end - value) / edge);
  return 0;
}

/** 便签拖动只更新预览，松开后把最终页码和坐标作为一次历史操作提交。 */
export function usePdfNoteDrag(
  viewerRef: RefObject<PDFViewer | null>,
  editable: boolean,
  onCommit: (id: string, segment: PdfSegment) => void
) {
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const previousTime = useRef<number | null>(null);
  const controls = useRef({ editable, onCommit });
  controls.current = { editable, onCommit };
  const [preview, setPreview] = useState<{ id: string; segment: PdfSegment } | null>(null);
  const cancel = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    previousTime.current = null;
    if (current?.container.hasPointerCapture?.(current.start.pointerId))
      current.container.releasePointerCapture(current.start.pointerId);
    setPreview(null);
  }, []);
  useEffect(() => {
    if (!editable) cancel();
  }, [editable, cancel]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', visibility);
      cancel();
    };
  }, [cancel]);

  function refresh() {
    const current = drag.current,
      viewer = viewerRef.current;
    if (!current?.moved || !controls.current.editable || !viewer) return;
    if (!inside(current.point, current.container.getBoundingClientRect())) return;
    // 指针已被容器捕获，不能用 event.target 判断目标页；按各页的实际纸面坐标命中。
    for (const canvas of current.container.querySelectorAll<HTMLElement>('.page .canvasWrapper')) {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height || !inside(current.point, bounds)) continue;
      const pageIndex = Number(canvas.closest<HTMLElement>('.page')?.dataset.pageNumber) - 1;
      const page = viewer.getPageView(pageIndex);
      if (!page?.viewport) continue;
      const segment = {
        pageIndex,
        rect: noteRectOnPage(page.viewport, bounds, current.size, current.grab, current.point)
      };
      if (!sameSegment(current.last, segment)) {
        current.last = segment;
        setPreview({ id: current.id, segment });
      }
      return;
    }
    // 页间空隙、尚未绘制的纸面和阅读区外保留最后一个有效落点。
  }
  function tick(time: number) {
    frame.current = 0;
    const current = drag.current;
    if (!current?.moved || !controls.current.editable) return;
    const container = current.container,
      bounds = container.getBoundingClientRect();
    if (!inside(current.point, bounds)) return;
    const seconds = Math.min(32, previousTime.current === null ? 16 : time - previousTime.current) / 1000;
    previousTime.current = time;
    const top = container.scrollTop,
      left = container.scrollLeft;
    container.scrollTop += edgeSpeed(current.point.clientY, bounds.top, bounds.bottom) * seconds;
    container.scrollLeft += edgeSpeed(current.point.clientX, bounds.left, bounds.right) * seconds;
    // 鼠标停在边缘时也持续回算位置，不能依赖新的 pointermove。
    refresh();
    if (top !== container.scrollTop || left !== container.scrollLeft) frame.current = requestAnimationFrame(tick);
  }
  function begin(event: PointerEvent<HTMLDivElement>, item: PdfAnnotation) {
    if (drag.current) return;
    const original = item.segments[0];
    const page = viewerRef.current?.getPageView(original.pageIndex);
    const canvas = (page?.div as HTMLElement | undefined)?.querySelector<HTMLElement>('.canvasWrapper');
    if (!canvas || !page?.viewport) return;
    const bounds = canvas.getBoundingClientRect(),
      box = rectToViewport(page.viewport, original.rect);
    if (!bounds.width || !bounds.height || !box.width || !box.height) return;
    const point = { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId };
    drag.current = {
      id: item.id,
      start: point,
      point,
      container: event.currentTarget,
      original,
      last: original,
      size: { width: original.rect[2] - original.rect[0], height: original.rect[3] - original.rect[1] },
      grab: {
        x:
          (event.clientX - bounds.left - (box.x * bounds.width) / page.viewport.width) /
          ((box.width * bounds.width) / page.viewport.width),
        y:
          (event.clientY - bounds.top - (box.y * bounds.height) / page.viewport.height) /
          ((box.height * bounds.height) / page.viewport.height)
      },
      moved: false
    };
    if (controls.current.editable) {
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  }
  function update(point: Pointer) {
    const current = drag.current;
    if (!current || point.pointerId !== current.start.pointerId) return false;
    current.point = { clientX: point.clientX, clientY: point.clientY, pointerId: point.pointerId };
    if (!controls.current.editable) return true;
    if (!current.moved && Math.hypot(point.clientX - current.start.clientX, point.clientY - current.start.clientY) < 4)
      return true;
    current.moved = true;
    refresh();
    if (!frame.current) {
      previousTime.current = null;
      frame.current = requestAnimationFrame(tick);
    }
    return true;
  }
  function finish(point: Pointer) {
    if (!update(point)) return null;
    const current = drag.current!;
    const clicked =
      !current.moved && Math.hypot(point.clientX - current.start.clientX, point.clientY - current.start.clientY) < 4;
    cancel();
    if (controls.current.editable && current.moved && !sameSegment(current.original, current.last))
      controls.current.onCommit(current.id, current.last);
    return { id: current.id, clicked };
  }
  return { preview, begin, update, finish, cancel, refresh };
}
