import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { MilkdownNoteEditor } from './MilkdownNoteEditor';
import type { EditorCommandTarget } from './editorCommands';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

it('End 同步收起整段选区，随后立即离焦插图仍保留正文', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const markdown = '原始内容 离线新增中文正文';
  const ref = createRef<EditorCommandTarget>();
  const onReady = vi.fn();
  const rendered = render(
    <>
      <MilkdownNoteEditor
        ref={ref}
        noteId="image-caret"
        markdown={markdown}
        readOnly={false}
        onChange={vi.fn()}
        onReady={onReady}
      />
      <button>插入图片</button>
    </>
  );
  await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  const editor = rendered.container.querySelector<HTMLElement>('.ProseMirror')!;
  const text = editor.querySelector('p')!.firstChild!;
  const selection = window.getSelection()!;
  act(() => {
    editor.focus();
    selection.setBaseAndExtent(text, 0, text, markdown.length);
    fireEvent(document, new Event('selectionchange'));
  });
  expect(ref.current!.getAnnotationSelection()?.quoteText).toBe(markdown);

  act(() => {
    // 模拟原生右方向键已收起 DOM 选区，但 selectionchange 尚未交给编辑器。
    // End 的应用层处理必须同步更新 ProseMirror 及其记忆选区，不能等下一帧。
    selection.collapse(text, markdown.length);
    fireEvent.keyDown(editor, { key: 'End', code: 'End', keyCode: 35 });
    rendered.getByRole('button', { name: '插入图片' }).focus();
    fireEvent(document, new Event('selectionchange'));
    expect(ref.current!.insertImage('/api/storage/attachments/caret/content', '离线图片.png')).toBe(true);
  });
  expect(editor.textContent).toBe(markdown);
  expect(ref.current!.getMarkdown()).toContain(markdown);
  expect(ref.current!.getMarkdown()).toContain('/api/storage/attachments/caret/content');
  expect(editor.querySelector('img')!.previousSibling?.textContent).toBe(markdown);
});

it.each(['selected', 'Home', 'End'] as const)('全选标记后插图保留明确选区语义：%s', async scenario => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // jsdom 没有 Range 布局；仅补充滚动测量接口，不干预选区或编辑命令。
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
  });
  const markdown = '原始内容 离线新增中文正文';
  const ref = createRef<EditorCommandTarget>();
  const onReady = vi.fn();
  const onChange = vi.fn();
  const rendered = render(
    <>
      <MilkdownNoteEditor
        ref={ref}
        noteId="image-caret"
        markdown={markdown}
        readOnly={false}
        onChange={onChange}
        onReady={onReady}
      />
      <button>插入图片</button>
    </>
  );
  await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  const editor = rendered.container.querySelector<HTMLElement>('.ProseMirror')!;
  act(() => {
    editor.focus();
    expect(fireEvent.keyDown(editor, { key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true })).toBe(false);
    ref.current!.inlineAnnotations!.create('selection', 'normal');
  });
  expect(ref.current!.getAnnotationSelection('selection', { restoreSelection: false })?.quoteText).toBe(markdown);

  act(() => {
    // 不发送原生 selectionchange：Home/End 必须由真实按键处理同步更新模型。
    if (scenario !== 'selected') {
      expect(fireEvent.keyDown(editor, { key: scenario, code: scenario, keyCode: scenario === 'Home' ? 36 : 35 })).toBe(
        false
      );
    }
    rendered.getByRole('button', { name: '插入图片' }).focus();
    expect(ref.current!.getAnnotationSelection('selection', { restoreSelection: false })?.quoteText).toBe(
      scenario === 'selected' ? markdown : undefined
    );
    expect(ref.current!.insertImage('/api/storage/attachments/caret/content', '离线图片.png')).toBe(true);
  });
  const output = ref.current!.getMarkdown();
  expect(editor.textContent).toBe(scenario === 'selected' ? '' : markdown);
  expect(output).toContain('/api/storage/attachments/caret/content');
  if (scenario === 'selected') {
    expect(output).toBe('![离线图片.png](/api/storage/attachments/caret/content)\n');
  } else {
    expect(output).toContain(markdown);
    const image = editor.querySelector('img')!;
    expect(scenario === 'Home' ? image.nextSibling?.textContent : image.previousSibling?.textContent).toBe(markdown);
  }
  // 输出给自动保存的正文与编辑器最终正文完全一致，不存在仅保存层删掉文字。
  expect(onChange.mock.calls.at(-1)?.[0]).toBe(output);
});

it.each([
  { markdown: '第一段\n\n末段', key: 'Home', handled: true },
  { markdown: '第一段\n\n末段', key: 'End', handled: true },
  { markdown: '', key: 'Home', handled: true },
  { markdown: '', key: 'End', handled: true },
  { markdown: '---\n\n末段', key: 'Home', handled: false },
  { markdown: '第一段\n\n---', key: 'End', handled: false },
  { markdown: '---', key: 'Home', handled: false },
  { markdown: '---', key: 'End', handled: false },
  { markdown: '正文', key: 'End', handled: false, shiftKey: true },
  { markdown: '正文', key: 'End', handled: false, ctrlKey: true },
  { markdown: '正文', key: 'End', handled: false, metaKey: true },
  { markdown: '正文', key: 'End', handled: false, altKey: true },
  { markdown: '正文', key: 'End', handled: false, readOnly: true },
  { markdown: '正文', key: 'End', handled: false, isComposing: true }
])(
  '全选边界不扩展非文本或修饰键行为：$key $markdown $handled',
  async ({ markdown, key, handled, readOnly = false, isComposing = false, ...modifiers }) => {
    const ref = createRef<EditorCommandTarget>();
    const onReady = vi.fn();
    const rendered = render(
      <MilkdownNoteEditor
        ref={ref}
        noteId="selection-edge"
        markdown={markdown}
        readOnly={readOnly}
        onChange={vi.fn()}
        onReady={onReady}
      />
    );
    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    const editor = rendered.container.querySelector<HTMLElement>('.ProseMirror')!;
    act(() => {
      editor.focus();
      fireEvent.keyDown(editor, { key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true });
      const before = ref.current!.getMarkdown();
      expect(
        fireEvent.keyDown(editor, { key, code: key, keyCode: key === 'Home' ? 36 : 35, isComposing, ...modifiers })
      ).toBe(!handled);
      if (handled) expect(window.getSelection()!.isCollapsed).toBe(true);
      expect(ref.current!.getMarkdown()).toBe(before);
    });
  }
);
