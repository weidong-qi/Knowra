import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownImportDialog } from './MarkdownImportDialog';

describe('MarkdownImportDialog', () => {
  it('reads selected Markdown and submits framework-neutral sources', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const file = new File(['# 导入标题'], 'import.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('# 导入标题') });
    render(
      <MarkdownImportDialog
        isOpen
        folderName="产品设计"
        onOpenChange={onOpenChange}
        onImport={onImport}
      />
    );

    await userEvent.upload(screen.getByLabelText('拖放 Markdown 文件到这里'), file);
    expect(screen.getByText('import.md')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '导入 1 篇' }));

    await waitFor(() => expect(onImport).toHaveBeenCalledWith([
      { fileName: 'import.md', rawMarkdown: '# 导入标题' }
    ]));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('rejects unsupported files before calling the backend', async () => {
    const onImport = vi.fn();
    render(
      <MarkdownImportDialog
        isOpen
        folderName="未整理"
        onOpenChange={vi.fn()}
        onImport={onImport}
      />
    );

    const input = screen.getByLabelText('拖放 Markdown 文件到这里');
    const file = new File(['plain'], 'plain.txt', { type: 'text/plain' });
    await userEvent.upload(input, file, { applyAccept: false });
    expect(screen.getByRole('alert')).toHaveTextContent('不是受支持的 Markdown 文件');
    expect(onImport).not.toHaveBeenCalled();
  });
});


describe('MarkdownImportDialog 移除控件', () => {
  it.each(['{Enter}', ' '])('通过 Tab 和 %s 只移除目标文件', async key => {
    const user = userEvent.setup();
    render(<MarkdownImportDialog isOpen folderName="合成目录" onOpenChange={vi.fn()} onImport={vi.fn()} />);
    await user.upload(screen.getByLabelText('拖放 Markdown 文件到这里'), [
      new File(['first'], 'first.md', { type: 'text/markdown' }),
      new File(['second'], 'second.md', { type: 'text/markdown' })
    ]);
    const remove = screen.getByRole('button', { name: '移除 first.md' });
    for (let index = 0; index < 12 && document.activeElement !== remove; index += 1) await user.tab();
    expect(remove).toHaveFocus();
    await user.keyboard(key);
    expect(screen.queryByRole('button', { name: '移除 first.md' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '移除 second.md' })).toBeEnabled();
  });

  it('导入未完成时禁用移除和重复提交，失败后保留文件并恢复操作', async () => {
    const user = userEvent.setup();
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, fail) => {
      reject = fail;
    });
    const onImport = vi.fn().mockReturnValue(pending);
    const onOpenChange = vi.fn();
    const file = new File(['# 合成正文'], 'pending.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'text', { value: async () => '# 合成正文' });
    render(<MarkdownImportDialog isOpen folderName="合成目录" onOpenChange={onOpenChange} onImport={onImport} />);
    expect(screen.getByRole('button', { name: /^导入$/ })).toBeDisabled();
    await user.upload(screen.getByLabelText('拖放 Markdown 文件到这里'), file);
    const submit = screen.getByRole('button', { name: '导入 1 篇' });
    await user.click(submit);
    const remove = screen.getByRole('button', { name: '移除 pending.md' });
    expect(remove).toBeDisabled();
    await user.click(remove);
    await user.click(submit);
    expect(onImport).toHaveBeenCalledExactlyOnceWith([{ fileName: 'pending.md', rawMarkdown: '# 合成正文' }]);
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => {
      reject(new Error('合成导入失败'));
      await pending.catch(() => undefined);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('合成导入失败');
    expect(remove).toBeEnabled();
    await user.click(remove);
    expect(screen.queryByText('pending.md')).not.toBeInTheDocument();
  });
});
