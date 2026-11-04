import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EditorSaveConflictFeedback } from './EditorSaveConflictFeedback';

describe('保存冲突展示边界', () => {
  it('无冲突不渲染提示，错误与默认文案保持原语义', () => {
    const props = { visible: false, error: null, discardOpen: false, onDiscardOpenChange: vi.fn(),
      onRetry: vi.fn(), onExport: vi.fn(), onReload: vi.fn(), onDiscard: vi.fn() };
    const view = render(<EditorSaveConflictFeedback {...props} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.rerender(<EditorSaveConflictFeedback {...props} visible />);
    expect(screen.getByRole('alert')).toHaveTextContent('系统不会自动覆盖冲突版本');
    view.rerender(<EditorSaveConflictFeedback {...props} visible error="正文版本已变化" />);
    expect(screen.getByRole('alert')).toHaveTextContent('正文版本已变化');
  });

  it('操作只委托入口，打开/取消确认不触发放弃、导出或重载', () => {
    const actions = { onRetry: vi.fn(), onExport: vi.fn(), onReload: vi.fn(), onDiscard: vi.fn() };
    function Harness() {
      const [open, setOpen] = useState(false);
      return <EditorSaveConflictFeedback visible error={null} discardOpen={open} onDiscardOpenChange={setOpen} {...actions} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    fireEvent.click(screen.getByRole('button', { name: '导出本地草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '保留草稿并重新加载' }));
    expect(actions.onRetry).toHaveBeenCalledOnce();
    expect(actions.onExport).toHaveBeenCalledOnce();
    expect(actions.onReload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿…' }));
    expect(screen.getByRole('dialog', { name: '放弃本地草稿？' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(actions.onDiscard).not.toHaveBeenCalled();
    expect(actions.onExport).toHaveBeenCalledOnce();
    expect(actions.onReload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿…' }));
    fireEvent.click(screen.getByRole('button', { name: '确认放弃并加载' }));
    expect(actions.onDiscard).toHaveBeenCalledOnce();
  });
});
