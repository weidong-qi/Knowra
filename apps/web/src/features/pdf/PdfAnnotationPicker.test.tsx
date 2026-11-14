import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { PdfAnnotationPicker } from './PdfAnnotationPicker';

afterEach(cleanup);

const first = {
  id: 'first',
  type: 'highlight',
  kind: 'important',
  quoteText: '相同原文',
  comment: '底层批注'
} as PdfAnnotation;
const second = { ...first, id: 'second', comment: '上层批注' };
const props = { items: [second, first], point: { x: 100, y: 100 }, onPick: vi.fn(), onClose: vi.fn() };

beforeEach(() => vi.clearAllMocks());

it('独立列出相同原文的标注，显示分类和批注摘要并回传正确 ID', () => {
  render(<PdfAnnotationPicker {...props} />);
  expect(screen.getByRole('menu', { name: '选择标注' })).toBeVisible();
  expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  expect(screen.getByText('选择标注（2）')).toBeVisible();
  expect(screen.getByText('重点 · 底层批注')).toBeVisible();
  fireEvent.click(screen.getByRole('menuitem', { name: '2. 高亮：相同原文' }));
  expect(props.onPick).toHaveBeenCalledWith('first');
});

it('便签显示标题，区域和空批注有可读的说明', () => {
  render(
    <PdfAnnotationPicker
      {...props}
      items={[
        { ...first, type: 'note', title: '我的便签' },
        { ...second, type: 'region', quoteText: '', comment: '' }
      ]}
    />
  );
  expect(screen.getByRole('menuitem', { name: '1. 便签：我的便签' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: '2. 区域：区域标注' })).toBeVisible();
  expect(screen.getByText('重点 · 暂无批注')).toBeVisible();
});

it('候选变化时显示最新批注，移除失效候选且不自动选择剩余项', () => {
  const view = render(<PdfAnnotationPicker {...props} />);
  view.rerender(<PdfAnnotationPicker {...props} items={[{ ...first, comment: '最新批注' }]} />);
  expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  expect(screen.getByText('重点 · 最新批注')).toBeVisible();
  expect(props.onPick).not.toHaveBeenCalled();
});

it('方向键和 Enter 可选择底层标注，Escape 只关闭菜单', async () => {
  const user = userEvent.setup();
  const view = render(<PdfAnnotationPicker {...props} />);
  const entries = screen.getAllByRole('menuitem');
  await waitFor(() => expect(entries[0]).toHaveAttribute('data-focused', 'true'));
  await user.keyboard('{ArrowDown}{Enter}');
  expect(props.onPick).toHaveBeenCalledWith('first');
  view.unmount();
  props.onPick.mockClear();
  render(<PdfAnnotationPicker {...props} />);
  await waitFor(() => expect(screen.getAllByRole('menuitem')[0]).toHaveAttribute('data-focused', 'true'));
  await user.keyboard('{Escape}');
  expect(props.onClose).toHaveBeenCalled();
  expect(props.onPick).not.toHaveBeenCalled();
});
