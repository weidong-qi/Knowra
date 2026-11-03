import { render, screen, waitFor } from '@testing-library/react';
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
