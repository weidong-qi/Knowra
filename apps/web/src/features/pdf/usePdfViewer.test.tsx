import { act, cleanup, render } from '@testing-library/react';
import { usePdfViewer } from './usePdfViewer';

vi.mock('./pdfPinchZoom', () => ({ attachPdfPinchZoom: () => () => undefined }));
vi.mock('./pdfRuntime', () => ({
  EventBus: class {
    handlers = new Map<string, Array<(event: unknown) => void>>();
    on(name: string, handler: (event: unknown) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    }
    dispatch(name: string, event: unknown) {
      this.handlers.get(name)?.forEach(handler => handler(event));
    }
  },
  PDFViewer: class {
    pagesCount = 2;
    currentPageNumber = 1;
    currentScaleValue = 'page-width';
    pagesRotation = 0;
    setDocument() {}
  },
  PDFLinkService: class {
    setViewer() {}
    setDocument() {}
  },
  PDFFindController: class {},
  pdfResourceOptions: {},
  pdfjs: {
    getDocument: () => ({ promise: new Promise(() => undefined), destroy: async () => undefined })
  }
}));

let viewer: ReturnType<typeof usePdfViewer>;
function Harness() {
  viewer = usePdfViewer('attachment', 'note', 'a'.repeat(64));
  return (
    <div ref={viewer.containerRef}>
      <div className="pdfViewer" />
    </div>
  );
}
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('任意页的画布和文字层完成只更新绘制版本，不发出关闭浮层的视口变化', () => {
  render(<Harness />);
  const revision = viewer.revision;
  for (const name of ['pagerendered', 'textlayerrendered']) {
    for (const pageNumber of [1, 2]) {
      act(() => viewer.eventRef.current!.dispatch(name, { pageNumber }));
    }
  }
  expect(viewer.revision).toBe(revision + 4);
  expect(viewer.viewportRevision).toBe(0);
});

it('缩放、旋转和切页仍发出视口变化，卸载后的迟到事件不再更新', () => {
  const view = render(<Harness />);
  for (const name of ['scalechanging', 'rotationchanging', 'pagechanging']) {
    const revision = viewer.viewportRevision;
    act(() => viewer.eventRef.current!.dispatch(name, { pageNumber: 2 }));
    expect(viewer.viewportRevision).toBe(revision + 1);
  }
  const bus = viewer.eventRef.current!;
  const revision = viewer.viewportRevision;
  view.unmount();
  act(() => bus.dispatch('textlayerrendered', { pageNumber: 2 }));
  act(() => bus.dispatch('scalechanging', {}));
  expect(viewer.viewportRevision).toBe(revision);
});
