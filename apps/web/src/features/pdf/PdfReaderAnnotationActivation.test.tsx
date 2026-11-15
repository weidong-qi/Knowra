import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import type { Note } from '@study-accelerator/web-core';
import { PdfReaderView } from './PdfReaderView';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  begin: vi.fn(),
  scrollCard: vi.fn(),
  viewerRef: { current: { pagesCount: 0 } }
}));

// 只验证阅读器与真实侧栏、浮层的联动，不启动 PDF.js 或浏览器 worker。
vi.mock('./pdfRuntime', () => ({ pdfViewerCss: '' }));
vi.mock('./usePdfViewer', async () => {
  const { useRef } = await import('react');
  return {
    usePdfViewer: () => ({
      containerRef: useRef<HTMLDivElement>(null),
      viewerRef: mocks.viewerRef,
      document: null,
      page: 1,
      count: 0,
      error: '',
      passwordRequest: null
    })
  };
});
vi.mock('./pdfApi', async importOriginal => ({
  ...(await importOriginal<typeof import('./pdfApi')>()),
  listPdfAnnotations: mocks.list
}));
vi.mock('./pdfOverlay', async importOriginal => ({
  ...(await importOriginal<typeof import('./pdfOverlay')>()),
  paintPdfAnnotations: () => undefined
}));
vi.mock('./usePdfNoteDrag', () => ({
  usePdfNoteDrag: () => ({
    preview: null,
    begin: mocks.begin,
    update: () => false,
    finish: () => null,
    cancel: () => undefined,
    refresh: () => undefined
  })
}));
vi.mock('../../store/AppStoreProvider', () => ({
  useAppStore: (selector: (state: object) => unknown) =>
    selector({ navigation: { openNoteTabs: [] }, serverData: { notes: [] } })
}));
vi.mock('../../shell/DesktopTitlebarContext', () => ({ useDesktopTitlebar: () => ({ host: null }) }));
vi.mock('../../app/router', () => ({
  useNavigate: () => () => undefined,
  useLocation: () => ({ pathname: '/', search: '' })
}));
vi.mock('../../app/desktopLifecycle', () => ({ registerDesktopSave: () => () => undefined }));
vi.mock('../../app/navigationGuard', () => ({ registerNavigationGuard: () => () => undefined }));
vi.mock('../editor/EditorTabs', () => ({ EditorTabs: () => null }));
vi.mock('./PdfPageBar', () => ({ PdfPageBar: () => null }));
vi.mock('./PdfReaderToolbar', () => ({
  PdfReaderToolbar: ({ onOutline }: { onOutline(): void }) => (
    <button type="button" onClick={onOutline}>
      目录
    </button>
  )
}));

const note = { id: 'n1', spaceId: 's1', pdfSource: { attachmentId: 'att', sha256: 'a'.repeat(64) } } as Note;
const types = ['highlight', 'underline', 'region', 'note'] as const;
const mark = (type: PdfAnnotation['type'], id = type) =>
  ({
    id,
    type,
    kind: 'question',
    title: id,
    quoteText: id,
    comment: `${id} 批注`,
    segments: [{ pageIndex: 0, rect: [0, 0, 10, 10] }]
  }) as PdfAnnotation;
const dialog = (type: PdfAnnotation['type']) =>
  screen.queryByRole('dialog', { name: type === 'note' ? '编辑 PDF 批注' : 'PDF 标注操作' });
const card = () => screen.getByRole('complementary', { name: 'PDF 检查器' }).querySelector('section[data-selected]');

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  // jsdom 不提供 PointerEvent 的坐标字段或真实布局。
  vi.stubGlobal('PointerEvent', MouseEvent);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: mocks.scrollCard });
  mocks.list.mockReset();
  mocks.begin.mockClear();
  mocks.scrollCard.mockClear();
});
afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  Reflect.deleteProperty(document, 'elementFromPoint');
  vi.unstubAllGlobals();
});

async function mount(items: PdfAnnotation[], panelOpen = true) {
  mocks.list.mockResolvedValue(items);
  const view = render(
    <PdfReaderView note={note} canWrite={false} panelOpen={panelOpen} onOpenNote={() => undefined} />
  );
  await waitFor(() => expect(screen.getByText('标注已保存')).toBeInTheDocument());
  const page = document.createElement('div');
  page.className = 'page';
  page.innerHTML = '<svg></svg>';
  screen.getByLabelText('PDF 页面', { exact: true }).querySelector('.pdfViewer')!.append(page);
  return { ...view, page };
}
function hit(page: Element, item: PdfAnnotation, left = 10) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', item.type === 'note' ? 'g' : 'rect');
  element.dataset.pdfAnnotationId = item.id;
  if (item.type === 'note') element.dataset.noteId = item.id;
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left,
    right: left + 30,
    top: 10,
    bottom: 40
  } as DOMRect);
  page.querySelector('svg')!.append(element);
  return element;
}
function click(element: Element, x = 20) {
  fireEvent.pointerDown(element, { button: 0, clientX: x, clientY: 20 });
  fireEvent.pointerUp(element, { button: 0, clientX: x, clientY: 20 });
}
function hover(element: Element, x = 20) {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => element });
  fireEvent.pointerMove(element, { clientX: x, clientY: 20, buttons: 0 });
}

it.each(types)('标注栏展开时 %s 首次只定位，再次点击打开对应浮层', async type => {
  const item = mark(type);
  const { page } = await mount([item]);
  const element = hit(page, item);
  hover(element);
  await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(item.comment));
  click(element);
  expect(card()).toHaveTextContent(type === 'region' ? '区域标注' : item.id);
  expect(mocks.scrollCard).toHaveBeenCalledWith({ block: 'nearest' });
  expect(dialog(type)).not.toBeInTheDocument();
  hover(element);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  click(element);
  expect(dialog(type)).toBeInTheDocument();
  if (type === 'note') expect(mocks.begin).toHaveBeenCalledTimes(2);
});

it('侧栏选中任意标注立即关闭已有预览，清除选择后恢复悬停', async () => {
  const first = mark('highlight'),
    second = mark('note');
  const { page } = await mount([first, second]);
  const firstHit = hit(page, first),
    secondHit = hit(page, second, 60);
  hover(firstHit);
  await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(first.comment));
  // 不派发 pointerdown，确认仅选中状态变化就能关闭已经显示的预览。
  fireEvent.click(screen.getByRole('button', { name: /定位标注.*note/ }));
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  hover(firstHit);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  hover(secondHit, 70);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  click(page, 100);
  hover(secondHit, 70);
  await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(second.comment));
});

it.each(types)('标注栏收起时 %s 保持一次点击打开', async type => {
  const item = mark(type);
  const { page } = await mount([item], false);
  click(hit(page, item));
  expect(dialog(type)).toBeInTheDocument();
  expect(screen.queryByRole('complementary', { name: 'PDF 检查器' })).not.toBeInTheDocument();
});

it('侧栏已选中的标注点击页面直接打开，切换其他目标后重新先定位', async () => {
  const first = mark('highlight'),
    second = mark('note');
  const { page } = await mount([first, second]);
  const firstHit = hit(page, first),
    secondHit = hit(page, second, 60);
  fireEvent.click(screen.getByRole('button', { name: /定位标注.*highlight/ }));
  click(firstHit);
  expect(dialog('highlight')).toBeInTheDocument();
  click(secondHit, 70);
  expect(dialog('note')).not.toBeInTheDocument();
  expect(dialog('highlight')).not.toBeInTheDocument();
  expect(card()).toHaveTextContent('note');
  click(secondHit, 70);
  expect(dialog('note')).toBeInTheDocument();
});

it('目录展开时先切换到标注并定位，即使目标已经选中也不立即打开', async () => {
  const item = mark('highlight');
  const { page } = await mount([item]);
  const element = hit(page, item);
  click(element);
  fireEvent.click(screen.getByRole('button', { name: '目录' }));
  click(element);
  expect(screen.getByRole('tab', { name: '标注 1' })).toHaveAttribute('aria-selected', 'true');
  expect(dialog('highlight')).not.toBeInTheDocument();
  click(element);
  expect(dialog('highlight')).toBeInTheDocument();
});

it('筛选外的目标首次点击仍显示并定位，保留筛选和 PDF 滚动位置', async () => {
  const item = mark('highlight');
  const { page } = await mount([item]);
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索标注和批注' }), { target: { value: '不匹配' } });
  const reader = screen.getByLabelText('PDF 页面', { exact: true });
  reader.scrollTop = 120;
  click(hit(page, item));
  expect(card()).toHaveTextContent('当前选中标注不符合筛选，仍可继续编辑。');
  expect(screen.getByRole('searchbox')).toHaveValue('不匹配');
  expect(reader.scrollTop).toBe(120);
  expect(dialog('highlight')).not.toBeInTheDocument();
});

it.each([true, false])('重叠候选保留点击前选择，按侧栏展开状态 %s 决定是否打开', async panelOpen => {
  const lower = mark('highlight'),
    upper = mark('note');
  const { page } = await mount([lower, upper], panelOpen);
  hit(page, lower);
  const element = hit(page, upper);
  const pick = (name: string) => fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(name) }));
  click(element);
  pick('高亮：highlight');
  expect(Boolean(dialog('highlight'))).toBe(!panelOpen);
  if (!panelOpen) return;
  click(element);
  expect(card()).toHaveTextContent('highlight');
  pick('高亮：highlight');
  expect(dialog('highlight')).toBeInTheDocument();
  click(element);
  pick('便签：note');
  expect(dialog('note')).not.toBeInTheDocument();
  click(element);
  pick('便签：note');
  expect(dialog('note')).toBeInTheDocument();
});

it('点击空白清除选择后，再次点击标注重新先定位', async () => {
  const item = mark('highlight');
  const { page } = await mount([item]);
  const element = hit(page, item);
  click(element);
  click(page, 100);
  expect(card()).toBeNull();
  click(element);
  expect(dialog('highlight')).not.toBeInTheDocument();
});
