import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { PdfAnnotationsList } from './PdfAnnotationsPanel';

afterEach(cleanup);
const note = {
  id: 'n',
  type: 'note',
  kind: 'question',
  quoteText: '',
  comment: '',
  segments: [{ pageIndex: 0, rect: [1, 2, 3, 4] }]
} as PdfAnnotation;
const props = { selected: null, canWrite: true, onSelect: () => {}, onChange: () => {}, onDelete: () => {} };

it('侧栏显示自定义便签标题，选中后可改名；旧便签使用默认标题', () => {
  const change = vi.fn();
  const view = render(<PdfAnnotationsList {...props} items={[note]} />);
  expect(screen.getByRole('button', { name: '定位标注 第 1 页 便签' })).toBeVisible();
  view.rerender(
    <PdfAnnotationsList {...props} items={[{ ...note, title: '自定义标题' }]} selected="n" onChange={change} />
  );
  expect(screen.getByRole('button', { name: '定位标注 第 1 页 自定义标题' })).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: '便签标题' }), { target: { value: '新的标题' } });
  expect(change).toHaveBeenCalledWith('n', { title: '新的标题' });
});

it('正文选择与重复定位会滚动对应条目，编辑正文时不抢焦点或反复滚动', () => {
  const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  try {
    const view = render(<PdfAnnotationsList {...props} items={[note]} />);
    expect(scroll).not.toHaveBeenCalled();
    view.rerender(<PdfAnnotationsList {...props} items={[note]} selected="n" selectionRevision={1} />);
    expect(scroll).toHaveBeenCalledOnce();
    const field = screen.getByRole('textbox', { name: '评论' });
    act(() => field.focus());
    view.rerender(
      <PdfAnnotationsList {...props} items={[{ ...note, comment: '继续输入' }]} selected="n" selectionRevision={1} />
    );
    expect(field).toHaveFocus();
    expect(scroll).toHaveBeenCalledOnce();
    view.rerender(<PdfAnnotationsList {...props} items={[note]} selected="n" selectionRevision={2} />);
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(field).toHaveFocus();
  } finally {
    if (previous) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previous);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});
