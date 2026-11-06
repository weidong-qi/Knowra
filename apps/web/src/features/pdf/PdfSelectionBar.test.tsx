import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PdfSelectionBar } from './PdfSelectionBar';

afterEach(cleanup);

it('列出五种分类色，点击即回传分类', () => {
  const onPick = vi.fn();
  render(<PdfSelectionBar anchor={{ x: 100, top: 200, bottom: 220 }} onPick={onPick} />);
  expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
    '标注为重点',
    '标注为疑问',
    '标注为补充',
    '标注为易错',
    '标注为普通'
  ]);
  fireEvent.click(screen.getByRole('button', { name: '标注为疑问' }));
  expect(onPick).toHaveBeenCalledWith('question');
});

it('贴近视口顶部时翻到选区下方', () => {
  render(<PdfSelectionBar anchor={{ x: 100, top: 20, bottom: 40 }} onPick={() => undefined} />);
  expect(screen.getByRole('toolbar', { name: '选择标注分类' })).toHaveAttribute('data-below', 'true');
});

it('只读选区仍可查词，隐藏标注操作', () => {
  const lookup = vi.fn();
  render(
    <PdfSelectionBar
      anchor={{ x: 100, top: 200, bottom: 220 }}
      onPick={() => undefined}
      canAnnotate={false}
      onLookup={lookup}
    />
  );
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '查词' }));
  expect(lookup).toHaveBeenCalledOnce();
});

it('文字选区可在高亮与下划线间切换，区域和便签不显示切换', () => {
  const onMode = vi.fn();
  const { rerender } = render(
    <PdfSelectionBar
      anchor={{ x: 1, top: 200, bottom: 220 }}
      mode="highlight"
      onMode={onMode}
      onPick={() => undefined}
    />
  );
  expect(screen.getByRole('button', { name: '标注样式：高亮' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '标注样式：下划线' }));
  expect(onMode).toHaveBeenCalledWith('underline');
  rerender(<PdfSelectionBar anchor={{ x: 1, top: 200, bottom: 220 }} onPick={() => undefined} />);
  expect(screen.queryByRole('button', { name: /标注样式/ })).toBeNull();
});
