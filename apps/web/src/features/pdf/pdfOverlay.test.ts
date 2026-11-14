import { pdfAnnotationAtPoint, pdfAnnotationsAtPoint } from './pdfOverlay';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function page() {
  const element = document.createElement('div');
  element.className = 'page';
  element.innerHTML = '<span>正文</span><svg></svg>';
  document.body.append(element);
  return element;
}

function mark(element: HTMLElement, id: string, type = 'highlight', top = 10, bottom = 30) {
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.dataset.pdfAnnotationId = id;
  rect.dataset.type = type;
  vi.spyOn(rect, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 100, top, bottom } as DOMRect);
  element.querySelector('svg')!.append(rect);
}

it('收集同页全部命中，按绘制层级逆序排列，悬停仍取第一条', () => {
  const element = page();
  mark(element, 'highlight');
  mark(element, 'region', 'region');
  mark(element, 'note', 'note');
  mark(page(), 'other-page');
  expect(pdfAnnotationsAtPoint(element.querySelector('span')!, 20, 20)).toEqual(['note', 'region', 'highlight']);
  expect(pdfAnnotationAtPoint(element, 20, 20)).toBe('note');
});

it('同一条标注的多个片段、下划线命中区与细线只出现一次，独立标注不合并', () => {
  const element = page();
  mark(element, 'same-text-1');
  mark(element, 'same-text-2');
  mark(element, 'line', 'hit-area');
  mark(element, 'line', 'underline', 29, 30);
  mark(element, 'same-text-1');
  expect(pdfAnnotationsAtPoint(element, 20, 29)).toEqual(['same-text-1', 'line', 'same-text-2']);
});

it('保留下划线细线的命中容差，不把未命中的片段或其他页面纳入', () => {
  const element = page();
  mark(element, 'highlight');
  mark(element, 'line', 'underline', 29, 30);
  expect(pdfAnnotationsAtPoint(element, 20, 32)).toEqual(['line']);
  expect(pdfAnnotationsAtPoint(element, 20, 34)).toEqual([]);
  expect(pdfAnnotationsAtPoint(element, 101, 20)).toEqual([]);
  expect(pdfAnnotationsAtPoint(document.body, 20, 20)).toEqual([]);
  expect(pdfAnnotationAtPoint(element, 200, 200)).toBeNull();
});
