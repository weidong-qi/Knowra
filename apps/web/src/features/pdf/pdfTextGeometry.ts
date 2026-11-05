import type { PdfSegment } from '@study-accelerator/shared/pdf';
import { rectToPdf, type PdfViewport } from './pdfGeometry';

type TextBox = { rect: PdfSegment['rect']; ink: PdfSegment['rect']; baseline: number };
type Bounds = { left: number; top: number; width: number; height: number };

/** Range 的字框包含字体上下留白；按文字层同一字体的基线和字形度量收紧。 */
export function readPdfTextBoxes(viewport: PdfViewport, bounds: Bounds, layer: HTMLElement) {
  const context = document.createElement('canvas').getContext('2d');
  const boxes = new Map<Element, TextBox>();
  if (!context) return boxes;
  for (const span of layer.querySelectorAll<HTMLElement>('span[role="presentation"]')) {
    if (!span.textContent?.trim() || parseFloat(span.style.getPropertyValue('--rotate'))) continue;
    const style = getComputedStyle(span);
    context.font = `${style.fontStyle} ${style.fontWeight} 100px ${style.fontFamily}`;
    const metrics = context.measureText(span.textContent);
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = Math.abs(metrics.fontBoundingBoxDescent);
    if (!(ascent > 0) || !Number.isFinite(descent) || !(metrics.actualBoundingBoxAscent > 0)) continue;
    const rect = rectToPdf(viewport, bounds, span.getBoundingClientRect());
    const height = rect[3] - rect[1];
    const baseline = rect[3] - (height * ascent) / (ascent + descent);
    const ink: PdfSegment['rect'] = [
      rect[0],
      baseline - height * (Math.max(8, metrics.actualBoundingBoxDescent) / 100 + 0.02),
      rect[2],
      baseline + height * (metrics.actualBoundingBoxAscent / 100 + 0.03)
    ];
    boxes.set(span, { rect, ink, baseline });
  }
  return boxes;
}

/** 只收紧显示边界，兼容旧的逐字或整行字框，不改写已保存的标注坐标。 */
export function fitPdfTextSegments(segments: PdfSegment[], boxes: Iterable<TextBox>): PdfSegment[] {
  const text = [...boxes];
  return segments.map(segment => {
    const [left, bottom, right, top] = segment.rect;
    const candidates = text.filter(({ rect }) => {
      const overlap = Math.min(top, rect[3]) - Math.max(bottom, rect[1]);
      return (
        Math.min(right, rect[2]) - Math.max(left, rect[0]) > 0.5 &&
        overlap > Math.min(top - bottom, rect[3] - rect[1]) * 0.6
      );
    });
    // 旧字框可能碰到邻行；用最接近字框中心的基线对应行，排除邻行。
    candidates.sort(
      (a, b) => Math.abs(a.rect[1] + a.rect[3] - bottom - top) - Math.abs(b.rect[1] + b.rect[3] - bottom - top)
    );
    const first = candidates[0];
    if (!first) return segment;
    const line = candidates.filter(
      box => Math.abs(box.baseline - first.baseline) < Math.max(box.rect[3] - box.rect[1], top - bottom) * 0.2
    );
    const fittedBottom = Math.max(bottom, Math.min(...line.map(box => box.ink[1])));
    const fittedTop = Math.min(top, Math.max(...line.map(box => box.ink[3])));
    return fittedBottom < fittedTop ? { ...segment, rect: [left, fittedBottom, right, fittedTop] } : segment;
  });
}
