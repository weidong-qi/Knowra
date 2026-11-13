import type { PdfAnnotation, PdfSegment } from '@study-accelerator/shared/pdf';
export interface PdfViewport {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}
export function rectToPdf(
  viewport: PdfViewport,
  bounds: { left: number; top: number; width: number; height: number },
  rect: { left: number; top: number; right: number; bottom: number }
): [number, number, number, number] {
  const point = (x: number, y: number) =>
    viewport.convertToPdfPoint(
      ((x - bounds.left) * viewport.width) / bounds.width,
      ((y - bounds.top) * viewport.height) / bounds.height
    );
  const a = point(rect.left, rect.top),
    b = point(rect.right, rect.bottom);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}
export function rectToViewport(viewport: PdfViewport, rect: number[]) {
  const r = [
    ...viewport.convertToViewportPoint(rect[0], rect[1]),
    ...viewport.convertToViewportPoint(rect[2], rect[3])
  ];
  return {
    x: Math.min(r[0], r[2]),
    y: Math.min(r[1], r[3]),
    width: Math.abs(r[2] - r[0]),
    height: Math.abs(r[3] - r[1])
  };
}
/** 合并同页同一行的相邻文字片段，填平空格及大小写字形之间的缝隙；不跨行、跨栏。 */
export function mergePdfTextSegments(segments: PdfSegment[]): PdfSegment[] {
  const lines: PdfSegment[][] = [];
  for (const segment of [...segments].sort((a, b) => a.pageIndex - b.pageIndex || b.rect[3] - a.rect[3])) {
    const [left, bottom, right, top] = segment.rect;
    const height = top - bottom;
    const line = lines.find(([first]) => {
      if (first.pageIndex !== segment.pageIndex) return false;
      const [, baseBottom, , baseTop] = first.rect;
      const baseHeight = baseTop - baseBottom;
      return (
        Math.min(top, baseTop) - Math.max(bottom, baseBottom) >= Math.min(height, baseHeight) * 0.7 &&
        Math.abs(top + bottom - baseTop - baseBottom) <= Math.max(height, baseHeight) * 0.7
      );
    });
    const copy = { pageIndex: segment.pageIndex, rect: [left, bottom, right, top] as PdfSegment['rect'] };
    if (line) line.push(copy);
    else lines.push([copy]);
  }
  return lines.flatMap(line => {
    const merged: PdfSegment[] = [];
    for (const segment of line.sort((a, b) => a.rect[0] - b.rect[0])) {
      const previous = merged.at(-1);
      if (
        previous &&
        segment.rect[0] - previous.rect[2] <=
          Math.min(previous.rect[3] - previous.rect[1], segment.rect[3] - segment.rect[1]) * 0.6
      ) {
        previous.rect = [
          previous.rect[0],
          Math.min(previous.rect[1], segment.rect[1]),
          Math.max(previous.rect[2], segment.rect[2]),
          Math.max(previous.rect[3], segment.rect[3])
        ];
      } else merged.push(segment);
    }
    return merged;
  });
}
export function sortPdfAnnotations(items: PdfAnnotation[]) {
  return [...items].sort(
    (a, b) =>
      a.segments[0].pageIndex - b.segments[0].pageIndex ||
      b.segments[0].rect[3] - a.segments[0].rect[3] ||
      a.segments[0].rect[0] - b.segments[0].rect[0]
  );
}
export function exportPdfExcerpt(title: string, noteId: string, items: PdfAnnotation[]) {
  const escape = (value: string) =>
    value.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]').replace(/\r?\n/g, ' ');
  return (
    `# ${title.replace(/\r?\n/g, ' ')} · PDF 标注\n\n` +
    sortPdfAnnotations(items)
      .map(item => {
        const pages = [...new Set(item.segments.map(segment => segment.pageIndex + 1))].join('、');
        return `## 第 ${pages} 页\n\n${
          item.type === 'region'
            ? '区域标注'
            : item.type === 'note'
              ? escape(item.title?.trim() || '便签')
              : item.quoteText
                  .split('\n')
                  .map(line => '> ' + line)
                  .join('\n')
        }\n\n${item.comment}\n\n[${escape('回到知境原文')}](#/materials/notes/${encodeURIComponent(noteId)}?pdfAnnotation=${encodeURIComponent(item.id)})\n`;
      })
      .join('\n')
  );
}
/** 便签图标的边长，单位为 PDF 页面坐标；随缩放等比变化。 */
export const PDF_NOTE_SIZE = 18;
type PageBounds = { left: number; top: number; width: number; height: number };
type ScaledViewport = PdfViewport & { scale: number };
/** 以点击位置为中心放置便签图标，返回其 PDF 坐标矩形。 */
export function noteRectAt(viewport: ScaledViewport, bounds: PageBounds, x: number, y: number) {
  const size = (PDF_NOTE_SIZE * viewport.scale * bounds.width) / viewport.width;
  return rectToPdf(viewport, bounds, {
    left: x - size / 2,
    top: y - size / 2,
    right: x + size / 2,
    bottom: y + size / 2
  });
}
/** 把便签按屏幕位移平移，并限制在页面内，返回新的 PDF 坐标矩形。 */
export function moveRect(viewport: PdfViewport, bounds: PageBounds, rect: number[], dx: number, dy: number) {
  const box = rectToViewport(viewport, rect);
  const kx = bounds.width / viewport.width,
    ky = bounds.height / viewport.height;
  const width = box.width * kx,
    height = box.height * ky;
  const left = Math.max(bounds.left, Math.min(bounds.left + bounds.width - width, bounds.left + box.x * kx + dx));
  const top = Math.max(bounds.top, Math.min(bounds.top + bounds.height - height, bounds.top + box.y * ky + dy));
  return rectToPdf(viewport, bounds, { left, top, right: left + width, bottom: top + height });
}
export type PdfSelection = {
  type: 'highlight' | 'underline' | 'region' | 'note';
  segments: PdfSegment[];
  quoteText: string;
};
