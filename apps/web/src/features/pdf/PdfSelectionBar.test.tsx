import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

it('查词卡片内复用操作时不使用浮层坐标，样式与分类仍可选择', () => {
  const pick = vi.fn(),
    mode = vi.fn();
  render(
    <PdfSelectionBar inline anchor={{ x: 100, top: 20, bottom: 40 }} mode="highlight" onMode={mode} onPick={pick} />
  );
  const bar = screen.getByRole('toolbar', { name: '选择标注分类' });
  expect(bar).not.toHaveAttribute('style');
  expect(bar).not.toHaveAttribute('data-below');
  expect(screen.getByRole('group', { name: '标注样式', exact: true })).toBeVisible();
  const kinds = within(screen.getByRole('group', { name: '标注分类', exact: true }));
  expect(kinds.getAllByRole('button').map(button => button.textContent)).toEqual([
    '重点',
    '疑问',
    '补充',
    '易错',
    '普通'
  ]);
  fireEvent.click(screen.getByRole('button', { name: '标注样式：下划线' }));
  expect(mode).toHaveBeenCalledWith('underline');
  fireEvent.click(screen.getByRole('button', { name: '标注为重点' }));
  expect(pick).toHaveBeenCalledWith('important');
});

it('设置模式的颜色表示当前分类，并仅回传选择', () => {
  const pick = vi.fn();
  const props = { anchor: { x: 100, top: 20, bottom: 40 }, onPick: pick, inline: true };
  const view = render(<PdfSelectionBar {...props} selectedKind="supplement" />);
  expect(screen.getByRole('button', { name: '选择分类：补充' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '选择分类：疑问' }));
  expect(pick).toHaveBeenCalledWith('question');
  view.rerender(<PdfSelectionBar {...props} selectedKind="question" />);
  expect(screen.getByRole('button', { name: '选择分类：疑问' })).toHaveAttribute('aria-pressed', 'true');
});
