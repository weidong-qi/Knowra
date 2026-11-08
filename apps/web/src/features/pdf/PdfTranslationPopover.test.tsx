import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TranslationError, type TranslationResult } from '../translation/translationApi';
import { PdfTranslationPopover } from './PdfTranslationPopover';

vi.mock('../../components/ui', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverDialog: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  Button: ({ children, onPress, isDisabled }: { children: ReactNode; onPress(): void; isDisabled?: boolean }) => (
    <button onClick={onPress} disabled={isDisabled}>
      {children}
    </button>
  )
}));
const result: TranslationResult = {
  translation: '注意力就是你所需要的一切。',
  sourceText: 'Attention is all you need.',
  targetLanguage: 'zh',
  modelId: 'deepseek-flash',
  truncated: false
};
const props = {
  text: 'Attention is all you need.',
  anchor: { x: 100, top: 150, bottom: 170 },
  canSave: true,
  onSave: vi.fn(),
  onClose: vi.fn()
};
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it('显示译文并把译文与模型来源保存为标注', async () => {
  const translate = vi.fn().mockResolvedValue(result);
  render(<PdfTranslationPopover {...props} translate={translate} />);
  expect(screen.getByRole('status').textContent).toBe('正在翻译…');
  await screen.findByText(result.translation);
  expect(translate).toHaveBeenCalledWith(props.text, expect.any(AbortSignal));
  fireEvent.click(screen.getByText('保存为标注'));
  expect(props.onSave).toHaveBeenCalledWith('翻译 · deepseek-flash\n注意力就是你所需要的一切。');
});

it('只读资料仍可翻译但不能保存', async () => {
  render(<PdfTranslationPopover {...props} canSave={false} translate={vi.fn().mockResolvedValue(result)} />);
  await screen.findByText(result.translation);
  expect((screen.getByText('保存为标注') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/当前资料只读/)).toBeTruthy();
});

it('可重试的失败提供重新翻译，配置类失败不提供', async () => {
  const translate = vi
    .fn()
    .mockRejectedValueOnce(new TranslationError('模型服务暂时不可用。', 'AI_PROVIDER_UNAVAILABLE'))
    .mockResolvedValueOnce(result);
  const { unmount } = render(<PdfTranslationPopover {...props} translate={translate} />);
  await screen.findByText('模型服务暂时不可用。');
  fireEvent.click(screen.getByText('重新翻译'));
  await screen.findByText(result.translation);
  unmount();
  render(
    <PdfTranslationPopover
      {...props}
      translate={vi.fn().mockRejectedValue(new TranslationError('请先在设置中配置模型。', 'AI_NOT_CONFIGURED'))}
    />
  );
  await screen.findByText('请先在设置中配置模型。');
  expect(screen.queryByText('重新翻译')).toBeNull();
});

it('超长选区不发送请求；关闭时中止进行中的请求', async () => {
  const translate = vi.fn(() => new Promise<TranslationResult>(() => {}));
  const { unmount } = render(<PdfTranslationPopover {...props} text={'a'.repeat(3001)} translate={translate} />);
  expect(screen.getByRole('alert').textContent).toMatch(/请分段/);
  expect(translate).not.toHaveBeenCalled();
  unmount();
  render(<PdfTranslationPopover {...props} translate={translate} />);
  await waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
  const signal = (translate.mock.calls[0] as unknown as [string, AbortSignal])[1];
  cleanup();
  expect(signal.aborted).toBe(true);
});
