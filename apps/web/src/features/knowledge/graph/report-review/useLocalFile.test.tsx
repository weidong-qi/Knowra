import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLocalFile } from './useLocalFile';
const file = (text: () => Promise<string>, size = 1) => ({ text, size }) as File;
describe('本地报告文件读取生命周期', () => {
  it('读取前限制大小，错误和取消不替换旧报告，同文件可重试', async () => {
    const loaded = vi.fn(); const parse = vi.fn(JSON.parse);
    const { result } = renderHook(() => useLocalFile(parse, 10, loaded));
    const text = vi.fn(async () => '{}');
    await act(() => result.current.read(file(text, 11)));
    expect(text).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled();
    await act(() => result.current.read(file(async () => '{')));
    expect(loaded).not.toHaveBeenCalled(); expect(result.current.error).toContain('已保留');
    await act(() => result.current.read()); expect(loaded).not.toHaveBeenCalled();
    const same = file(text); await act(() => result.current.read(same)); await act(() => result.current.read(same));
    expect(loaded).toHaveBeenCalledTimes(2);
  });
  it('慢 A 不能覆盖 B，取消和重置使读取失效，卸载不回调', async () => {
    const loaded = vi.fn(); const parse = vi.fn(JSON.parse);
    let finish!: (text: string) => void;
    const slow = () => file(() => new Promise(resolve => { finish = resolve; }));
    const { result, unmount } = renderHook(() => useLocalFile(parse, 10, loaded));
    let pending!: Promise<void>;
    act(() => { pending = result.current.read(slow()); });
    await act(() => result.current.read(file(async () => '{"b":1}')));
    await act(async () => { finish('{"a":1}'); await pending; });
    expect(loaded.mock.calls).toEqual([[{ b: 1 }]]);
    for (const cancel of [() => result.current.read(), () => result.current.invalidate()]) {
      act(() => { pending = result.current.read(slow()); });
      await act(cancel); await act(async () => { finish('{}'); await pending; });
    }
    act(() => { pending = result.current.read(slow()); }); unmount(); finish('{}'); await pending;
    expect(loaded).toHaveBeenCalledTimes(1); expect(parse).toHaveBeenCalledTimes(1);
  });
});
