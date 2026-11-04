import { useState } from 'react';
import { Dialog, DialogBody } from '../../components/ui/overlay';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditorContextMenu } from './EditorContextMenu';

describe('EditorContextMenu', () => {
  it('routes quick actions and submenu actions through existing editor contracts', async () => {
    const user = userEvent.setup();
    const onRunCommand = vi.fn();
    const onEditAction = vi.fn();
    render(
      <EditorContextMenu
        enabled
        canEdit
        onRunCommand={onRunCommand}
        onEditAction={onEditAction}
        onInsertImage={vi.fn()}
        onCreateAnnotation={vi.fn()}
      >
        <div>正文编辑区</div>
      </EditorContextMenu>
    );

    fireEvent.contextMenu(screen.getByText('正文编辑区'), { clientX: 80, clientY: 80 });
    expect(await screen.findByRole('menu', { name: '编辑器右键快捷功能' })).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: '复制' }));
    expect(onEditAction).toHaveBeenCalledWith('copy');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    fireEvent.contextMenu(screen.getByText('正文编辑区'), { clientX: 80, clientY: 80 });
    await user.click(await screen.findByRole('menuitem', { name: '加粗' }));
    expect(onRunCommand).toHaveBeenCalledWith('bold');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    fireEvent.contextMenu(screen.getByText('正文编辑区'), { clientX: 80, clientY: 80 });
    expect(await screen.findByRole('menuitem', { name: '标题' })).toHaveAttribute('data-has-submenu', 'true');
    expect(screen.getByRole('menuitem', { name: '插入' })).toHaveAttribute('data-has-submenu', 'true');
  });

  it('keeps the native editor menu when the feature is disabled', () => {
    render(
      <EditorContextMenu
        enabled={false}
        canEdit={false}
        onRunCommand={vi.fn()}
        onEditAction={vi.fn()}
        onInsertImage={vi.fn()}
        onCreateAnnotation={vi.fn()}
      >
        <div>源码并排预览</div>
      </EditorContextMenu>
    );
    fireEvent.contextMenu(screen.getByText('源码并排预览'));
    expect(screen.queryByRole('menu', { name: '编辑器右键快捷功能' })).not.toBeInTheDocument();
  });

  it('routes important-content annotation through the dedicated callback', async () => {
    const user = userEvent.setup();
    const onCreateAnnotation = vi.fn();
    render(
      <EditorContextMenu enabled canEdit onRunCommand={vi.fn()} onEditAction={vi.fn()} onInsertImage={vi.fn()} onCreateAnnotation={onCreateAnnotation}>
        <div>正文标注区</div>
      </EditorContextMenu>
    );
    fireEvent.contextMenu(screen.getByText('正文标注区'), { clientX: 80, clientY: 80 });
    await user.click(await screen.findByRole('menuitem', { name: '标记为重要内容' }));
    expect(onCreateAnnotation).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });
});


it('子菜单选择后关闭整个右键菜单，后续正文按钮可操作', async () => {
  const user = userEvent.setup();
  const onRunCommand = vi.fn();
  const nextClick = vi.fn();
  render(<EditorContextMenu enabled canEdit onRunCommand={onRunCommand} onEditAction={vi.fn()} onInsertImage={vi.fn()} onCreateAnnotation={vi.fn()}>
    <button onClick={nextClick}>正文按钮</button>
  </EditorContextMenu>);
  fireEvent.contextMenu(screen.getByText('正文按钮'), { clientX: 80, clientY: 80 });
  await user.hover(await screen.findByRole('menuitem', { name: /^标题$/ }));
  await user.click(await screen.findByRole('menuitem', { name: /^H2/ }));
  expect(onRunCommand).toHaveBeenCalledWith('heading-2');
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  await user.click(screen.getByText('正文按钮'));
  expect(nextClick).toHaveBeenCalledOnce();
});

it('复制关闭菜单后由浮层恢复原正文焦点', async () => {
  const user = userEvent.setup();
  render(<EditorContextMenu enabled canEdit onRunCommand={vi.fn()} onEditAction={vi.fn()} onInsertImage={vi.fn()} onCreateAnnotation={vi.fn()}>
    <div className="ProseMirror" contentEditable suppressContentEditableWarning role="textbox" aria-label="正文">可复制正文</div>
  </EditorContextMenu>);
  const editor = screen.getByRole('textbox', { name: '正文' });
  editor.focus();
  fireEvent.contextMenu(editor, { clientX: 80, clientY: 80 });
  await user.click(await screen.findByRole('menuitem', { name: '复制' }));
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  await waitFor(() => expect(editor).toHaveFocus());
});


it('子菜单打开图片弹窗时关闭右键面板，不把焦点抢回正文', async () => {
  function Fixture() {
    const [open, setOpen] = useState(false);
    return <>
      <EditorContextMenu enabled canEdit onRunCommand={vi.fn()} onEditAction={vi.fn()} onInsertImage={() => setOpen(true)} onCreateAnnotation={vi.fn()}>
        <div className="ProseMirror" contentEditable suppressContentEditableWarning role="textbox" aria-label="图片正文">正文</div>
      </EditorContextMenu>
      <Dialog title="图片弹窗" isOpen={open} onOpenChange={setOpen}><DialogBody><button autoFocus>选择图片</button></DialogBody></Dialog>
    </>;
  }
  const user = userEvent.setup();
  render(<Fixture />);
  const editor = screen.getByRole('textbox', { name: '图片正文' });
  editor.focus();
  fireEvent.contextMenu(editor, { clientX: 80, clientY: 80 });
  await user.hover(await screen.findByRole('menuitem', { name: /^插入$/ }));
  await user.click(await screen.findByRole('menuitem', { name: /^图片$/ }));
  const dialog = await screen.findByRole('dialog', { name: '图片弹窗' });
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
});
