import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileDropField } from './FileDropField';

describe('FileDropField', () => {
  it('offers a keyboard-accessible chooser and accepts dropped files', async () => {
    const onSelect = vi.fn();
    render(
      <FileDropField
        accept=".md"
        multiple
        label="选择 Markdown"
        description="支持拖放"
        onSelect={onSelect}
      />
    );
    const input = screen.getByLabelText('选择 Markdown');
    const selected = new File(['# Selected'], 'selected.md', { type: 'text/markdown' });
    await userEvent.upload(input, selected);
    expect(onSelect).toHaveBeenLastCalledWith([selected]);

    const dropped = new File(['# Dropped'], 'dropped.md', { type: 'text/markdown' });
    fireEvent.drop(screen.getByText('支持拖放').closest('div')!, {
      dataTransfer: { files: [dropped] }
    });
    expect(onSelect).toHaveBeenLastCalledWith([dropped]);
  });
});
