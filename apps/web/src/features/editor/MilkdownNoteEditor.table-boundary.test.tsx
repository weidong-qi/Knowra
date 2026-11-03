import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { MilkdownNoteEditor } from './MilkdownNoteEditor';
import type { EditorCommandTarget } from './editorCommands';

const markdown = '| 参数 | 范围 |\n| --- | --- |\n| brightness | 0.1 |\n| contrast | 0.2 |\n| saturation | 0.3 |\n| hue | 0.4 |\n';
afterEach(() => { cleanup(); Reflect.deleteProperty(document, 'elementFromPoint'); });

async function focusCell(element: Element) {
  (element.closest('.ProseMirror') as HTMLElement).focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  // ProseMirror 的 selectionchange 监听异步同步 DOM 选区。
  await new Promise(resolve => setTimeout(resolve, 30));
}

it.each(['paragraph-above', 'paragraph-below'] as const)('%s 从非末格插入不拆表，序列化和父组件回传稳定', async command => {
  const onChange = vi.fn(); const onReady = vi.fn(); const ref = createRef<EditorCommandTarget>();
  const props = { ref, noteId: 'table-boundary', markdown, readOnly: false, onChange, onReady };
  const rendered = render(<MilkdownNoteEditor {...props} />);
  await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  const editor = rendered.container.querySelector('.ProseMirror')!;
  const originalCells = [...editor.querySelectorAll('th, td')].map(cell => cell.textContent);
  await focusCell(editor.querySelector('tr:last-child td:first-child')!);
  expect(ref.current!.run(command)).toBe(true);
  expect(editor.querySelectorAll('table')).toHaveLength(1);
  expect([...editor.querySelectorAll('th, td')].map(cell => cell.textContent)).toEqual(originalCells);
  expect(editor.querySelectorAll(':scope > p')).toHaveLength(1);
  const result = ref.current!.getMarkdown();
  rendered.rerender(<MilkdownNoteEditor {...props} markdown={result} />);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(ref.current!.getMarkdown()).toBe(result);
  expect(editor.querySelectorAll('table')).toHaveLength(1);
  expect(onChange.mock.calls.length).toBeLessThanOrEqual(1);
  expect(ref.current!.run('undo')).toBe(true);
  expect([...editor.querySelectorAll('th, td')].map(cell => cell.textContent)).toEqual(originalCells);
  expect(editor.querySelectorAll(':scope > p')).toHaveLength(0);
});

it('只读表格不能插段落，恢复可编辑后仍可使用', async () => {
  const ref = createRef<EditorCommandTarget>(); const onReady = vi.fn(); const onChange = vi.fn();
  const props = { ref, noteId: 'readonly-table', markdown, readOnly: true, onReady, onChange };
  const rendered = render(<MilkdownNoteEditor {...props} />);
  await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  expect(ref.current!.run('paragraph-below')).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
  rendered.rerender(<MilkdownNoteEditor {...props} readOnly={false} />);
  await focusCell(rendered.container.querySelector('td')!);
  expect(ref.current!.run('paragraph-below')).toBe(true);
});

it('文末表格空白处点击仅补一次正文，只读及表格内部点击不写入', async () => {
  // jsdom 无布局命中 API；非处理分支交回 ProseMirror 时返回未命中。真实命中另由 E2E 验证。
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
  const ref = createRef<EditorCommandTarget>(); const onReady = vi.fn(); const onChange = vi.fn();
  const props = { ref, noteId: 'table-click', markdown, readOnly: true, onReady, onChange };
  const rendered = render(<MilkdownNoteEditor {...props} />);
  await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  const editor = rendered.container.querySelector('.ProseMirror')!;
  const table = editor.querySelector('table')!;
  vi.spyOn(table, 'getBoundingClientRect').mockReturnValue({ bottom: 100 } as DOMRect);
  fireEvent.mouseDown(editor, { button: 0, clientY: 120 });
  expect(editor.querySelectorAll(':scope > p')).toHaveLength(0);
  expect(onChange).not.toHaveBeenCalled();
  rendered.rerender(<MilkdownNoteEditor {...props} readOnly={false} />);
  fireEvent.mouseDown(table, { button: 0, clientY: 80 });
  expect(editor.querySelectorAll(':scope > p')).toHaveLength(0);
  fireEvent.mouseDown(editor, { button: 0, clientY: 120 });
  expect(editor.querySelectorAll(':scope > p')).toHaveLength(1);
  fireEvent.mouseDown(editor, { button: 0, clientY: 120 });
  expect(editor.querySelectorAll(':scope > p')).toHaveLength(1);
  expect(editor.querySelectorAll('tr')).toHaveLength(5);
});
