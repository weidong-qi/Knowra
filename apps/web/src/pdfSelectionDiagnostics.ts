import { pdfjs, PDFViewer } from './features/pdf/pdfRuntime';

// 仅供隔离诊断分支读取同一份 PDF.js 实例；不进入正式分支。
Object.assign(window, { __knowraPdfSelectionDiagnostics: { pdfjs, PDFViewer } });
