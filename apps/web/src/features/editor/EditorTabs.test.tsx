import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Note } from '@study-accelerator/web-core';
import { EditorTabs } from './EditorTabs';
const initial = [{ id: 'a', title: '第一篇长标题笔记' }, { id: 'b', title: '第二篇' }, { id: 'c', title: '第三篇' }] as Note[];
function Tabs({ keepOpen = false }: { keepOpen?: boolean }) {
  const [notes, setNotes] = useState(initial);
  const [active, setActive] = useState('b');
  return <EditorTabs notes={notes} activeNoteId={active} canWrite onOpenNote={setActive}
    onCloseNote={id => { if (!keepOpen) { setNotes(items => items.filter(note => note.id !== id)); if (id === active) setActive('a'); } }}
    onCloseOtherNotes={vi.fn()} onReorderNotes={vi.fn()} onCopyTabPath={vi.fn()} onCreateNote={vi.fn()} />;
}
describe('笔记标签键盘与关闭焦点', () => {
  it('左右方向与 Home/End 按实际标签顺序切换', () => {
    render(<Tabs />); const second = screen.getByRole('tab', { name: '第二篇' }); second.focus();
    fireEvent.keyDown(second, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '第三篇' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: '第三篇' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(screen.getByRole('tab', { name: '第一篇长标题笔记' })).toHaveFocus();
  });
  it('关闭按钮移除完成后焦点留在相邻标签', async () => {
    render(<Tabs />); const close = screen.getByRole('button', { name: '关闭第二篇' }); close.focus(); fireEvent.click(close);
    expect(screen.queryByRole('tab', { name: '第二篇' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('tab', { name: '第三篇' })).toHaveFocus());
  });
  it('Delete关闭当前标签；保存拒绝时不提前移除或抢焦点', () => {
    render(<Tabs keepOpen />); const second = screen.getByRole('tab', { name: '第二篇' }); second.focus();
    fireEvent.keyDown(second, { key: 'Delete' });
    expect(second).toBeInTheDocument(); expect(second).toHaveFocus();
  });
});
