import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditorDocumentRepairDialog } from './EditorDocumentRepairDialog';

describe('EditorDocumentRepairDialog', () => {
  it('previews anomalies and applies the repaired markdown explicitly', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <EditorDocumentRepairDialog
        markdown={'正文\n\n\n\\\n结尾'}
        open
        onApply={onApply}
        onOpenChange={onOpenChange}
      />
    );
    expect(screen.getByRole('list', { name: '异常格式检查结果' })).toHaveTextContent('多余空行：1');
    expect(screen.getByRole('list', { name: '异常格式检查结果' })).toHaveTextContent('独立反斜杠：1');
    await user.click(screen.getByRole('button', { name: '应用修复' }));
    expect(onApply).toHaveBeenCalledWith('正文\n\n结尾', {
      excessiveBlankLines: 1,
      standaloneBackslashes: 1,
      total: 2
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the apply action disabled when no anomaly exists', () => {
    render(
      <EditorDocumentRepairDialog
        markdown={'正文\n\n结尾'}
        open
        onApply={vi.fn()}
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('未发现');
    expect(screen.getByRole('button', { name: '无需修复' })).toBeDisabled();
  });
});
