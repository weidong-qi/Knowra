import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { EventBus, PDFViewer, PDFLinkService, PDFFindController } from 'pdfjs-dist/web/pdf_viewer.mjs';
import viewerCss from 'pdfjs-dist/web/pdf_viewer.css?inline';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs, EventBus, PDFViewer, PDFLinkService, PDFFindController };
export const pdfViewerCss = `@scope ([data-knowra-pdf]) { ${viewerCss.replaceAll(':root', ':scope')} }`;
export const pdfResourceOptions = {
  iccUrl: '/pdf-assets/iccs/',
  cMapUrl: '/pdf-assets/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdf-assets/standard_fonts/',
  wasmUrl: '/pdf-assets/wasm/'
};
