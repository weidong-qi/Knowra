import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import type { Note } from '@study-accelerator/web-core';
import { PdfReaderView } from './PdfReaderView';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  begin: vi.fn(),
  scrollCard: vi.fn(),
  selection: vi.fn(),
  lookup: vi.fn(),
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
  paintPdfAnnotations: () => undefined,
  readPdfSelection: mocks.selection
}));
vi.mock('../dictionary/localDictionary', async importOriginal => ({
  ...(await importOriginal<typeof import('../dictionary/localDictionary')>()),
  lookupDictionary: mocks.lookup
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
const actions = () => screen.queryByRole('dialog', { name: 'PDF 标注操作' });
const editor = () => screen.queryByRole('dialog', { name: '编辑 PDF 批注' });
const card = () => screen.queryByRole('complementary', { name: 'PDF 检查器' })?.querySelector('section[data-selected]');

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: mocks.scrollCard });
  mocks.list.mockReset();
  mocks.begin.mockClear();
  mocks.scrollCard.mockClear();
  mocks.selection.mockReset();
  mocks.lookup.mockReset();
});
afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  Reflect.deleteProperty(document, 'elementFromPoint');
  vi.unstubAllGlobals();
  window.getSelection()?.removeAllRanges();
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

it.each(types)('%s 统一单击显示操作栏，再次单击收起，不直接打开输入框', async type => {
  const item = mark(type),
    { page } = await mount([item]),
    element = hit(page, item);
  hover(element);
  await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(item.comment));
  click(element);
  expect(card()).toHaveTextContent(type === 'region' ? '区域标注' : item.id);
  expect(mocks.scrollCard).toHaveBeenCalledWith({ block: 'nearest' });
  expect(actions()).toBeInTheDocument();
  expect(editor()).not.toBeInTheDocument();
  hover(element);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  click(element);
  expect(actions()).not.toBeInTheDocument();
  expect(card()).not.toBeNull();
});

it.each(types)('%s 侧栏单击显示正文输入框但保留焦点，右键明确编辑时聚焦内容', async type => {
  const item = mark(type),
    { page } = await mount([item]),
    element = hit(page, item);
  const button = screen.getByRole('button', { name: new RegExp(`定位标注.*${item.id}`) });
  button.focus();
  fireEvent.click(button);
  expect(editor()).toBeInTheDocument();
  expect(button).toHaveFocus();
  fireEvent.contextMenu(element, { clientX: 20, clientY: 20 });
  expect(screen.getByRole('textbox', { name: '批注内容' })).toHaveFocus();
  expect(actions()).not.toBeInTheDocument();
});

it('A 的输入框保持，单击 B 只显示 B 的操作栏，右键 B 才替换输入框', async () => {
  const first = mark('highlight'),
    second = mark('note'),
    { page } = await mount([first, second]);
  hit(page, first);
  const secondHit = hit(page, second, 60);
  fireEvent.click(screen.getByRole('button', { name: /定位标注.*highlight/ }));
  expect(screen.getByRole('textbox', { name: '批注内容' })).toHaveValue(first.comment);
  click(secondHit, 70);
  expect(actions()).toBeInTheDocument();
  expect(card()).toHaveTextContent('note');
  expect(screen.getByRole('textbox', { name: '批注内容' })).toHaveValue(first.comment);
  fireEvent.contextMenu(secondHit, { clientX: 70, clientY: 20 });
  expect(screen.getByRole('textbox', { name: '批注内容' })).toHaveValue(second.comment);
  expect(screen.getAllByRole('dialog', { name: '编辑 PDF 批注' })).toHaveLength(1);
});

it('已打开输入框的标注不重复预览，其他标注仍可悬停', async () => {
  const first = mark('highlight'),
    second = mark('note'),
    { page } = await mount([first, second]);
  const firstHit = hit(page, first),
    secondHit = hit(page, second, 60);
  fireEvent.click(screen.getByRole('button', { name: /定位标注.*note/ }));
  hover(firstHit);
  await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(first.comment));
  const reader = screen.getByLabelText('PDF 页面', { exact: true });
  fireEvent.keyDown(reader, { key: 'Escape', isComposing: true });
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
  fireEvent.keyDown(reader, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(editor()).toBeInTheDocument();
  hover(secondHit, 70);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(editor()).toBeInTheDocument();
});

it.each(types)('侧栏收起时 %s 也统一单击操作栏', async type => {
  const item = mark(type),
    { page } = await mount([item], false);
  click(hit(page, item));
  expect(actions()).toBeInTheDocument();
  expect(editor()).not.toBeInTheDocument();
  expect(screen.queryByRole('complementary', { name: 'PDF 检查器' })).not.toBeInTheDocument();
});

it('筛选外的正文目标仍显示并定位，保留筛选与阅读滚动位置', async () => {
  const item = mark('highlight'),
    { page } = await mount([item]);
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索标注和批注' }), { target: { value: '不匹配' } });
  const reader = screen.getByLabelText('PDF 页面', { exact: true });
  reader.scrollTop = 120;
  click(hit(page, item));
  expect(card()).toHaveTextContent('当前选中标注不符合筛选，仍可继续编辑。');
  expect(screen.getByRole('searchbox')).toHaveValue('不匹配');
  expect(reader.scrollTop).toBe(120);
  expect(actions()).toBeInTheDocument();
});

it('重叠候选携带右键编辑意图，普通点击则携带操作栏意图', async () => {
  const lower = mark('highlight'),
    upper = mark('note'),
    { page } = await mount([lower, upper]);
  hit(page, lower);
  const element = hit(page, upper);
  click(element);
  fireEvent.click(screen.getByRole('menuitem', { name: /高亮：highlight/ }));
  expect(actions()).toBeInTheDocument();
  expect(editor()).not.toBeInTheDocument();
  fireEvent.contextMenu(element, { clientX: 20, clientY: 20 });
  fireEvent.click(screen.getByRole('menuitem', { name: /便签：note/ }));
  expect(screen.getByRole('textbox', { name: '批注内容' })).toHaveValue(upper.comment);
  expect(actions()).not.toBeInTheDocument();
});

it('点击空白和滚动保留输入框与选中态，Esc 先收操作栏再关闭输入框', async () => {
  const item = mark('highlight'),
    { page } = await mount([item]);
  const element = hit(page, item);
  fireEvent.click(screen.getByRole('button', { name: /定位标注.*highlight/ }));
  const frame = editor()!,
    position = frame.getAttribute('style');
  click(page, 120);
  const reader = screen.getByLabelText('PDF 页面', { exact: true });
  reader.scrollTop = 120;
  fireEvent.scroll(reader);
  expect(editor()).toBe(frame);
  expect(frame.getAttribute('style')).toBe(position);
  expect(card()).not.toBeNull();
  click(element);
  fireEvent.keyDown(reader, { key: 'Escape' });
  expect(actions()).not.toBeInTheDocument();
  expect(editor()).toBeInTheDocument();
  fireEvent.keyDown(reader, { key: 'Escape' });
  expect(editor()).not.toBeInTheDocument();
});

it('查词卡内释义下拉优先处理 Esc，再关闭查词卡，保留正文批注窗口', async () => {
  // 真实 Select 的焦点归还依赖异步 RAF，不能复用悬停测试的同步 RAF 替身。
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  const user = userEvent.setup();
  const item = mark('highlight');
  const { page } = await mount([item]);
  fireEvent.click(screen.getByRole('button', { name: /定位标注.*highlight/ }));
  mocks.selection.mockReturnValue({ ...item, quoteText: 'Gradients' });
  mocks.lookup.mockResolvedValue({
    query: 'Gradients',
    word: 'gradient',
    language: 'zh',
    meanings: ['n. 梯度', 'a. 渐升的']
  });
  const layer = document.createElement('div');
  layer.className = 'textLayer';
  layer.textContent = 'Gradients';
  page.append(layer);
  const range = document.createRange();
  range.selectNodeContents(layer);
  Object.defineProperty(range, 'getClientRects', { value: () => [{ left: 40, right: 100, top: 40, bottom: 60 }] });
  window.getSelection()!.addRange(range);
  fireEvent.doubleClick(layer);
  await screen.findByText('n. 梯度', { selector: 'p' });
  const meaning = screen.getByRole('button', { name: /附带的释义/ });
  await user.click(meaning);
  expect(screen.getByRole('listbox')).toBeVisible();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  expect(screen.getByRole('dialog', { name: 'PDF 查词' })).toBeVisible();
  await waitFor(() => expect(meaning).toHaveFocus());
  expect(editor()).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'PDF 查词' })).not.toBeInTheDocument());
  expect(editor()).toBeInTheDocument();
});
