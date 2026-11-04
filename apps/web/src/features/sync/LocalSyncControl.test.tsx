import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSyncControl } from './LocalSyncControl';

const local = vi.hoisted(() => ({ refresh: vi.fn(), draft: false }));
vi.mock('../../store/AppStoreProvider', () => {
  const store = { getState: () => ({ refreshLocalWorkspace: local.refresh }) };
  return {
    useAppStoreApi: () => store,
    useAppStore: (selector: (state: { editorHasLocalChanges: boolean; saveState: string }) => unknown) => selector({ editorHasLocalChanges: local.draft, saveState: 'saved' })
  };
});
vi.mock('./BackupRestoreDialog', () => ({ BackupRestoreDialog: () => null }));

const initial = () => ({ serverUrl: 'https://example.test', generation: 1, phase: 'synced', pendingNotes: 0, pendingEntities: 0,
  lastSyncedAt: null, conflicts: [], error: null, blockedNotes: [] });
let current = initial();
const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({ data: current })));
const polls = () => fetcher.mock.calls.filter(([url, options]) => url === '/api/local-runtime/sync' && options?.method === 'GET').length;
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function mount() { await act(async () => { render(<LocalSyncControl />); }); }

beforeEach(() => {
  vi.useFakeTimers(); current = initial(); local.draft = false; local.refresh.mockReset().mockResolvedValue(true); fetcher.mockClear();
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('桌面同步省电轮询', () => {
  it('正常空闲每 10 秒查询，不刷新工作区；待同步时改为 2 秒', async () => {
    await mount(); expect(polls()).toBe(1);
    await tick(9999); expect(polls()).toBe(1);
    current = { ...current, pendingEntities: 1, phase: 'pending' };
    await tick(1); expect(polls()).toBe(2);
    await tick(2000); expect(polls()).toBe(3);
    expect(local.refresh).not.toHaveBeenCalled();
  });

  it('资料版本改变才刷新；草稿阻止刷新后继续重试', async () => {
    await mount();
    local.refresh.mockResolvedValueOnce(false);
    current = { ...current, generation: 2 };
    await tick(10000); expect(local.refresh).toHaveBeenCalledTimes(1);
    await tick(10000); expect(local.refresh).toHaveBeenCalledTimes(2);
    await tick(10000); expect(local.refresh).toHaveBeenCalledTimes(2);
  });

  it('晚到的旧状态不能回退已接受的资料版本并反复刷新', async () => {
    await mount(); current = { ...current, generation: 3 };
    await tick(10000); expect(local.refresh).toHaveBeenCalledTimes(1);
    current = { ...current, generation: 2 };
    await tick(10000); expect(local.refresh).toHaveBeenCalledTimes(1);
    current = { ...current, generation: 3 };
    await tick(10000); expect(local.refresh).toHaveBeenCalledTimes(1);
  });

  it('面板打开采用 2 秒查询，立即同步无资料变化时不刷新工作区', async () => {
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '本地资料已同步' })); });
    const before = polls(); await tick(2000); expect(polls()).toBe(before + 1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '立即同步' })); });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/retry'))).toBe(true);
    expect(local.refresh).not.toHaveBeenCalled();
  });

  it('隐藏时停止查询，重新可见/聚焦/联网使用 wake，不清除阻塞记录', async () => {
    await mount();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    await tick(60000); expect(polls()).toBe(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => { fireEvent(document, new Event('visibilitychange')); fireEvent(window, new Event('focus')); fireEvent(window, new Event('online')); });
    expect(polls()).toBeGreaterThan(1);
    const wakes = fetcher.mock.calls.filter(([url]) => url.endsWith('/wake'));
    expect(wakes.some(([, options]) => JSON.parse(String(options?.body)).reason === 'online')).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/retry'))).toBe(false);
  });

  it('慢查询不重叠，卸载后不再安排查询', async () => {
    let release: (response: Response) => void = () => {};
    fetcher.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await mount(); await tick(60000); expect(polls()).toBe(1);
    cleanup();
    await act(async () => { release(new Response(JSON.stringify({ data: current }))); });
    await tick(60000); expect(polls()).toBe(1);
  });
});
