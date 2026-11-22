import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSyncControl } from './LocalSyncControl';
import type { SyncStatus } from './localSyncApi';

const local = vi.hoisted(() => ({ refresh: vi.fn(), draft: false }));
vi.mock('../../store/AppStoreProvider', () => {
  const store = { getState: () => ({ refreshLocalWorkspace: local.refresh }) };
  return {
    useAppStoreApi: () => store,
    useAppStore: (selector: (state: { editorHasLocalChanges: boolean; saveState: string }) => unknown) =>
      selector({ editorHasLocalChanges: local.draft, saveState: 'saved' })
  };
});
vi.mock('./BackupRestoreDialog', () => ({ BackupRestoreDialog: () => null }));

const initial = (): SyncStatus => ({
  serverUrl: 'https://example.test',
  generation: 1,
  phase: 'synced',
  pendingNotes: 0,
  pendingEntities: 0,
  lastSyncedAt: null,
  conflicts: [],
  error: null,
  blockedNotes: []
});
let current = initial();
const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({ data: current })));
const polls = () =>
  fetcher.mock.calls.filter(([url, options]) => url === '/api/local-runtime/sync' && options?.method === 'GET').length;
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function mount() {
  await act(async () => {
    render(<LocalSyncControl />);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  current = initial();
  local.draft = false;
  local.refresh.mockReset().mockResolvedValue(true);
  fetcher.mockClear();
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('桌面同步省电轮询', () => {
  it('正常空闲每 10 秒查询，不刷新工作区；待同步时改为 2 秒', async () => {
    await mount();
    expect(polls()).toBe(1);
    await tick(9999);
    expect(polls()).toBe(1);
    current = { ...current, pendingEntities: 1, phase: 'pending' };
    await tick(1);
    expect(polls()).toBe(2);
    await tick(2000);
    expect(polls()).toBe(3);
    expect(local.refresh).not.toHaveBeenCalled();
  });

  it('资料版本改变才刷新；草稿阻止刷新后继续重试', async () => {
    await mount();
    local.refresh.mockResolvedValueOnce(false);
    current = { ...current, generation: 2 };
    await tick(10000);
    expect(local.refresh).toHaveBeenCalledTimes(1);
    await tick(10000);
    expect(local.refresh).toHaveBeenCalledTimes(2);
    await tick(10000);
    expect(local.refresh).toHaveBeenCalledTimes(2);
  });

  it('晚到的旧状态不能回退已接受的资料版本并反复刷新', async () => {
    await mount();
    current = { ...current, generation: 3 };
    await tick(10000);
    expect(local.refresh).toHaveBeenCalledTimes(1);
    current = { ...current, generation: 2 };
    await tick(10000);
    expect(local.refresh).toHaveBeenCalledTimes(1);
    current = { ...current, generation: 3 };
    await tick(10000);
    expect(local.refresh).toHaveBeenCalledTimes(1);
  });

  it('面板打开采用 2 秒查询，立即同步无资料变化时不刷新工作区', async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '本地资料已同步' }));
    });
    const before = polls();
    await tick(2000);
    expect(polls()).toBe(before + 1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即同步' }));
    });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/retry'))).toBe(true);
    expect(local.refresh).not.toHaveBeenCalled();
  });

  it('已连接时优先显示服务状态和立即同步，凭据与诊断不占用主界面', async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '本地资料已同步' }));
    });
    expect(screen.getByRole('region', { name: '同步状态' })).toHaveTextContent('https://example.test');
    expect(screen.queryByLabelText('服务密码')).not.toBeInTheDocument();
    expect(screen.getByText('同步诊断').closest('details')).not.toHaveAttribute('open');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '连接设置' }));
    });
    expect(screen.getByLabelText('服务密码')).toBeVisible();
    expect(screen.queryByLabelText('云端服务地址')).not.toBeInTheDocument();
  });

  it('未连接时展示自建服务入口，不把账号或地址写入默认表单', async () => {
    current = { ...current, serverUrl: null, phase: 'idle' };
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /本地资料/ }));
    });
    expect(screen.getByRole('form', { name: '连接自建服务' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /云端服务地址/ })).toHaveValue('');
    expect(screen.getByLabelText('服务账号')).toHaveValue('');
    expect(screen.queryByRole('button', { name: '立即同步' })).not.toBeInTheDocument();
  });

  it('服务验证过期时显示下一步，保留上次同步时间且不能直接重试', async () => {
    current = {
      ...current,
      phase: 'auth-required',
      lastSyncedAt: '2026-10-20T08:00:00.000Z',
      error: { code: 'AUTH_REQUIRED', message: '服务要求重新验证' }
    };
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /本地资料待同步/ }));
    });
    expect(screen.getByRole('region', { name: '同步状态' })).toHaveTextContent('上次同步');
    expect(screen.getByRole('alert')).toHaveTextContent('服务要求重新验证');
    expect(screen.getByRole('button', { name: '验证并同步' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '立即同步' })).toBeDisabled();
    expect(screen.getByLabelText('服务密码')).toHaveValue('');
  });

  it('主动暂停后，通过恢复同步重新验证服务凭据', async () => {
    current = { ...current, phase: 'disconnected' };
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /仅使用本地资料/ }));
    });
    expect(screen.queryByRole('button', { name: '立即同步' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('服务账号'), { target: { value: 'service-user' } });
    fireEvent.change(screen.getByLabelText('服务密码'), { target: { value: 'temporary-password' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '恢复同步' }));
    });
    const configure = fetcher.mock.calls.find(([url]) => url.endsWith('/configure'));
    expect(JSON.parse(String(configure?.[1]?.body))).toEqual({
      serverUrl: 'https://example.test',
      username: 'service-user',
      password: 'temporary-password'
    });
    expect(screen.getByLabelText('服务密码')).toHaveValue('');
  });

  it('隐藏时停止查询，重新可见/聚焦/联网使用 wake，不清除阻塞记录', async () => {
    await mount();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    await tick(60000);
    expect(polls()).toBe(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => {
      fireEvent(document, new Event('visibilitychange'));
      fireEvent(window, new Event('focus'));
      fireEvent(window, new Event('online'));
    });
    expect(polls()).toBeGreaterThan(1);
    const wakes = fetcher.mock.calls.filter(([url]) => url.endsWith('/wake'));
    expect(wakes.some(([, options]) => JSON.parse(String(options?.body)).reason === 'online')).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/retry'))).toBe(false);
  });

  it('慢查询不重叠，卸载后不再安排查询', async () => {
    let release: (response: Response) => void = () => {};
    fetcher.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve;
        })
    );
    await mount();
    await tick(60000);
    expect(polls()).toBe(1);
    cleanup();
    await act(async () => {
      release(new Response(JSON.stringify({ data: current })));
    });
    await tick(60000);
    expect(polls()).toBe(1);
  });
});
