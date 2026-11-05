import {
  rectToPdf,
  rectToViewport,
  exportPdfExcerpt,
  noteRectAt,
  moveRect,
  PDF_NOTE_SIZE,
  mergePdfTextSegments
} from './pdfGeometry';
import type { PdfAnnotation, PdfSegment } from '@study-accelerator/shared/pdf';
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

describe('便签几何', () => {
  const viewport = {
    width: 200,
    height: 300,
    scale: 1,
    convertToPdfPoint: (x: number, y: number) => [x, 300 - y],
    convertToViewportPoint: (x: number, y: number) => [x, 300 - y]
  };
  const bounds = { left: 100, top: 50, width: 200, height: 300 };
  it('以点击位置为中心放置固定大小的图标', () => {
    const rect = noteRectAt(viewport, bounds, 200, 200);
    expect(rect[2] - rect[0]).toBeCloseTo(PDF_NOTE_SIZE);
    expect(rect[3] - rect[1]).toBeCloseTo(PDF_NOTE_SIZE);
    expect((rect[0] + rect[2]) / 2).toBeCloseTo(100);
  });
  it('按屏幕位移平移并限制在页面内', () => {
    const rect = noteRectAt(viewport, bounds, 200, 200);
    const moved = moveRect(viewport, bounds, rect, 30, -20);
    expect(moved[0] - rect[0]).toBeCloseTo(30);
    expect(moved[1] - rect[1]).toBeCloseTo(20);
    const clamped = moveRect(viewport, bounds, rect, -9999, -9999);
    expect(clamped[0]).toBeCloseTo(0);
    expect(clamped[3]).toBeCloseTo(300);
  });
});

describe('连续文字标注', () => {
  it('连接同一行的空格和大小写字形，保留原始片段不变', () => {
    const segments: PdfSegment[] = [
      { pageIndex: 0, rect: [10, 100, 18, 120] },
      { pageIndex: 0, rect: [18, 100, 55, 115] },
      { pageIndex: 0, rect: [61, 100, 72, 120] },
      { pageIndex: 0, rect: [72, 100, 140, 115] }
    ];
    const before = JSON.stringify(segments);
    expect(mergePdfTextSegments(segments)).toEqual([{ pageIndex: 0, rect: [10, 100, 140, 120] }]);
    expect(JSON.stringify(segments)).toBe(before);
  });
  it('不跨行、跨栏、跨页或把上标合进正文', () => {
    const segments: PdfSegment[] = [
      { pageIndex: 0, rect: [10, 100, 60, 120] },
      { pageIndex: 0, rect: [140, 100, 190, 120] },
      { pageIndex: 0, rect: [10, 75, 60, 95] },
      { pageIndex: 0, rect: [60, 119, 67, 128] },
      { pageIndex: 1, rect: [10, 100, 60, 120] }
    ];
    expect(mergePdfTextSegments(segments)).toHaveLength(5);
  });
});
