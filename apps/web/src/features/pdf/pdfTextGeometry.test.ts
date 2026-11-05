import type { PdfSegment } from '@study-accelerator/shared/pdf';
import { fitPdfTextSegments } from './pdfTextGeometry';

const text = [
  { rect: [10, 100, 60, 120], ink: [10, 104, 60, 118], baseline: 106 },
  { rect: [10, 82, 60, 102], ink: [10, 86, 60, 100], baseline: 88 }
] satisfies Parameters<typeof fitPdfTextSegments>[1];

it('收紧旧字框的上下留白，排除碰到的邻行，保留坐标数据', () => {
  const segments: PdfSegment[] = [
    { pageIndex: 0, rect: [15, 97, 50, 123] },
    { pageIndex: 0, rect: [15, 79, 50, 105] }
  ];
  const before = structuredClone(segments);
  expect(fitPdfTextSegments(segments, text)).toEqual([
    { pageIndex: 0, rect: [15, 104, 50, 118] },
    { pageIndex: 0, rect: [15, 86, 50, 100] }
  ]);
  expect(segments).toEqual(before);
});

it('不扩展已收紧的新标注，也不把其他栏的文字用于收紧', () => {
  const segments: PdfSegment[] = [
    { pageIndex: 0, rect: [15, 105, 50, 117] },
    { pageIndex: 0, rect: [100, 97, 150, 123] }
  ];
  expect(fitPdfTextSegments(segments, text)).toEqual(segments);
});

it('同一基线的大小写字形合用完整行高，不裁掉首字母', () => {
  const boxes = [
    { rect: [10, 100, 20, 120], ink: [10, 104, 20, 118], baseline: 106 },
    { rect: [20, 101, 60, 116], ink: [20, 104, 60, 114], baseline: 106 }
  ] satisfies Parameters<typeof fitPdfTextSegments>[1];
  expect(fitPdfTextSegments([{ pageIndex: 0, rect: [10, 97, 60, 123] }], boxes)).toEqual([
    { pageIndex: 0, rect: [10, 104, 60, 118] }
  ]);
});
