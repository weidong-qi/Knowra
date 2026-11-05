import { attachPdfPinchZoom } from './pdfPinchZoom';

afterEach(() => vi.unstubAllGlobals());

it('合并一帧内的捏合事件，按鼠标位置缩放；普通双指滚动不受拦截', () => {
  let draw: FrameRequestCallback | undefined;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(callback => {
      draw = callback;
      return 1;
    })
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const container = document.createElement('div');
  const viewer = { pagesCount: 2, updateScale: vi.fn() };
  const detach = attachPdfPinchZoom(container, viewer);
  const scroll = new WheelEvent('wheel', { deltaY: 80, cancelable: true });
  container.dispatchEvent(scroll);
  expect(scroll.defaultPrevented).toBe(false);
  expect(draw).toBeUndefined();
  for (const deltaY of [-10, -20]) {
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY, clientX: 320, clientY: 240, cancelable: true });
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  draw!(0);
  expect(viewer.updateScale).toHaveBeenCalledWith({
    scaleFactor: Math.exp(0.3),
    origin: [320, 240],
    drawingDelay: 100
  });
  detach();
});

it('退出时移除手势并取消尚未执行的缩放；PDF 未就绪时不处理事件', () => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 7)
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const container = document.createElement('div');
  const viewer = { pagesCount: 0, updateScale: vi.fn() };
  const detach = attachPdfPinchZoom(container, viewer);
  const empty = new WheelEvent('wheel', { ctrlKey: true, deltaY: 10, cancelable: true });
  container.dispatchEvent(empty);
  expect(empty.defaultPrevented).toBe(false);
  viewer.pagesCount = 1;
  container.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 10, cancelable: true }));
  detach();
  expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
  const closed = new WheelEvent('wheel', { ctrlKey: true, deltaY: 10, cancelable: true });
  container.dispatchEvent(closed);
  expect(closed.defaultPrevented).toBe(false);
});
