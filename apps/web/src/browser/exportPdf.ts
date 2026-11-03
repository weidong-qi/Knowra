import { buildExportFileName } from '@study-accelerator/web-core';

const PDF_SCALE = 2;
const JPEG_QUALITY = 0.92;

export async function exportElementToPdf(element: HTMLElement, title: string): Promise<string> {
  await document.fonts?.ready;
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf')
  ]);
  const backgroundColor = getComputedStyle(element).backgroundColor;
  const canvas = await html2canvas(element, {
    scale: PDF_SCALE,
    useCORS: true,
    logging: false,
    backgroundColor,
    onclone(clonedDocument) {
      clonedDocument.querySelectorAll('[data-pdf-exclude]').forEach((node) => node.remove());
      // 正在编辑的公式只导出渲染结果，不带出 LaTeX 源码框。
      clonedDocument.querySelectorAll('.math-editing').forEach((node) => node.classList.remove('math-editing'));
      const clonedPaper = clonedDocument.querySelector<HTMLElement>('[data-pdf-document]');
      if (clonedPaper) {
        clonedPaper.style.margin = '0';
        clonedPaper.style.border = '0';
        clonedPaper.style.boxShadow = 'none';
      }
    }
  });
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pagePixelHeight = Math.max(1, Math.floor(canvas.width * pageHeight / pageWidth));
  const pageCount = Math.ceil(canvas.height / pagePixelHeight);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const sourceY = pageIndex * pagePixelHeight;
    const sourceHeight = Math.min(pagePixelHeight, canvas.height - sourceY);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = sourceHeight;
    const context = pageCanvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建 PDF 画布');
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, canvas.width, sourceHeight);
    if (pageIndex > 0) pdf.addPage();
    const renderedHeight = pageWidth * sourceHeight / canvas.width;
    pdf.addImage(pageCanvas.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', 0, 0, pageWidth, renderedHeight);
  }

  const fileName = buildExportFileName(title, 'pdf');
  pdf.save(fileName);
  return fileName;
}
