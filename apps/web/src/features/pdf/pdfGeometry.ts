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
            : item.quoteText
                .split('\n')
                .map(line => '> ' + line)
                .join('\n')
        }\n\n${item.comment}\n\n[${escape('回到知境原文')}](#/materials/notes/${encodeURIComponent(noteId)}?pdfAnnotation=${encodeURIComponent(item.id)})\n`;
      })
      .join('\n')
  );
}
export type PdfSelection = { type: 'highlight' | 'region'; segments: PdfSegment[]; quoteText: string };
