import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { lookupDictionary } from '../dictionary/localDictionary';
import { PdfDictionaryPopover } from './PdfDictionaryPopover';

vi.mock('../dictionary/localDictionary', async importOriginal => ({
  ...(await importOriginal<typeof import('../dictionary/localDictionary')>()),
  lookupDictionary: vi.fn()
}));
vi.mock('../../components/ui', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverDialog: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  Button: ({ children, onPress, isDisabled }: { children: ReactNode; onPress(): void; isDisabled?: boolean }) => (
    <button onClick={onPress} disabled={isDisabled}>
      {children}
    </button>
  ),
  Select: ({
    label,
    selectedKey,
    onSelectionChange,
    options
  }: {
    label: string;
    selectedKey: string;
    onSelectionChange(key: string): void;
    options: Array<{ id: string; label: string }>;
  }) => (
    <select aria-label={label} value={selectedKey} onChange={event => onSelectionChange(event.target.value)}>
      {options.map(option => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  )
}));
const entry = {
  query: 'gradients',
  word: 'gradient',
  phonetic: 'ɡreɪdiənt',
  meanings: ['n. 梯度', 'a. 渐升的'],
  language: 'zh' as const
};
const lookup = vi.mocked(lookupDictionary);
const props = {
  text: 'Gradients',
  anchor: { x: 100, top: 150, bottom: 170 },
  canSave: true,
  onSave: vi.fn(),
  onAnnotate: vi.fn(),
  onClose: vi.fn()
};
beforeEach(() => {
  vi.clearAllMocks();
  lookup.mockResolvedValue(entry);
});
afterEach(cleanup);

it('展示原形和全部释义，保存用户选中的释义且保留来源', async () => {
  render(<PdfDictionaryPopover {...props} />);
  await screen.findByText('原文 Gradients → 原形 gradient');
  fireEvent.change(screen.getByRole('combobox', { name: '附带的释义' }), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: '标注并保存释义' }));
  expect(props.onSave).toHaveBeenCalledWith('词典 · ECDICT\ngradient /ɡreɪdiənt/\nn. 梯度');
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(props.onClose).toHaveBeenCalledOnce();
});

it('只读资料可以查词但不能保存', async () => {
  render(<PdfDictionaryPopover {...props} canSave={false} />);
  await screen.findByText('原文 Gradients → 原形 gradient');
  expect(screen.getByRole('button', { name: '标注并保存释义' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '仅标注原文' })).toBeDisabled();
});

it('区分未收录和读取失败，并允许重试', async () => {
  lookup.mockRejectedValueOnce(new Error('本地词库读取失败，请重试。')).mockResolvedValueOnce(null);
  render(<PdfDictionaryPopover {...props} />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '重新查询' }));
  await screen.findByText(/本地词典未收录/);
  expect(screen.getByRole('button', { name: '标注并保存释义' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '仅标注原文' })).toBeEnabled();
});

it('切换查询后旧请求晚到也不会覆盖新词结果', async () => {
  let finish!: (value: typeof entry) => void;
  lookup.mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve;
    })
  );
  lookup.mockResolvedValueOnce({ ...entry, query: 'minimum', word: 'minimum', meanings: ['n. 最小值'] });
  const view = render(<PdfDictionaryPopover {...props} />);
  view.rerender(<PdfDictionaryPopover {...props} text="minimum" />);
  await screen.findByText('n. 最小值');
  finish(entry);
  await waitFor(() => expect(screen.queryByText('gradient')).toBeNull());
  expect(screen.getByText('n. 最小值')).toBeVisible();
});

it('查词失败时可调整设置，明确提交后才标注原文', async () => {
  const pick = vi.fn();
  lookup.mockRejectedValue(new Error('词库读取失败'));
  render(
    <PdfDictionaryPopover
      {...props}
      annotationControls={
        <div role="toolbar" aria-label="选择标注分类">
          <button onClick={pick}>选择分类：重点</button>
        </div>
      }
    />
  );
  expect(screen.getByRole('toolbar', { name: '选择标注分类' })).toBeVisible();
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '选择分类：重点' }));
  expect(pick).toHaveBeenCalledOnce();
  expect(props.onAnnotate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '仅标注原文' }));
  expect(props.onAnnotate).toHaveBeenCalledOnce();
  expect(props.onSave).not.toHaveBeenCalled();
});

it('查询尚未完成时也可仅标注原文，释义保存需等待结果', () => {
  lookup.mockReturnValue(new Promise(() => undefined));
  render(<PdfDictionaryPopover {...props} />);
  expect(screen.getByRole('button', { name: '标注并保存释义' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '仅标注原文' }));
  expect(props.onAnnotate).toHaveBeenCalledOnce();
  expect(props.onSave).not.toHaveBeenCalled();
});
