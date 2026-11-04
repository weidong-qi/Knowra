import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Tag } from '@study-accelerator/web-core';
import { useTagPickerController, type TagPickerProps } from './useTagPickerController';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function props(): TagPickerProps {
  return { isOpen: true, triggerRef: { current: null }, tags: [], groups: [
    { id: 'ordinary', spaceId: 'space', code: 'ordinary', name: '普通', selectionMode: 'multiple', isSystem: true, sortOrder: 0 }
  ], selectedTagIds: [], canWrite: true, onOpenChange: vi.fn(), onCreateTag: vi.fn(), onSave: vi.fn() };
}

describe('标签面板异步会话', () => {
  it.each(['resolve', 'reject'] as const)('外部关闭重开后忽略旧保存的 %s', async outcome => {
    const request = deferred<void>();
    const options = { ...props(), onSave: vi.fn(() => request.promise) };
    const { result, rerender } = renderHook(useTagPickerController, { initialProps: options });
    let task!: Promise<void>;
    act(() => { task = result.current.save(); });
    act(() => { void result.current.save(); result.current.requestOpenChange(false); });
    expect(options.onSave).toHaveBeenCalledTimes(1);
    expect(options.onOpenChange).not.toHaveBeenCalled();
    rerender({ ...options, isOpen: false });
    rerender({ ...options, isOpen: true });
    act(() => result.current.setQuery('新会话'));
    await act(async () => { outcome === 'resolve' ? request.resolve() : request.reject(new Error('旧失败')); await task; });
    expect(options.onOpenChange).not.toHaveBeenCalled();
    expect(result.current.query).toBe('新会话');
    expect(result.current.error).toBe('');
    expect(result.current.pending).toBe(false);
  });

  it('旧创建完成后不改变新会话的模式、草稿或 pending', async () => {
    const request = deferred<Tag>();
    const options = { ...props(), onCreateTag: vi.fn(() => request.promise) };
    const { result, rerender } = renderHook(useTagPickerController, { initialProps: options });
    act(() => result.current.openCreate('select', '旧标签'));
    let task!: Promise<void>;
    act(() => { task = result.current.submitTag(); });
    rerender({ ...options, isOpen: false });
    rerender({ ...options, isOpen: true });
    act(() => result.current.openCreate('manage', '新标签'));
    await act(async () => { request.resolve({ id: 'old', name: '旧标签', groupId: 'ordinary', color: 'blue' }); await task; });
    expect(result.current.mode).toBe('form');
    expect(result.current.name).toBe('新标签');
    expect(result.current.notice).toBe('');
    expect(result.current.selected.size).toBe(0);
  });
});
