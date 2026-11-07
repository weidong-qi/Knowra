import { act, cleanup, render, waitFor } from '@testing-library/react';
import { usePdfViewer } from './usePdfViewer';

const runtime = vi.hoisted(() => ({ getDocument: vi.fn(), pdf: { numPages: 2 } }));

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
    private page = 1;
    private scale = 'page-width';
    pagesRotation = 0;
    scrollPageIntoView = vi.fn();
    constructor(private options: { eventBus: { dispatch(name: string, event: unknown): void } }) {}
    get currentPageNumber() {
      return this.page;
    }
    set currentPageNumber(value: number) {
      if (!Number.isInteger(value) || value < 1 || value > this.pagesCount) throw new Error('invalid page');
      this.page = value;
    }
    get currentScaleValue() {
      return this.scale;
    }
    set currentScaleValue(value: string) {
      if (!['page-width', 'page-fit', 'page-actual', 'auto'].includes(value) && !(Number(value) > 0))
        throw new Error('invalid scale');
      this.scale = value;
    }
    setDocument(value: unknown) {
      if (value) this.options.eventBus.dispatch('pagesinit', {});
    }
  },
  PDFLinkService: class {
    setViewer() {}
    setDocument() {}
  },
  PDFFindController: class {},
  pdfResourceOptions: {},
  pdfjs: {
    getDocument: runtime.getDocument
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
  runtime.getDocument.mockReturnValue({ promise: new Promise(() => undefined), destroy: async () => undefined });
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

const positionKey = `knowra:pdf-view:v1::note:attachment:${'a'.repeat(64)}`;
it.each([
  'null',
  '[]',
  '"broken"',
  '{bad json',
  '{"page":-1}',
  '{"page":1.5}',
  '{"page":999,"top":20}',
  '{"page":2,"scale":"invalid"}',
  '{"scale":{}}',
  '{"scale":"0x10"}',
  '{"scale":0}',
  '{"scale":-2}',
  '{"rotation":45}',
  '{"top":"bad"}',
  '{"left":{}}',
  '{"top":1e999}'
])('损坏阅读位置 %s 不阻止 PDF 打开，回到第一页', async stored => {
  localStorage.setItem(positionKey, stored);
  runtime.getDocument.mockReturnValue({ promise: Promise.resolve(runtime.pdf), destroy: async () => undefined });
  render(<Harness />);
  await waitFor(() => expect(viewer.document).toBe(runtime.pdf));
  expect(viewer.error).toBe('');
  expect(viewer.count).toBe(2);
  expect(viewer.viewerRef.current!.currentPageNumber).toBe(1);
  expect(viewer.viewerRef.current!.currentScaleValue).toBe('page-width');
  expect(viewer.viewerRef.current!.pagesRotation).toBe(0);
  expect(viewer.viewerRef.current!.scrollPageIntoView).not.toHaveBeenCalled();
});

it.each(['page-width', 'page-fit', 'page-actual', 'auto', '1.25', 1.5])(
  '有效阅读位置保留页码、缩放 %s、旋转和坐标',
  async scale => {
    localStorage.setItem(positionKey, JSON.stringify({ page: 2, scale, rotation: 90, top: 120, left: -10 }));
    runtime.getDocument.mockReturnValue({ promise: Promise.resolve(runtime.pdf), destroy: async () => undefined });
    render(<Harness />);
    await waitFor(() => expect(viewer.document).toBe(runtime.pdf));
    expect(viewer.error).toBe('');
    expect(viewer.viewerRef.current!.currentPageNumber).toBe(2);
    expect(viewer.viewerRef.current!.currentScaleValue).toBe(String(scale));
    expect(viewer.viewerRef.current!.pagesRotation).toBe(90);
    expect(viewer.viewerRef.current!.scrollPageIntoView).toHaveBeenCalledWith({
      pageNumber: 2,
      destArray: [null, { name: 'XYZ' }, -10, 120, null]
    });
  }
);
