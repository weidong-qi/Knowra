import type { FloatingBounds, FloatingPoint } from '../../components/ui/overlay/floatingPanelGeometry';

type Rect = { left: number; right: number; top: number; bottom: number };
const clamp = (value: number, start: number, end: number) => Math.max(start, Math.min(value, end));

/** 使用实际绘制节点，自动兼容 PDF 的缩放、旋转、多行及延迟渲染。 */
export function visibleAnnotationRects(container: HTMLElement | null, id: string): Rect[] {
  if (!container) return [];
  const bounds = container.getBoundingClientRect();
  return [...container.querySelectorAll<SVGElement>('[data-pdf-annotation-id]')].flatMap(mark => {
    if (mark.dataset.pdfAnnotationId !== id) return [];
    const rect = mark.getBoundingClientRect();
    const clipped = {
      left: Math.max(rect.left, bounds.left),
      right: Math.min(rect.right, bounds.right),
      top: Math.max(rect.top, bounds.top),
      bottom: Math.min(rect.bottom, bounds.bottom)
    };
    return clipped.right > clipped.left && clipped.bottom > clipped.top ? [clipped] : [];
  });
}

export function initialCommentPoint(container: HTMLElement | null, id: string, pointer?: FloatingPoint): FloatingPoint {
  const bounds = container?.getBoundingClientRect();
  if (pointer) return { x: pointer.x - (bounds?.left ?? 0), y: pointer.y - (bounds?.top ?? 0) + 8 };
  const rect = visibleAnnotationRects(container, id)[0];
  return rect && bounds ? { x: rect.right - bounds.left + 8, y: rect.top - bounds.top + 8 } : { x: 24, y: 48 };
}

/** 两个矩形最近边缘之间的短线；遮盖标注时不画零长或穿过窗口的线。 */
export function commentConnector(rects: Rect[], panel: Rect, bounds: FloatingBounds) {
  let best: { x1: number; y1: number; x2: number; y2: number; distance: number } | null = null;
  for (const rect of rects) {
    let x1 = clamp((panel.left + panel.right) / 2, rect.left, rect.right);
    let y1 = clamp((panel.top + panel.bottom) / 2, rect.top, rect.bottom);
    const x2 = clamp(x1, panel.left, panel.right),
      y2 = clamp(y1, panel.top, panel.bottom);
    x1 = clamp(x2, rect.left, rect.right);
    y1 = clamp(y2, rect.top, rect.bottom);
    const distance = Math.hypot(x2 - x1, y2 - y1);
    if (distance <= 1) return null;
    if (!best || distance < best.distance)
      best = { x1: x1 - bounds.left, y1: y1 - bounds.top, x2: x2 - bounds.left, y2: y2 - bounds.top, distance };
  }
  return best;
}
