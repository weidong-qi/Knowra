import { rectToPdf, rectToViewport, exportPdfExcerpt } from './pdfGeometry';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
it('旋转后视口矩形回到同一 PDF 坐标，CSS 缩放和页面偏移不改变锚点', () => {
  const rotations = [
    {
      forward: (x: number, y: number) => [x * 2, 400 - y * 2],
      inverse: (x: number, y: number) => [x / 2, 200 - y / 2],
      width: 200,
      height: 400
    },
    {
      forward: (x: number, y: number) => [y * 2, x * 2],
      inverse: (x: number, y: number) => [y / 2, x / 2],
      width: 400,
      height: 200
    },
    {
      forward: (x: number, y: number) => [200 - x * 2, y * 2],
      inverse: (x: number, y: number) => [100 - x / 2, y / 2],
      width: 200,
      height: 400
    },
    {
      forward: (x: number, y: number) => [400 - y * 2, 200 - x * 2],
      inverse: (x: number, y: number) => [100 - y / 2, 200 - x / 2],
      width: 400,
      height: 200
    }
  ];
  for (const rotation of rotations) {
    const viewport = {
      width: rotation.width,
      height: rotation.height,
      convertToPdfPoint: rotation.inverse,
      convertToViewportPoint: rotation.forward
    };
    const source = [10, 20, 40, 60];
    const screen = rectToViewport(viewport, source);
    const rect = {
      left: 30 + screen.x * 0.75,
      top: 80 + screen.y * 0.75,
      right: 30 + (screen.x + screen.width) * 0.75,
      bottom: 80 + (screen.y + screen.height) * 0.75
    };
    expect(
      rectToPdf(viewport, { left: 30, top: 80, width: rotation.width * 0.75, height: rotation.height * 0.75 }, rect)
    ).toEqual(source);
  }
});
it('摘录按页码排序，区域不伪造正文并保留可回跳的标注身份', () => {
  const mark = (id: string, pageIndex: number, type: 'region' | 'highlight') =>
    ({
      id,
      type,
      segments: [{ pageIndex, rect: [1, 2, 3, 4] }],
      quoteText: '真实选区',
      comment: '评论'
    }) as PdfAnnotation;
  const result = exportPdfExcerpt('合成资料', 'pdf-note', [mark('second', 1, 'region'), mark('first', 0, 'highlight')]);
  expect(result.indexOf('第 1 页')).toBeLessThan(result.indexOf('第 2 页'));
  expect(result).toContain('> 真实选区');
  expect(result).toContain('区域标注');
  expect(result).toContain('pdfAnnotation=second');
});
