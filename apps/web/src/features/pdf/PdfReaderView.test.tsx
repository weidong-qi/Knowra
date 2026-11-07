import { cleanup, render, waitFor } from '@testing-library/react';
import type { Note } from '@study-accelerator/web-core';
import { PdfReaderView } from './PdfReaderView';
import { readRuntimeConfig } from '../../app/runtimeConfig';
import { listPdfAnnotations } from './pdfApi';

// 阅读器状态测试不启动 PDF.js 或加载浏览器 worker。
vi.mock('./pdfRuntime', () => ({ pdfViewerCss: '' }));
vi.mock('./usePdfViewer', () => ({
  usePdfViewer: () => ({
    containerRef: { current: null },
    viewerRef: { current: null },
    document: null,
    page: 1,
    count: 0,
    error: '',
    passwordRequest: null
  })
}));
vi.mock('./pdfApi', async importOriginal => ({
  ...(await importOriginal<typeof import('./pdfApi')>()),
  listPdfAnnotations: vi.fn()
}));
vi.mock('../../store/AppStoreProvider', () => ({
  useAppStore: (selector: (state: object) => unknown) =>
    selector({ navigation: { openNoteTabs: [] }, serverData: { notes: [] } })
}));
vi.mock('../../shell/DesktopTitlebarContext', () => ({ useDesktopTitlebar: () => ({ host: null }) }));
vi.mock('../../app/router', () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ pathname: '/', search: '' }) }));
vi.mock('../../app/desktopLifecycle', () => ({ registerDesktopSave: () => () => undefined }));
vi.mock('../../app/navigationGuard', () => ({ registerNavigationGuard: () => () => undefined }));
vi.mock('../editor/EditorTabs', () => ({ EditorTabs: () => null }));
vi.mock('./PdfPageBar', () => ({ PdfPageBar: () => null }));
vi.mock('./PdfReaderToolbar', () => ({ PdfReaderToolbar: () => null }));
vi.mock('./PdfSidePanel', () => ({ PdfSidePanel: () => null }));

const sha256 = 'a'.repeat(64);
const note = { id: 'n1', spaceId: 's1', pdfSource: { attachmentId: 'att', sha256 } } as unknown as Note;
const list = vi.mocked(listPdfAnnotations);
const draft = {
  version: 1,
  sha256,
  drafts: [
    {
      id: 'd1',
      fields: {
        type: 'highlight',
        quoteText: '摘录',
        segments: [{ pageIndex: 0, rect: [0, 0, 1, 1] }]
      },
      expectedRevision: 0
    }
  ]
};
const mount = () => render(<PdfReaderView note={note} canWrite onOpenNote={() => undefined} />);
const storageKey = `knowra:pdf-draft:v1:${JSON.stringify([`${readRuntimeConfig().cacheSuffix}:s1`, 'n1'])}`;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const stored = JSON.stringify(draft);

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  });
  localStorage.setItem(storageKey, stored);
  list.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('标注 GET 失败后离开阅读器，保留已有的恢复草稿', async () => {
  list.mockRejectedValue(new Error('503'));
  const view = mount();
  await waitFor(() => expect(list).toHaveBeenCalled());
  view.unmount();
  await settle();
  expect(localStorage.getItem(storageKey)).toBe(stored);
});

it('标注 GET 返回前就离开，保留已有的恢复草稿', async () => {
  list.mockReturnValue(new Promise(() => undefined));
  const view = mount();
  view.unmount();
  await settle();
  expect(localStorage.getItem(storageKey)).toBe(stored);
});

it('加载成功并恢复后离开，草稿仍保留', async () => {
  list.mockResolvedValue([]);
  const view = mount();
  await waitFor(() => expect(list).toHaveBeenCalled());
  await settle();
  view.unmount();
  await Promise.resolve();
  expect(JSON.parse(localStorage.getItem(storageKey)!).drafts).toHaveLength(1);
});
