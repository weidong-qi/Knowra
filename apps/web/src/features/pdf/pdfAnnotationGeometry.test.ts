import { commentConnector, initialCommentPoint, visibleAnnotationRects } from './pdfAnnotationGeometry';

it('连接最近的可见片段与窗口边缘，不穿过输入框', () => {
  const bounds = { left: 10, top: 20, width: 900, height: 600 };
  const line = commentConnector(
    [
      { left: 20, right: 100, top: 50, bottom: 70 },
      { left: 20, right: 200, top: 100, bottom: 120 }
    ],
    { left: 250, right: 570, top: 130, bottom: 350 },
    bounds
  );
  expect(line).toMatchObject({ x1: 190, y1: 100, x2: 240, y2: 110 });
  expect(
    commentConnector(
      [
        { left: 20, right: 100, top: 50, bottom: 70 },
        { left: 250, right: 300, top: 150, bottom: 170 }
      ],
      { left: 240, right: 570, top: 130, bottom: 350 },
      bounds
    )
  ).toBeNull();
});

it('只读取目标标注的可见矩形，裁掉阅读区外部分', () => {
  const container = document.createElement('div');
  container.innerHTML = '<svg><rect data-pdf-annotation-id="a"/><rect data-pdf-annotation-id="b"/></svg>';
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    right: 500,
    top: 50,
    bottom: 400
  } as DOMRect);
  vi.spyOn(container.querySelector('rect')!, 'getBoundingClientRect').mockReturnValue({
    left: 80,
    right: 200,
    top: 40,
    bottom: 80
  } as DOMRect);
  expect(visibleAnnotationRects(container, 'a')).toEqual([{ left: 100, right: 200, top: 50, bottom: 80 }]);
  expect(initialCommentPoint(container, 'a')).toEqual({ x: 108, y: 8 });
  expect(initialCommentPoint(container, 'a', { x: 160, y: 100 })).toEqual({ x: 60, y: 58 });
});
