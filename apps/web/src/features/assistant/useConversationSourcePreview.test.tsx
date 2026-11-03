import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConversationSourcePreview } from './useConversationSourcePreview';
import type { SourceRef } from './conversationApi';

const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto');

const version = { content: '前文 alpha 后文', contentHash: 'e1ad18f75b0295b8a3845a76fc8e148b8eef2107f58336fe9bca6a23ebb608d6' };
const ref: SourceRef = { noteId: 'note-1', noteVersionId: 'version-1', contentHash: version.contentHash,
  start: 3, end: 8, quoteHash: '8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(getNoteVersion = vi.fn(async () => version)) {
  const onError = vi.fn();
  const hook = renderHook(() => useConversationSourcePreview({
    spaceId: 'space', conversationId: 'conversation', getNoteVersion, onError
  }), { wrapper: StrictMode });
  return { ...hook, onError, getNoteVersion };
}
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

it('真实 SHA-256 核验完整正文与片段，保留只读输入和 store 参数', async () => {
  const frozen = Object.freeze({ ...ref });
  const { result, getNoteVersion, onError } = setup(vi.fn(async () => Object.freeze({ ...version })));
  await act(() => result.current.openSource(frozen, 'answer'));
  expect(getNoteVersion).toHaveBeenCalledWith('note-1', 'version-1');
  expect(result.current.sourceView).toEqual({ ref, text: version.content, messageId: 'answer' });
  expect(onError.mock.calls).toEqual([[null]]);
});

it.each([
  { changedRef: { contentHash: 'wrong' }, changedVersion: {}, message: '历史原文与引用范围不一致。' },
  { changedRef: { start: -1 }, changedVersion: {}, message: '历史原文与引用范围不一致。' },
  { changedRef: { end: 12 }, changedVersion: {}, message: '历史原文与引用范围不一致。' },
  { changedRef: { end: 3 }, changedVersion: {}, message: '历史原文与引用范围不一致。' },
  { changedRef: {}, changedVersion: { content: '前文 bravo 后文' }, message: '引用原文校验失败。' },
  { changedRef: { quoteHash: 'wrong' }, changedVersion: {}, message: '引用原文校验失败。' }
])('拒绝不匹配的范围或哈希 $changedRef $changedVersion', async ({ changedRef, changedVersion, message }) => {
  const { result, onError } = setup(vi.fn(async () => ({ ...version, ...changedVersion })));
  await act(() => result.current.openSource({ ...ref, ...changedRef }, 'answer'));
  expect(result.current.sourceView).toBeNull();
  expect(onError).toHaveBeenLastCalledWith(message);
});

it('未提供 Web Crypto 时保留既有元数据与范围校验路径', async () => {
  vi.stubGlobal('crypto', undefined);
  const { result, onError } = setup();
  await act(() => result.current.openSource(ref, 'answer'));
  expect(result.current.sourceView?.text).toBe(version.content);
  await act(() => result.current.openSource({ ...ref, end: 99 }, 'answer'));
  expect(onError).toHaveBeenLastCalledWith('历史原文与引用范围不一致。');
});

it.each([new Error('同步读取失败'), 'non-error'])('同步读取抛错被接住并保留错误语义 %s', async cause => {
  const { result, onError } = setup(vi.fn(() => { throw cause; }));
  await act(() => result.current.openSource(ref, 'answer'));
  expect(onError).toHaveBeenLastCalledWith(cause instanceof Error ? cause.message : '无法读取引用原文。');
});

it.each(['success', 'error'])('卸载后不发布在途读取的 %s', async outcome => {
  const pending = deferred<typeof version>();
  const { result, unmount, onError } = setup(vi.fn(() => pending.promise));
  let opening!: Promise<void>;
  act(() => { opening = result.current.openSource(ref, 'answer'); });
  unmount();
  await act(async () => {
    if (outcome === 'error') pending.reject(new Error('迟到失败')); else pending.resolve(version);
    await opening;
  });
  expect(onError.mock.calls).toEqual([[null]]);
});

it.each(['close', 'unmount'])('SHA-256 计算期间 %s 后不能发布迟到的校验失败', async action => {
  const pending = deferred<ArrayBuffer>();
  const digest = vi.fn(() => pending.promise);
  vi.stubGlobal('crypto', { subtle: { digest } });
  const { result, unmount, onError } = setup();
  let opening!: Promise<void>;
  await act(async () => { opening = result.current.openSource(ref, 'answer'); await Promise.resolve(); });
  expect(digest).toHaveBeenCalledTimes(1);
  if (action === 'unmount') unmount(); else act(() => result.current.closeSource());
  await act(async () => { pending.resolve(new ArrayBuffer(32)); await opening; });
  expect(result.current.sourceView).toBeNull();
  expect(onError.mock.calls).toEqual([[null]]);
});

it('旧请求失败不会干扰新的未完成读取，后者仍可发布', async () => {
  const older = deferred<typeof version>();
  const newer = deferred<typeof version>();
  const { result, onError } = setup(vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise));
  let first!: Promise<void>; let second!: Promise<void>;
  act(() => { first = result.current.openSource(ref, 'old'); second = result.current.openSource(ref, 'new'); });
  await act(async () => { older.reject(new Error('旧请求失败')); await first; });
  expect(onError.mock.calls).toEqual([[null], [null]]);
  expect(result.current.sourceView).toBeNull();
  await act(async () => { newer.resolve(version); await second; });
  expect(result.current.sourceView?.messageId).toBe('new');
});

it.each(['close', 'context', 'supersede'])('片段 SHA-256 成功前 %s 后仍执行最终发布权检查', async action => {
  const gate = deferred<void>();
  let calls = 0;
  const digest = vi.fn(async (...args: Parameters<SubtleCrypto['digest']>) => {
    const call = ++calls;
    const hash = await webcrypto.subtle.digest(...args);
    if (call === 2) await gate.promise;
    return hash;
  });
  vi.stubGlobal('crypto', { subtle: { digest } });
  const onError = vi.fn();
  const { result, rerender } = renderHook(({ conversationId }) => useConversationSourcePreview({
    spaceId: 'space', conversationId, getNoteVersion: async () => version, onError
  }), { initialProps: { conversationId: 'A' }, wrapper: StrictMode });
  let opening!: Promise<void>;
  act(() => { opening = result.current.openSource(ref, 'old'); });
  await waitFor(() => expect(digest).toHaveBeenCalledTimes(2));
  if (action === 'context') { rerender({ conversationId: 'B' }); rerender({ conversationId: 'A' }); }
  else if (action === 'close') act(() => result.current.closeSource());
  else await act(() => result.current.openSource(ref, 'new'));
  await act(async () => { gate.resolve(); await opening; });
  expect(result.current.sourceView?.messageId ?? null).toBe(action === 'supersede' ? 'new' : null);
  expect(onError.mock.calls).toEqual(action === 'supersede' ? [[null], [null]] : [[null]]);
});
