import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { PdfCommentEditor } from './PdfCommentEditor';

afterEach(cleanup);
const note = { id: 'n', type: 'note', kind: 'question', quoteText: '', comment: '原有正文' } as PdfAnnotation;

it('便签复用通用批注对话框，标题和正文分别回传，旧便签保留默认提示', () => {
  const title = vi.fn(),
    comment = vi.fn(),
    remove = vi.fn();
  render(
    <PdfCommentEditor
      item={note}
      point={{ x: 100, y: 100 }}
      canWrite
      onTitleChange={title}
      onChange={comment}
      onDelete={remove}
      onClose={() => {}}
    />
  );
  const dialog = within(screen.getByRole('dialog', { name: '编辑 PDF 批注' }));
  const field = dialog.getByRole('textbox', { name: '便签标题' });
  expect(field).toHaveValue('');
  expect(field).toHaveAttribute('placeholder', '便签');
  expect(field).toHaveAttribute('maxlength', '200');
  fireEvent.change(field, { target: { value: '待验证的猜想' } });
  fireEvent.change(dialog.getByRole('textbox', { name: '批注内容' }), { target: { value: '详细内容' } });
  expect(title).toHaveBeenCalledWith('待验证的猜想');
  expect(comment).toHaveBeenCalledWith('详细内容');
  fireEvent.click(dialog.getByRole('button', { name: '删除便签' }));
  expect(remove).toHaveBeenCalledOnce();
});

it('只读便签的标题与正文均不可编辑，文字标注保留原有输入框', () => {
  const props = { point: { x: 100, y: 100 }, canWrite: false, onChange: () => {}, onClose: () => {} };
  const view = render(<PdfCommentEditor {...props} item={{ ...note, title: '只读标题' }} />);
  expect(screen.getByRole('textbox', { name: '便签标题' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: '批注内容' })).toBeDisabled();
  view.rerender(<PdfCommentEditor {...props} item={{ ...note, type: 'highlight', quoteText: '原文' }} />);
  expect(screen.queryByRole('textbox', { name: '便签标题' })).toBeNull();
  expect(screen.getByText('原文')).toBeVisible();
});
