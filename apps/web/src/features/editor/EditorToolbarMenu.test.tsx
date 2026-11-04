import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dialog, DialogBody, MenuItem } from '../../components/ui/overlay';
import { EditorToolbarMenu } from './EditorToolbarMenu';

function setup() {
  const action = vi.fn();
  render(<><EditorToolbarMenu label="测试"><MenuItem id="run" onAction={action}>执行</MenuItem></EditorToolbarMenu><button>外部</button></>);
  return { action, trigger: screen.getByRole('button', { name: '测试' }), outside: screen.getByRole('button', { name: '外部' }) };
}
const pastHoverDelay = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });

describe('EditorToolbarMenu 打开来源', () => {
  it('反复悬停→点击→移出均固定，选择后关闭且命令只执行一次', async () => {
    const user = userEvent.setup();
    const { trigger, action, outside } = setup();
    for (let attempt = 0; attempt < 3; attempt++) {
      await user.hover(trigger);
      await screen.findByRole('menu', { name: '测试' });
      await user.click(trigger);
      await user.hover(outside);
      await pastHoverDelay();
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await user.click(screen.getByRole('menuitem', { name: '执行' }));
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
      expect(action).toHaveBeenCalledTimes(attempt + 1);
    }
  });

  it('悬停菜单可取消，按压固定的菜单仍允许外部点击与 Escape 关闭', async () => {
    const user = userEvent.setup();
    const { trigger, outside } = setup();
    await user.hover(trigger);
    await user.hover(outside);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await user.click(trigger);
    await user.click(outside);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await user.click(trigger);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it.each(['{Enter}', ' ', '{ArrowDown}'])('键盘 %s 打开后不受悬停计时器关闭，并可执行命令', async key => {
    const user = userEvent.setup();
    const { trigger, action } = setup();
    trigger.focus();
    await user.keyboard(key);
    await screen.findByRole('menu', { name: '测试' });
    await pastHoverDelay();
    await user.keyboard('{Enter}');
    expect(action).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('触摸在抬起后打开，保持原生按压时机并固定菜单', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.pointer({ keys: '[TouchA>]', target: trigger });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.pointer({ keys: '[/TouchA]', target: trigger });
    await pastHoverDelay();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: '测试' })).toBeVisible();
    await user.pointer([{ keys: '[TouchA>]', target: trigger }, { keys: '[/TouchA]', target: trigger }]);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });
});


it('已固定菜单再次按压触发器关闭，之后仍可重新打开', async () => {
  const user = userEvent.setup();
  const { trigger } = setup();
  await user.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await user.click(trigger);
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  await user.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

it('菜单内部 Escape 关闭后焦点回到触发器', async () => {
  const user = userEvent.setup();
  const { trigger } = setup();
  trigger.focus();
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: '执行' })).toHaveFocus();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('触发器固定后 Tab 外移仍关闭菜单', async () => {
  const user = userEvent.setup();
  const { trigger } = setup();
  await user.hover(trigger);
  await user.click(trigger);
  trigger.focus();
  await user.tab();
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
});


it('菜单项打开独立弹窗时焦点由弹窗持有，Escape 只关闭弹窗', async () => {
  function MenuWithDialog() {
    const [open, setOpen] = useState(false);
    return <>
      <EditorToolbarMenu label="弹窗测试"><MenuItem id="dialog" onAction={() => setOpen(true)}>打开弹窗</MenuItem></EditorToolbarMenu>
      <Dialog title="独立弹窗" isOpen={open} onOpenChange={setOpen}><DialogBody><button autoFocus>弹窗操作</button></DialogBody></Dialog>
    </>;
  }
  const user = userEvent.setup();
  render(<MenuWithDialog />);
  await user.click(screen.getByRole('button', { name: '弹窗测试' }));
  await user.click(screen.getByRole('menuitem', { name: '打开弹窗' }));
  const dialog = await screen.findByRole('dialog', { name: '独立弹窗' });
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});


it('用户滚动触发器祖先时仍关闭非模态菜单', async () => {
  const user = userEvent.setup();
  const { trigger } = setup();
  await user.click(trigger);
  expect(screen.getByRole('menu', { name: '测试' })).toBeVisible();
  fireEvent.scroll(trigger.parentElement!);
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
});
