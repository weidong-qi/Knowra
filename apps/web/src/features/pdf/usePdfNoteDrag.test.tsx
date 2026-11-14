import { act, cleanup, renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { usePdfNoteDrag } from './usePdfNoteDrag';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    })
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frames.delete(id))
  );
  const container = document.createElement('div');
  container.getBoundingClientRect = () => new DOMRect(0, 0, 400, 600);
  let captured = false,
    top = 0,
    left = 0;
  container.setPointerCapture = vi.fn(() => {
    captured = true;
  });
  container.hasPointerCapture = vi.fn(() => captured);
  container.releasePointerCapture = vi.fn(() => {
    captured = false;
  });
  Object.defineProperties(container, {
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(1000, value));
      }
    },
    scrollLeft: {
      get: () => left,
      set: (value: number) => {
        left = Math.max(0, Math.min(800, value));
      }
    }
  });
  const pages = [
    { width: 200, height: 300, top: 20, scale: 1 },
    { width: 400, height: 240, top: 340, scale: 0.75 }
  ].map((size, index) => {
    const div = document.createElement('div'),
      canvas = document.createElement('div');
    div.className = 'page';
    div.dataset.pageNumber = String(index + 1);
    canvas.className = 'canvasWrapper';
    canvas.getBoundingClientRect = () =>
      new DOMRect(20 - left, size.top - top, size.width * size.scale, size.height * size.scale);
    div.append(canvas);
    container.append(div);
    return {
      div,
      viewport: {
        width: size.width,
        height: size.height,
        convertToPdfPoint: (x: number, y: number) => [x, size.height - y],
        convertToViewportPoint: (x: number, y: number) => [x, size.height - y]
      }
    };
  });
  const viewer = { current: { getPageView: (index: number) => pages[index] } as unknown as PDFViewer };
  const commit = vi.fn();
  const hook = renderHook(({ editable }) => usePdfNoteDrag(viewer, editable, commit), {
    initialProps: { editable: true }
  });
  const item = { id: 'sticky', segments: [{ pageIndex: 0, rect: [80, 180, 98, 198] }] } as PdfAnnotation;
  const point = (clientX: number, clientY: number, pointerId = 1) => ({ clientX, clientY, pointerId });
  const begin = () =>
    act(() =>
      hook.result.current.begin(
        {
          ...point(109, 131),
          currentTarget: container,
          preventDefault: vi.fn()
        } as unknown as PointerEvent<HTMLDivElement>,
        item
      )
    );
  const move = (x: number, y: number) =>
    act(() => {
      hook.result.current.update(point(x, y));
    });
  let time = 0;
  const frame = () =>
    act(() => {
      time += 16;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(time));
    });
  return { ...hook, container, commit, frames, begin, move, point, frame };
}

it('跨页预览按目标页坐标计算；页间和区外保留落点，松开只提交一次', () => {
  const { result, begin, move, point, commit } = setup();
  begin();
  move(200, 430);
  expect(result.current.preview?.segment).toEqual({ pageIndex: 1, rect: [231, 111, 249, 129] });
  const last = result.current.preview;
  move(200, 330);
  expect(result.current.preview).toBe(last);
  move(450, 430);
  expect(result.current.preview).toBe(last);
  expect(commit).not.toHaveBeenCalled();
  act(() => {
    result.current.finish(point(450, 430));
  });
  expect(commit).toHaveBeenCalledExactlyOnceWith('sticky', last!.segment);
  expect(result.current.preview).toBeNull();
});

it('滚动后静止的鼠标继续定位到目标页，松开即清理自动滚动', () => {
  const { result, begin, move, point, frame, container, frames, commit } = setup();
  begin();
  // 先向下滚动；到边缘后不再派发 pointermove。
  move(200, 595);
  for (let i = 0; i < 8; i++) frame();
  expect(container.scrollTop).toBeGreaterThan(50);
  const before = container.scrollTop;
  move(200, 5);
  frame();
  expect(container.scrollTop).toBeLessThan(before);
  move(200, 430);
  expect(result.current.preview?.segment.pageIndex).toBe(1);
  const preview = result.current.preview!.segment.rect;
  container.scrollTop += 10;
  act(() => result.current.refresh());
  expect(result.current.preview!.segment.rect[1]).toBeLessThan(preview[1]);
  act(() => {
    result.current.finish(point(200, 430));
  });
  expect(frames.size).toBe(0);
  expect(commit).toHaveBeenCalledTimes(1);
});

it('左右边缘自动滚动，离开阅读区后停止，到滚动尽头不空转', () => {
  const { begin, move, frame, container, frames } = setup();
  begin();
  move(395, 200);
  frame();
  const right = container.scrollLeft;
  expect(right).toBeGreaterThan(0);
  move(5, 200);
  frame();
  expect(container.scrollLeft).toBeLessThan(right);
  move(450, 200);
  frame();
  expect(frames.size).toBe(0);
  container.scrollTop = 1000;
  move(200, 595);
  frame();
  expect(frames.size).toBe(0);
});

it.each(['cancel', 'escape', 'blur', 'readonly', 'unmount'])('%s 终止拖动和滚动，不保存预览', mode => {
  const { result, begin, move, frames, rerender, unmount, commit, container } = setup();
  begin();
  move(200, 595);
  expect(frames.size).toBe(1);
  act(() => {
    if (mode === 'cancel') result.current.cancel();
    if (mode === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    if (mode === 'blur') window.dispatchEvent(new Event('blur'));
    if (mode === 'readonly') rerender({ editable: false });
    if (mode === 'unmount') unmount();
  });
  expect(frames.size).toBe(0);
  expect(container.releasePointerCapture).toHaveBeenCalledWith(1);
  expect(commit).not.toHaveBeenCalled();
});

it('单击或只读查看不移动、不滚动；忽略其他指针的移动和松开', () => {
  const { result, begin, point, frames, rerender, commit } = setup();
  begin();
  act(() => {
    expect(result.current.update(point(200, 430, 2))).toBe(false);
    expect(result.current.finish(point(200, 430, 2))).toBeNull();
    expect(result.current.finish(point(111, 131))?.clicked).toBe(true);
  });
  rerender({ editable: false });
  begin();
  act(() => {
    result.current.update(point(200, 595));
  });
  expect(frames.size).toBe(0);
  expect(commit).not.toHaveBeenCalled();
});
