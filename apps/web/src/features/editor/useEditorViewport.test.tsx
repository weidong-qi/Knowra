import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorViewport } from './useEditorViewport';
import { EDITOR_SCROLL_POSITIONS_KEY } from './editorScrollPosition';

let viewport: ReturnType<typeof useEditorViewport>;
let frames: Map<number, FrameRequestCallback>;
let observers: Array<{ callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }>;
let height: number;
function Harness({ noteId }: { noteId?: string }) {
  viewport = useEditorViewport(noteId);
  if (!noteId) return <div>无笔记</div>;
  return <div data-testid="stage" ref={viewport.documentStageRef}>
    <article ref={viewport.paperRef}><div ref={viewport.toolbarAnchorRef} />
      <div ref={viewport.toolbarRef} style={{ marginTop: '12px' }} />
    </article>
    <output>{`${viewport.toolbarPinned}:${viewport.documentEdge}`}</output>
  </div>;
}
async function advanceFrames(count = 1) {
  for (let i = 0; i < count; i += 1) await act(async () => {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach(callback => callback(i * 16));
  });
}
function restore() {
  let promise!: Promise<void>;
  act(() => { promise = viewport.restoreCurrentScrollPosition(); });
  return promise;
}
function notifyContentResize() {
  act(() => observers.at(-1)!.callback([], {} as ResizeObserver));
}
beforeEach(() => {
  frames = new Map(); observers = []; height = 2000; let id = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++id, callback); return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(key => { frames.delete(key); });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(700);
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn(); observe = vi.fn();
    constructor(callback: ResizeObserverCallback) { observers.push({ callback, disconnect: this.disconnect }); }
  });
  localStorage.setItem(EDITOR_SCROLL_POSITIONS_KEY, JSON.stringify({ a: 400, b: 800 }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('useEditorViewport', () => {
  it('连续 A → B → A 使旧回调失效，新恢复不受旧 finally 影响', async () => {
    const view = render(<Harness noteId="a" />);
    const oldRestore = viewport.restoreCurrentScrollPosition;
    const first = restore();
    const lateFrame = [...frames.values()][0];
    view.rerender(<Harness noteId="b" />);
    const second = restore();
    view.rerender(<Harness noteId="a" />);
    const third = restore();
    await act(async () => { lateFrame(0); await Promise.all([first, second, oldRestore()]); });
    expect(frames.size).toBe(1);
    await advanceFrames(35);
    await third;
    expect(view.getByTestId('stage').scrollTop).toBe(400);
  });

  it.each(['wheel', 'pointerdown', 'touchstart', 'keydown'])('%s 中断后用户滚动立即优先，不再被恢复覆盖', async (event) => {
    const view = render(<Harness noteId="a" />);
    const pending = restore();
    await advanceFrames(3);
    const stage = view.getByTestId('stage');
    expect(stage.scrollTop).toBe(400);
    fireEvent(stage, new Event(event, { bubbles: true }));
    stage.scrollTop = 123;
    fireEvent.scroll(stage);
    await advanceFrames(35);
    await pending;
    notifyContentResize();
    viewport.saveCurrentScrollPosition();
    expect(stage.scrollTop).toBe(123);
    expect(JSON.parse(localStorage.getItem(EDITOR_SCROLL_POSITIONS_KEY)!)).toEqual({ a: 123, b: 800 });
  });

  it('正文太短时保留存储位置，后续增高重试；窗口断点变化不取消恢复', async () => {
    height = 600;
    const view = render(<Harness noteId="a" />);
    const pending = restore();
    fireEvent.resize(window);
    fireEvent.scroll(view.getByTestId('stage'));
    viewport.saveCurrentScrollPosition();
    await advanceFrames(35);
    await pending;
    expect(JSON.parse(localStorage.getItem(EDITOR_SCROLL_POSITIONS_KEY)!).a).toBe(400);
    expect(view.getByTestId('stage').scrollTop).toBe(0);
    height = 2000;
    notifyContentResize();
    await advanceFrames(35);
    expect(view.getByTestId('stage').scrollTop).toBe(400);
  });

  it('观察器先启动时 onReady 等待同一恢复完成，再执行显式定位', async () => {
    const view = render(<Harness noteId="a" />);
    notifyContentResize();
    let located = false;
    const onReady = viewport.restoreCurrentScrollPosition().then(() => {
      located = true;
      view.getByTestId('stage').scrollTop = 900;
    });
    await advanceFrames(3);
    expect(located).toBe(false);
    expect(view.getByTestId('stage').scrollTop).toBe(400);
    await advanceFrames(35);
    await onReady;
    expect(located).toBe(true);
    expect(view.getByTestId('stage').scrollTop).toBe(900);
    await advanceFrames(5);
    expect(view.getByTestId('stage').scrollTop).toBe(900);
  });

  it('用户中断后立即切换，保存当前位置且旧任务不写入新笔记', async () => {
    const view = render(<Harness noteId="a" />);
    const pending = restore();
    await advanceFrames(3);
    const stage = view.getByTestId('stage');
    fireEvent.wheel(stage);
    stage.scrollTop = 150;
    viewport.saveCurrentScrollPosition();
    view.rerender(<Harness noteId="b" />);
    const next = restore();
    await advanceFrames(35);
    await Promise.all([pending, next]);
    expect(stage.scrollTop).toBe(800);
    expect(JSON.parse(localStorage.getItem(EDITOR_SCROLL_POSITIONS_KEY)!)).toEqual({ a: 150, b: 800 });
  });

  it('卸载取消所有帧并结束等待者，迟到帧不能再写 detached 视口', async () => {
    const view = render(<Harness noteId="a" />);
    const stage = view.getByTestId('stage');
    const pending = restore();
    const lateFrame = [...frames.values()][0];
    view.unmount();
    expect(frames.size).toBe(0);
    await act(async () => { lateFrame(0); await pending; });
    expect(stage.scrollTop).toBe(0);
    expect(observers.every(observer => observer.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it('StrictMode 重建后只运行当前恢复会话，正常返回顶部清除旧位置', async () => {
    const view = render(<StrictMode><Harness noteId="a" /></StrictMode>);
    const pending = restore();
    await advanceFrames(35); await pending;
    const stage = view.getByTestId('stage');
    expect(stage.scrollTop).toBe(400);
    stage.scrollTop = 0; fireEvent.scroll(stage);
    viewport.saveCurrentScrollPosition();
    expect(JSON.parse(localStorage.getItem(EDITOR_SCROLL_POSITIONS_KEY)!)).toEqual({ b: 800 });
  });

  it('无笔记到有效笔记仍装配视口；吸顶和窄屏边距沿用原布局计算', async () => {
    const view = render(<Harness />);
    view.rerender(<Harness noteId="a" />);
    const stage = view.getByTestId('stage');
    expect(view.container.querySelector('output')?.textContent).toBe('false:150');
    vi.spyOn(viewport.toolbarAnchorRef.current!, 'getBoundingClientRect').mockReturnValue({ top: -20 } as DOMRect);
    fireEvent.scroll(stage);
    expect(view.container.querySelector('output')?.textContent).toBe('true:150');
    vi.spyOn(stage, 'clientWidth', 'get').mockReturnValue(400);
    fireEvent.resize(window);
    expect(view.container.querySelector('output')?.textContent).toBe('true:0');
    const pending = restore(); await advanceFrames(35); await pending;
    expect(stage.scrollTop).toBe(400);
  });
});

it('上下文行改变吸顶栏高度时同步原生滚动留白，卸载清理', () => {
  const rendered = render(<Harness noteId="a" />);
  const stage = rendered.getByTestId('stage');
  const toolbar = viewport.toolbarRef.current!;
  toolbar.getBoundingClientRect = () => ({ height: 110 } as DOMRect);
  act(() => observers[0].callback([], {} as ResizeObserver));
  expect(stage.style.getPropertyValue('--editor-toolbar-height')).toBe('118px');
  toolbar.getBoundingClientRect = () => ({ height: 52 } as DOMRect);
  act(() => observers[0].callback([], {} as ResizeObserver));
  expect(stage.style.getPropertyValue('--editor-toolbar-height')).toBe('60px');
  rendered.unmount();
  expect(stage.style.getPropertyValue('--editor-toolbar-height')).toBe('');
});
