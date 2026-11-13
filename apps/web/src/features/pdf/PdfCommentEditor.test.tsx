import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { PdfCommentEditor } from './PdfCommentEditor';

afterEach(cleanup);
const note = { id: 'n', type: 'note', kind: 'question', quoteText: '', comment: '原有正文' } as PdfAnnotation;

it('正文便签弹框只编辑批注内容，不显示标题修改入口', () => {
  const comment = vi.fn(),
    remove = vi.fn();
  render(
    <PdfCommentEditor
      item={note}
      point={{ x: 100, y: 100 }}
      canWrite
      onChange={comment}
      onDelete={remove}
      onClose={() => {}}
    />
  );
  const dialog = within(screen.getByRole('dialog', { name: '编辑 PDF 批注' }));
  expect(dialog.queryByRole('textbox', { name: '便签标题' })).toBeNull();
  fireEvent.change(dialog.getByRole('textbox', { name: '批注内容' }), { target: { value: '详细内容' } });
  expect(comment).toHaveBeenCalledWith('详细内容');
  fireEvent.click(dialog.getByRole('button', { name: '删除便签' }));
  expect(remove).toHaveBeenCalledOnce();
});

it('只读便签的正文不可编辑，文字标注保留原有输入框', () => {
  const props = { point: { x: 100, y: 100 }, canWrite: false, onChange: () => {}, onClose: () => {} };
  const view = render(<PdfCommentEditor {...props} item={{ ...note, title: '只读标题' }} />);
  expect(screen.queryByRole('textbox', { name: '便签标题' })).toBeNull();
  expect(screen.getByRole('textbox', { name: '批注内容' })).toBeDisabled();
  view.rerender(<PdfCommentEditor {...props} item={{ ...note, type: 'highlight', quoteText: '原文' }} />);
  expect(screen.queryByRole('textbox', { name: '便签标题' })).toBeNull();
  expect(screen.getByText('原文')).toBeVisible();
});
