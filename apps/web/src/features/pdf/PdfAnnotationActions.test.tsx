import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { PdfAnnotationActions } from './PdfAnnotationActions';

afterEach(cleanup);
const item = { id: 'a', kind: 'question' } as PdfAnnotation;

it('只读时仍可复制，但不能修改分类或删除', () => {
  const copy = vi.fn(),
    change = vi.fn(),
    remove = vi.fn();
  render(
    <PdfAnnotationActions
      item={item}
      point={{ x: 100, y: 100 }}
      canWrite={false}
      onClose={() => undefined}
      onCopy={copy}
      onEdit={() => undefined}
      onKind={change}
      onDelete={remove}
    />
  );
  const dialog = within(screen.getByRole('dialog', { name: 'PDF 标注操作' }));
  fireEvent.click(dialog.getByRole('button', { name: '复制' }));
  expect(copy).toHaveBeenCalledOnce();
  expect(dialog.getByRole('button', { name: '删除' })).toBeDisabled();
  expect(dialog.getByRole('button', { name: '添加批注' })).toBeDisabled();
  const kind = dialog.getByRole('button', { name: '改为疑问' });
  expect(kind).toHaveAttribute('aria-pressed', 'true');
  expect(kind).toBeDisabled();
  fireEvent.click(kind);
  expect(change).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it('操作面板按既有分类回传修改，保持已选状态', () => {
  const change = vi.fn();
  render(
    <PdfAnnotationActions
      item={item}
      point={{ x: 100, y: 100 }}
      canWrite
      onClose={() => undefined}
      onCopy={() => undefined}
      onEdit={() => undefined}
      onKind={change}
      onDelete={() => undefined}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: '改为易错' }));
  expect(change).toHaveBeenCalledWith('pitfall');
});
