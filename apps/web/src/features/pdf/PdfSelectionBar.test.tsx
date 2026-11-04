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
