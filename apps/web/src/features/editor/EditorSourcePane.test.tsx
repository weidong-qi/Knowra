import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorSourcePane } from './EditorSourcePane';

describe('EditorSourcePane', () => {
  it('edits Markdown through a labelled source textarea and delegates save', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    render(<EditorSourcePane markdown="# 标题" readOnly={false} onChange={onChange} onSave={onSave} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 源码编辑器' }), { target: { value: '## 新标题' } });
    expect(onChange).toHaveBeenCalledWith('## 新标题');
    fireEvent.click(screen.getByRole('button', { name: '保存源码' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('keeps source visible but read-only when workspace writes are unavailable', () => {
    render(<EditorSourcePane markdown="text" readOnly onChange={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Markdown 源码编辑器' })).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: '保存源码' })).toBeDisabled();
  });
});
