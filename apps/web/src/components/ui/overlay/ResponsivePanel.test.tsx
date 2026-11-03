import { StrictMode, useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { Select } from '../input/Select';
import { Button } from '../button/Button';
import { Dialog, DialogClose } from './Dialog';
import { Menu, MenuItem, MenuPopover, MenuTrigger } from './Menu';
import { Popover, PopoverDialog, PopoverTrigger } from './Popover';
import { ResponsivePanel } from './ResponsivePanel';

function Session() {
  const [draft, setDraft] = useState('');
  const [taskOpen, setTaskOpen] = useState(false);
  return <>
    <label>未保存草稿<input value={draft} onChange={event => setDraft(event.target.value)} /></label>
    <Button onPress={() => setTaskOpen(true)}>打开子任务</Button>
    <Dialog title="子任务" isOpen={taskOpen} onOpenChange={setTaskOpen}><p>正在提炼</p><DialogClose>关闭任务</DialogClose></Dialog>
    <PopoverTrigger><Button>打开子预览</Button><Popover><PopoverDialog aria-label="子预览"><Button>预览操作</Button></PopoverDialog></Popover></PopoverTrigger>
    <Select label="子下拉" options={[{ id: 'keep', label: '保留' }]} />
    <MenuTrigger><Button>打开子菜单</Button><MenuPopover><Menu ariaLabel="子菜单"><MenuItem id="keep">保留草稿</MenuItem></Menu></MenuPopover></MenuTrigger>
  </>;
}
function Harness({ modal }: { modal: boolean }) {
  const [open, setOpen] = useState(false);
  return <><Button onPress={() => setOpen(true)}>打开检查器</Button><Button>背景操作</Button>
    <ResponsivePanel title="检查器" modal={modal} isOpen={open} onClose={() => setOpen(false)}>
      <section hidden={!open}><Button onPress={() => setOpen(false)}>关闭检查器</Button><Session /></section>
    </ResponsivePanel></>;
}
const view = (modal: boolean) => <StrictMode><Harness modal={modal} /></StrictMode>;

it.each([
  { trigger: '打开子任务', role: 'dialog' as const, title: '子任务' },
  { trigger: '打开子预览', role: 'dialog' as const, title: '子预览' },
  { trigger: '打开子菜单', role: 'menu' as const, title: '打开子菜单' },
  { trigger: /子下拉$/, role: 'listbox' as const, title: '子下拉' }
])('$title 跨断点保留会话，Escape 逐层关闭后恢复父隔离和焦点', async ({ trigger, role, title }) => {
  const user = userEvent.setup();
  const { rerender } = render(view(false));
  const opener = screen.getByRole('button', { name: '打开检查器' });
  await user.click(opener);
  await user.type(screen.getByLabelText('未保存草稿'), '尚未保存的合成编辑');
  const childTrigger = screen.getByRole('button', { name: trigger });
  await user.click(childTrigger);
  const child = await screen.findByRole(role, { name: title });
  rerender(view(true));
  expect(screen.getByRole(role, { name: title })).toBe(child);
  expect(child.closest('[inert]')).toBeNull();
  expect(child.closest('[aria-hidden="true"]')).toBeNull();
  expect(screen.getByText('背景操作').closest('[inert], [aria-hidden="true"]')).not.toBeNull();
  await user.keyboard(role !== 'dialog' ? '{ArrowDown}' : '{Tab}');
  expect(child.contains(document.activeElement)).toBe(true);
  rerender(view(false));
  expect(screen.getByRole(role, { name: title })).toBe(child);
  rerender(view(true));
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole(role, { name: title })).toBeNull());
  await waitFor(() => expect(childTrigger).toHaveFocus());
  const panel = screen.getByRole('dialog', { name: '检查器' });
  expect(within(panel).getByLabelText('未保存草稿')).toHaveValue('尚未保存的合成编辑');
  expect(screen.getByText('背景操作').closest('[inert], [aria-hidden="true"]')).not.toBeNull();
  for (let i = 0; i < 10; i += 1) { await user.tab(); expect(panel.contains(document.activeElement)).toBe(true); }
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '检查器' })).toBeNull());
  await waitFor(() => expect(opener).toHaveFocus());
  expect(opener.closest('[inert], [aria-hidden="true"]')).toBeNull();
  await user.click(opener);
  expect(screen.getByLabelText('未保存草稿')).toHaveValue('尚未保存的合成编辑');
});

it('非模态容器不消费桌面 Escape', async () => {
  const user = userEvent.setup();
  let escapes = 0;
  render(<div onKeyDown={event => { if (event.key === 'Escape') escapes += 1; }}><Harness modal={false} /></div>);
  await user.click(screen.getByRole('button', { name: '打开检查器' }));
  await user.click(screen.getByLabelText('未保存草稿'));
  await user.keyboard('{Escape}');
  expect(escapes).toBe(1);
  expect(screen.getByLabelText('未保存草稿')).toBeVisible();
});
