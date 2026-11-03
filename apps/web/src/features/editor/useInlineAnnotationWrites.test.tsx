import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Annotation, Note } from '@study-accelerator/web-core';
import type { EditorCommandTarget } from './editorCommands';
import { useInlineAnnotationWrites } from './useInlineAnnotationWrites';

it('切换笔记后旧保存回执不覆盖新笔记的重点状态', async () => {
  let finish!: () => void;
  const oldRow = {
    id: 'row-A',
    noteId: 'A',
    schemaVersion: 3,
    lifecycleStatus: 'active',
    anchor: { markId: 'mark-A' }
  } as unknown as Annotation;
  const setAnnotations = vi.fn();
  const setFocusedAnnotationId = vi.fn();
  const onFileStatus = vi.fn();
  const options = {
    note: { id: 'A' } as Note,
    canEditContent: true,
    annotations: [],
    annotationsLoading: false,
    annotationsReady: true,
    editorRef: {
      current: {
        getMarkdown: () => 'A text',
        inlineAnnotations: { create: () => 'mark-A' }
      } as unknown as EditorCommandTarget
    },
    autosave: {
      saveNow: vi.fn(
        () =>
          new Promise<void>(resolve => {
            finish = resolve;
          })
      )
    },
    onListAnnotations: vi.fn(async () => [oldRow]),
    setAnnotations,
    setFocusedAnnotationId,
    onFileStatus
  };
  const { result, rerender } = renderHook(useInlineAnnotationWrites, { initialProps: options });
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.create('selection');
  });
  rerender({
    ...options,
    note: { id: 'B' } as Note,
    editorRef: {
      current: {
        getMarkdown: () => 'B text',
        inlineAnnotations: { create: () => 'mark-B' }
      } as unknown as EditorCommandTarget
    }
  });
  await act(async () => {
    finish();
    await expect(pending).rejects.toThrow('笔记或编辑状态已变化');
  });
  expect(setAnnotations).not.toHaveBeenCalled();
  expect(setFocusedAnnotationId).not.toHaveBeenCalled();
  expect(onFileStatus).not.toHaveBeenCalled();
});

it('保存未派生重点时不得提示创建成功', async () => {
  const status = vi.fn();
  const options = {
    note: { id: 'A' } as Note,
    canEditContent: true,
    annotations: [],
    annotationsLoading: false,
    annotationsReady: true,
    editorRef: {
      current: {
        getMarkdown: () => 'A text',
        inlineAnnotations: { create: () => 'mark-A' }
      } as unknown as EditorCommandTarget
    },
    autosave: { saveNow: vi.fn(async () => {}) },
    onListAnnotations: vi.fn(async () => []),
    setAnnotations: vi.fn(),
    setFocusedAnnotationId: vi.fn(),
    onFileStatus: status
  };
  const { result } = renderHook(useInlineAnnotationWrites, { initialProps: options });
  await expect(result.current.create('selection')).rejects.toThrow();
  expect(status).not.toHaveBeenCalledWith('已标为重点');
});

it('读取重点失败时不误用内联写入，保存响应丢失重试复用原标记', async () => {
  const create = vi.fn(() => 'mark-A');
  const row = {
    id: 'row-A',
    noteId: 'A',
    schemaVersion: 3,
    lifecycleStatus: 'active',
    anchor: { markId: 'mark-A' }
  } as unknown as Annotation;
  const options = {
    note: { id: 'A' } as Note,
    canEditContent: true,
    annotations: [],
    annotationsLoading: false,
    annotationsReady: false,
    editorRef: {
      current: { getMarkdown: () => 'A text', inlineAnnotations: { create } } as unknown as EditorCommandTarget
    },
    autosave: { saveNow: vi.fn(async () => {}) },
    onListAnnotations: vi.fn(async () => [row]),
    setAnnotations: vi.fn(),
    setFocusedAnnotationId: vi.fn(),
    onFileStatus: vi.fn()
  };
  const { result, rerender } = renderHook(useInlineAnnotationWrites, { initialProps: options });
  expect(result.current.enabled).toBe(false);
  await expect(result.current.create('selection')).rejects.toThrow('尚未成功加载');
  expect(create).not.toHaveBeenCalled();
  rerender({ ...options, annotationsReady: true });
  options.autosave.saveNow.mockRejectedValueOnce(new Error('响应丢失'));
  await expect(result.current.create('selection')).rejects.toThrow('响应丢失');
  expect(options.onFileStatus).not.toHaveBeenCalled();
  await result.current.create('selection');
  expect(create).toHaveBeenCalledTimes(1);
  expect(options.setFocusedAnnotationId).toHaveBeenCalledWith('row-A');
});

it('失败后撤销或改选内容时不重试已失效的旧请求', async () => {
  let markdown = '原文';
  let selection = '第一段';
  const create = vi.fn(() => {
    markdown += '<mark>';
    return `mark-${create.mock.calls.length}`;
  });
  const options = {
    note: { id: 'A' } as Note,
    canEditContent: true,
    annotations: [],
    annotationsLoading: false,
    annotationsReady: true,
    editorRef: {
      current: {
        getMarkdown: () => markdown,
        getAnnotationSelection: () => selection,
        inlineAnnotations: { create }
      } as unknown as EditorCommandTarget
    },
    autosave: {
      saveNow: vi.fn(async () => {
        throw new Error('保存失败');
      })
    },
    onListAnnotations: vi.fn(async () => []),
    setAnnotations: vi.fn(),
    setFocusedAnnotationId: vi.fn(),
    onFileStatus: vi.fn()
  };
  const { result } = renderHook(useInlineAnnotationWrites, { initialProps: options });
  await expect(result.current.create('selection')).rejects.toThrow('保存失败');
  markdown = '原文';
  await expect(result.current.create('selection')).rejects.toThrow('保存失败');
  expect(create).toHaveBeenCalledTimes(2);
  selection = '另一段';
  await expect(result.current.create('selection')).rejects.toThrow('保存失败');
  expect(create).toHaveBeenCalledTimes(3);
});
