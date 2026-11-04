import type { PdfAnnotation, PdfSegment } from '@study-accelerator/shared/pdf';
import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { rectToPdf, rectToViewport, type PdfSelection } from './pdfGeometry';

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
    const segments = items.flatMap(item =>
      item.segments.filter(segment => segment.pageIndex === index).map(segment => ({ segment, item }))
    );
    for (const { segment, item } of segments) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const box = rectToViewport(page.viewport, segment.rect);
      for (const [key, value] of Object.entries(box)) rect.setAttribute(key, String(value));
      rect.setAttribute('data-kind', item.kind);
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
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node) || !node.textContent?.trim()) continue;
      const fragment = document.createRange();
      fragment.selectNodeContents(node);
      if (range.startContainer === node) fragment.setStart(node, range.startOffset);
      if (range.endContainer === node) fragment.setEnd(node, range.endOffset);
      for (const rect of fragment.getClientRects()) {
        if (rect.width < 0.5 || rect.height < 0.5) continue;
        const pdfRect = rectToPdf(page.viewport, bounds, rect);
        const key = `${index}:${pdfRect.map(value => Math.round(value * 100)).join(',')}`;
        if (!seen.has(key)) {
          segments.push({ pageIndex: index, rect: pdfRect });
          seen.add(key);
        }
      }
    }
  }
  return segments.length ? { type: 'highlight', segments, quoteText: selection.toString() } : null;
}
