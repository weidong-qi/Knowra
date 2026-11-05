import type { PdfAnnotation, PdfSegment } from '@study-accelerator/shared/pdf';
import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { mergePdfTextSegments, rectToPdf, rectToViewport, type PdfSelection } from './pdfGeometry';
import { fitPdfTextSegments, readPdfTextBoxes } from './pdfTextGeometry';

const NOTE_BUBBLE = 'M4 4h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-3 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z';
export function paintPdfAnnotations(
  viewer: PDFViewer,
  items: PdfAnnotation[],
  selected: string | null,
  ghost?: PdfSegment | null
) {
  for (const canvas of (viewer.container as HTMLElement).querySelectorAll<HTMLElement>('.page .canvasWrapper')) {
    const index = Number(canvas.closest<HTMLElement>('.page')?.dataset.pageNumber) - 1;
    const page = viewer.getPageView(index);
    if (!canvas || !page.viewport) continue;
    canvas.querySelector('[data-knowra-pdf-overlay]')?.remove();
    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('data-knowra-pdf-overlay', '');
    overlay.setAttribute('viewBox', `0 0 ${page.viewport.width} ${page.viewport.height}`);
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '3'
    });
    const layer = (page.div as HTMLElement).querySelector<HTMLElement>('.textLayer');
    const hasTextMarks = items.some(
      item => (item.type === 'highlight' || item.type === 'underline') && item.segments.some(s => s.pageIndex === index)
    );
    const textBoxes =
      layer && hasTextMarks ? readPdfTextBoxes(page.viewport, canvas.getBoundingClientRect(), layer) : new Map();
    const segments = items.flatMap(item => {
      const pageSegments = item.segments.filter(segment => segment.pageIndex === index);
      const connected =
        item.type === 'highlight' || item.type === 'underline'
          ? mergePdfTextSegments(fitPdfTextSegments(pageSegments, textBoxes.values()))
          : pageSegments;
      return connected.map(segment => ({ segment, item }));
    });
    for (const { segment, item } of segments) {
      const box = rectToViewport(page.viewport, segment.rect);
      if (item.type === 'note') {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('data-note-id', item.id);
        group.setAttribute('data-pdf-annotation-id', item.id);
        group.setAttribute('data-kind', item.kind);
        if (selected === item.id) group.setAttribute('data-selected', '');
        group.setAttribute('transform', `translate(${box.x} ${box.y}) scale(${box.width / 18} ${box.height / 18})`);
        const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        for (const [key, value] of Object.entries({ x: 0, y: 0, width: 18, height: 18, rx: 3 }))
          body.setAttribute(key, String(value));
        const bubble = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        bubble.setAttribute('d', NOTE_BUBBLE);
        group.append(body, bubble);
        overlay.append(group);
        continue;
      }
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      for (const [key, value] of Object.entries(box)) rect.setAttribute(key, String(value));
      if (item.type === 'underline') {
        // 下划线只画选区底部的一条细线，沿用同一套分类色。
        const [left, bottom, right, top] = segment.rect;
        const thickness = Math.min(1.25, (top - bottom) / 8);
        const line = rectToViewport(page.viewport, [left, bottom, right, bottom + thickness]);
        for (const [key, value] of Object.entries(line)) rect.setAttribute(key, String(value));
        // 点击命中整段文字，而非只能点中底部两像素的细线。
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        for (const [key, value] of Object.entries(box)) hit.setAttribute(key, String(value));
        hit.setAttribute('data-pdf-annotation-id', item.id);
        hit.setAttribute('data-pdf-hit-area', '');
        if (selected === item.id) hit.setAttribute('data-selected', '');
        overlay.append(hit);
      }
      rect.setAttribute('data-kind', item.kind);
      rect.setAttribute('data-pdf-annotation-id', item.id);
      rect.setAttribute('data-type', item.type);
      if (selected === item.id) rect.setAttribute('data-selected', '');
      overlay.append(rect);
    }
    if (ghost?.pageIndex === index) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      for (const [key, value] of Object.entries(rectToViewport(page.viewport, ghost.rect)))
        rect.setAttribute(key, String(value));
      rect.setAttribute('data-type', 'region');
      overlay.append(rect);
    }
    canvas.append(overlay);
  }
}
export function readPdfSelection(viewer: PDFViewer, container: HTMLElement): PdfSelection | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !selection.toString().trim()) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const segments: PdfSegment[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < viewer.pagesCount; index++) {
    const page = viewer.getPageView(index);
    const canvas = (page.div as HTMLElement).querySelector<HTMLElement>('.canvasWrapper');
    const layer = (page.div as HTMLElement).querySelector<HTMLElement>('.textLayer');
    if (!canvas || !layer || !range.intersectsNode(layer)) continue;
    const bounds = canvas.getBoundingClientRect();
    const textBoxes = readPdfTextBoxes(page.viewport, bounds, layer);
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node) || !node.textContent?.trim()) continue;
      const fragment = document.createRange();
      fragment.selectNodeContents(node);
      if (range.startContainer === node) fragment.setStart(node, range.startOffset);
      if (range.endContainer === node) fragment.setEnd(node, range.endOffset);
      for (const rect of fragment.getClientRects()) {
        if (rect.width < 0.5 || rect.height < 0.5) continue;
        const original = { pageIndex: index, rect: rectToPdf(page.viewport, bounds, rect) };
        const box = node.parentElement && textBoxes.get(node.parentElement);
        const pdfRect = fitPdfTextSegments([original], box ? [box] : [])[0].rect;
        const key = `${index}:${pdfRect.map(value => Math.round(value * 100)).join(',')}`;
        if (!seen.has(key)) {
          segments.push({ pageIndex: index, rect: pdfRect });
          seen.add(key);
        }
      }
    }
  }
  return segments.length
    ? { type: 'highlight', segments: mergePdfTextSegments(segments), quoteText: selection.toString() }
    : null;
}

/** 文字层位于覆盖层上方，按实际绘制矩形命中批注，避免拦截原有文字拖选。 */
export function pdfAnnotationAtPoint(target: Element, x: number, y: number) {
  const marks = target.closest('.page')?.querySelectorAll<SVGElement>('[data-pdf-annotation-id]');
  if (!marks) return null;
  for (const mark of [...marks].reverse()) {
    const box = mark.getBoundingClientRect();
    const tolerance = mark.dataset.type === 'underline' ? 3 : 0;
    if (x >= box.left && x <= box.right && y >= box.top - tolerance && y <= box.bottom + tolerance)
      return mark.dataset.pdfAnnotationId ?? null;
  }
  return null;
}
