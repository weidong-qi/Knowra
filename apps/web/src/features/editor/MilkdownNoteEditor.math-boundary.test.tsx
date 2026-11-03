import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { MilkdownNoteEditor } from './MilkdownNoteEditor';
import type { EditorCommandTarget } from './editorCommands';

afterEach(cleanup);

it('keeps trailing math normalization out of onChange on load, focus and external refresh', async () => {
  const onChange = vi.fn();
  const onReady = vi.fn();
  const ref = createRef<EditorCommandTarget>();
  const md = '$$\nx^2\n$$\n';
  const props = { ref, noteId: 'math-boundary', markdown: md, readOnly: false, onChange, onReady };
  const rendered = render(<MilkdownNoteEditor {...props} />);
  await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  expect(rendered.container.querySelector('.ProseMirror')?.children).toHaveLength(2);
  expect(ref.current?.getMarkdown()).toBe(md);
  expect(ref.current?.matchesMarkdownDocument?.(md)).toBe(true);
  fireEvent.pointerDown(rendered.container.querySelector('.ProseMirror > p')!);
  fireEvent.focus(rendered.container.querySelector('.ProseMirror')!);
  rendered.rerender(<MilkdownNoteEditor {...props} readOnly />);
  rendered.rerender(<MilkdownNoteEditor {...props} markdown={'$$\ny^2\n$$\n'} />);
  await waitFor(() => expect(ref.current?.getMarkdown()).toBe('$$\ny^2\n$$\n'));
  expect(rendered.container.querySelector('.ProseMirror')?.children).toHaveLength(2);
  expect(ref.current?.matchesMarkdownDocument?.('$$\ny^2\n$$\n')).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
  expect(ref.current?.run('undo')).toBe(false);
});
