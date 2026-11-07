import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSyncControl } from './LocalSyncControl';
import type { RecoveryPreview, RecoverySession, SyncStatus } from './localSyncApi';

const local = vi.hoisted(() => ({ refresh: vi.fn(), draft: false, saveState: 'saved' }));
vi.mock('../../store/AppStoreProvider', () => {
  const store = { getState: () => ({ refreshLocalWorkspace: local.refresh }) };
  return {
    useAppStoreApi: () => store,
    useAppStore: (selector: (state: { editorHasLocalChanges: boolean; saveState: string }) => unknown) =>
      selector({ editorHasLocalChanges: local.draft, saveState: local.saveState })
  };
});
vi.mock('./BackupRestoreDialog', () => ({ BackupRestoreDialog: () => null }));

const session = (stage: RecoverySession['stage'] = 'preview'): RecoverySession => ({
  id: 'recovery-one',
  stage,
  oldDeviceId: 'old-sender',
  newDeviceId: 'new-sender',
  backupId: 'backup-one',
  localRevision: 'revision-one',
  totalItems: 21,
  epochChanged: false
});
const paused = (): SyncStatus => ({
  deviceId: 'global-device',
  serverUrl: 'https://example.test',
  generation: 1,
  phase: 'paused',
  pendingNotes: 0,
  lastSyncedAt: null,
  conflicts: [],
  blockedNotes: [],
  safetyPaused: true,
  recoverySession: null,
  error: { code: 'SYNC_RESULT_UNCERTAIN', message: '旧提交结果尚未确认。' }
});
const preview = (offset = 0, revision = 'revision-one'): RecoveryPreview => ({
  recoveryId: 'recovery-one',
  revision,
  total: 21,
  offset,
  nextOffset: offset === 0 ? 20 : null,
  items: [
    {
      collection: 'notes',
      id: `note-${offset}`,
      local: { title: '本机标题', rawMarkdown: '<script>unsafe()</script>' },
      remote: { title: '云端标题' }
    }
  ],
  oldDeviceId: 'old-sender',
  newDeviceId: 'new-sender',
  backupId: 'backup-one',
  epochChanged: false
});
const response = (data: unknown) => new Response(JSON.stringify({ data }));
const failure = (code = 'SYNC_DEVICE_NOT_ALLOWED') =>
  new Response(JSON.stringify({ error: { code, message: '新同步编号尚未获准，既有恢复会话会保留。' } }), {
    status: 409
  });
let current: SyncStatus;
let onRequest: (url: string, options?: RequestInit) => Response | Promise<Response>;
const fetcher = vi.fn((url: string, options?: RequestInit) => onRequest(url, options));
const calls = (suffix: string) => fetcher.mock.calls.filter(([url]) => url === `/api/local-runtime/sync${suffix}`);
async function click(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}
async function tick(ms = 2000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function mount() {
  await act(async () => {
    render(<LocalSyncControl />);
  });
  await click(/云端同步已暂停/);
}
function credentials() {
  fireEvent.change(screen.getByLabelText('登录账号'), { target: { value: 'demo-user' } });
  fireEvent.change(screen.getByLabelText('登录密码'), { target: { value: 'temporary-secret' } });
}
function confirmations() {
  fireEvent.click(screen.getByRole('checkbox', { name: /我确认永久作废旧同步编号/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /我接受服务端 journal 格式升级/ }));
}

beforeEach(() => {
  vi.useFakeTimers();
  current = paused();
  local.draft = false;
  local.saveState = 'saved';
  local.refresh.mockReset().mockResolvedValue(true);
  fetcher.mockClear();
  onRequest = url =>
    response(
      url.includes('/recovery-preview')
        ? preview(Number(new URL(url, 'http://localhost').searchParams.get('offset')))
        : current
    );
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('桌面安全恢复入口', () => {
  it('两个明确确认缺一不可，暂停时普通登录和同步不能提交', async () => {
    await mount();
    credentials();
    const start = screen.getByRole('button', { name: '先备份并核对恢复' });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /我确认永久作废旧同步编号/ }));
    expect(start).toBeDisabled();
    expect(screen.getByRole('button', { name: '更新登录并同步' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '立即同步' })).toBeDisabled();
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('登录账号').closest('form')!);
    });
    await click('立即同步');
    await click('先备份并核对恢复');
    expect(calls('/configure')).toHaveLength(0);
    expect(calls('/retry')).toHaveLength(0);
    expect(calls('/recover')).toHaveLength(0);
  });

  it('开始时提交确认与临时凭据，不走 configure/retry，完成动作清空密码并取得只读预览', async () => {
    onRequest = url => {
      if (url.endsWith('/recover')) current = { ...current, recoverySession: session() };
      return response(url.includes('/recovery-preview') ? preview() : current);
    };
    await mount();
    credentials();
    confirmations();
    await click('先备份并核对恢复');
    expect(JSON.parse(String(calls('/recover')[0][1]?.body))).toEqual({
      username: 'demo-user',
      password: 'temporary-secret',
      confirmRetire: true,
      acceptJournalUpgrade: true
    });
    expect(screen.getByLabelText('登录密码')).toHaveValue('');
    expect(calls('/configure')).toHaveLength(0);
    expect(calls('/retry')).toHaveLength(0);
    expect(calls('/recovery-preview?offset=0&limit=20')).toHaveLength(1);
    expect(screen.getByText(/待恢复关联组共 21 项/)).toHaveTextContent('包括其他分页和未展开的项目');
    expect(screen.getByText(/旧同步编号：/)).toHaveTextContent('old-sender');
    expect(screen.getByText(/新同步编号：/)).toHaveTextContent('new-sender');
    expect(screen.getByText(/设备编号：global-device/)).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText(/<script>unsafe\(\)<\/script>/)).toBeInTheDocument();
    expect(local.refresh).not.toHaveBeenCalled();
  });

  it.each(['draft', 'saving'])('当前 %s 必须先保存，不能开始恢复', async mode => {
    local.draft = mode === 'draft';
    local.saveState = mode === 'saving' ? 'saving' : 'saved';
    await mount();
    credentials();
    expect(screen.getByText(/请先将当前编辑保存到本机/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '先备份并核对恢复' })).toBeDisabled();
    expect(screen.getAllByRole('checkbox').every(input => input.hasAttribute('disabled'))).toBe(true);
    await click('先备份并核对恢复');
    expect(calls('/recover')).toHaveLength(0);
  });

  it('处理期间阻止重复开始和普通操作，失败后仍清空密码', async () => {
    let release: (value: Response) => void = () => {};
    onRequest = url =>
      url.endsWith('/recover')
        ? new Promise(resolve => {
            release = resolve;
          })
        : response(current);
    await mount();
    credentials();
    confirmations();
    await click('先备份并核对恢复');
    expect(screen.getByRole('button', { name: '先备份并核对恢复' })).toBeDisabled();
    await click('先备份并核对恢复');
    await click('立即同步');
    expect(calls('/recover')).toHaveLength(1);
    expect(calls('/retry')).toHaveLength(0);
    await act(async () => {
      release(failure());
    });
    expect(screen.getByLabelText('登录密码')).toHaveValue('');
  });

  it.each(['prepared', 'retiring', 'downloading'] as const)(
    '%s 失败保留会话与编号，再次继续复用已有确认',
    async stage => {
      let attempts = 0;
      onRequest = url => {
        if (url.endsWith('/recover')) {
          attempts += 1;
          current = { ...current, recoverySession: session(attempts === 1 ? stage : 'preview') };
          if (attempts === 1) return failure();
        }
        return response(url.includes('/recovery-preview') ? preview() : current);
      };
      await mount();
      credentials();
      confirmations();
      await click('先备份并核对恢复');
      expect(screen.getByText(/新同步编号尚未获准/)).toBeInTheDocument();
      expect(screen.getByText(/新同步编号：/)).toHaveTextContent('new-sender');
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
      credentials();
      await click('继续核对既有恢复');
      expect(calls('/recover')).toHaveLength(2);
      expect(JSON.parse(String(calls('/recover')[1][1]?.body))).toEqual({
        username: 'demo-user',
        password: 'temporary-secret',
        confirmRetire: true,
        acceptJournalUpgrade: true
      });
      expect(screen.getByText(/新同步编号：/)).toHaveTextContent('new-sender');
      expect(screen.getByRole('button', { name: '保留本机这一组并继续同步' })).toBeEnabled();
    }
  );

  it.each([
    ['本机', 'local'],
    ['云端', 'remote']
  ] as const)('分页核对后明确采用%s整组，只提交预览 revision，成功按 generation 刷新工作区', async (label, choice) => {
    current = { ...current, recoverySession: session() };
    onRequest = url => {
      if (url.endsWith('/recover-resolve'))
        current = {
          ...current,
          safetyPaused: false,
          phase: 'synced',
          error: null,
          generation: 2,
          recoverySession: { ...session(), stage: 'completed' }
        };
      return response(
        url.includes('/recovery-preview')
          ? preview(Number(new URL(url, 'http://localhost').searchParams.get('offset')))
          : current
      );
    };
    await mount();
    await click('下一页');
    expect(calls('/recovery-preview?offset=20&limit=20')).toHaveLength(1);
    expect(screen.getByText('notes · note-20')).toBeInTheDocument();
    await click('上一页');
    expect(screen.getByText('notes · note-0')).toBeInTheDocument();
    await click(label === '本机' ? '保留本机这一组并继续同步' : '采用云端这一组并继续同步');
    expect(JSON.parse(String(calls('/recover-resolve')[0][1]?.body))).toEqual({
      recoveryId: 'recovery-one',
      revision: 'revision-one',
      choice
    });
    expect(local.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('安全恢复云端同步')).toBeNull();
    expect(screen.getByRole('button', { name: '立即同步' })).toBeEnabled();
  });

  it('状态提示本机 revision 改变后禁用旧预览，显式刷新后才能选择', async () => {
    current = { ...current, recoverySession: session() };
    await mount();
    current = { ...current, recoverySession: { ...session(), localRevision: 'revision-two' } };
    await tick();
    expect(screen.getByRole('button', { name: '采用云端这一组并继续同步' })).toBeDisabled();
    expect(screen.getByText(/本机资料已改变/)).toBeInTheDocument();
    await click('采用云端这一组并继续同步');
    expect(calls('/recover-resolve')).toHaveLength(0);
    onRequest = url => response(url.includes('/recovery-preview') ? preview(0, 'revision-two') : current);
    await click('刷新整组预览');
    expect(screen.getByRole('button', { name: '采用云端这一组并继续同步' })).toBeEnabled();
  });

  it('翻页遇到新 revision 丢弃旧页面，不能混合确认', async () => {
    current = { ...current, recoverySession: session() };
    await mount();
    onRequest = url => response(url.includes('/recovery-preview') ? preview(20, 'revision-two') : current);
    await click('下一页');
    expect(screen.getByText(/本机资料已改变/)).toBeInTheDocument();
    expect(screen.queryByText('notes · note-0')).toBeNull();
    expect(screen.queryByText('notes · note-20')).toBeNull();
    expect(screen.getByRole('button', { name: '保留本机这一组并继续同步' })).toBeDisabled();
    await click('保留本机这一组并继续同步');
    expect(calls('/recover-resolve')).toHaveLength(0);
  });

  it('服务端拒绝 stale revision 或不安全整组时继续暂停，必须重新核对', async () => {
    current = { ...current, recoverySession: session() };
    onRequest = url =>
      url.endsWith('/recover-resolve')
        ? failure('SYNC_RECOVERY_STALE')
        : response(url.includes('/recovery-preview') ? preview() : current);
    await mount();
    await click('采用云端这一组并继续同步');
    expect(screen.getByRole('button', { name: '采用云端这一组并继续同步' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '立即同步' })).toBeDisabled();
    expect(local.refresh).not.toHaveBeenCalled();
  });

  it('预览后出现未保存编辑时禁止两种最终选择及刷新', async () => {
    current = { ...current, recoverySession: session() };
    await mount();
    local.draft = true;
    current = { ...current, pendingNotes: 1 };
    await tick();
    expect(screen.getByRole('button', { name: '保留本机这一组并继续同步' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '采用云端这一组并继续同步' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '刷新整组预览' })).toBeDisabled();
    await click('采用云端这一组并继续同步');
    expect(calls('/recover-resolve')).toHaveLength(0);
  });

  it('暂停时普通冲突卡不能解除保护，旧版本 uncertainty 标志也保持锁定', async () => {
    current = {
      ...current,
      safetyPaused: false,
      conflicts: [
        {
          noteId: 'note-1',
          kind: 'edit',
          base: null,
          remoteRevision: 2,
          datasetEpoch: 'epoch',
          local: { title: '冲突笔记', rawMarkdown: '本机', deleted: false },
          remote: { title: '冲突笔记', rawMarkdown: '云端', deleted: false }
        }
      ]
    };
    await mount();
    expect(screen.getByRole('button', { name: '采用云端' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '采用本地' })).toBeDisabled();
    await click('采用云端');
    expect(calls('/resolve')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '立即同步' })).toBeDisabled();
  });
  it('安全暂停标志独立于 error，普通操作仍保持锁定', async () => {
    current = { ...current, error: null };
    await mount();
    expect(screen.getByRole('button', { name: '立即同步' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '更新登录并同步' })).toBeDisabled();
    expect(screen.getByLabelText('安全恢复云端同步')).toBeInTheDocument();
  });

  it('已有预览会话可重新提供临时凭据继续，同一组确认不会重选', async () => {
    current = { ...current, recoverySession: session() };
    await mount();
    credentials();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    await click('继续核对既有恢复');
    expect(calls('/recover')).toHaveLength(1);
    expect(screen.getByLabelText('登录密码')).toHaveValue('');
    expect(calls('/recovery-preview?offset=0&limit=20')).toHaveLength(2);
  });

  it('最终选择处理中禁用另一种选择，重复点击不会提交两次', async () => {
    current = { ...current, recoverySession: session() };
    let release: (value: Response) => void = () => {};
    onRequest = url =>
      url.endsWith('/recover-resolve')
        ? new Promise(resolve => {
            release = resolve;
          })
        : response(url.includes('/recovery-preview') ? preview() : current);
    await mount();
    await click('保留本机这一组并继续同步');
    expect(screen.getByRole('button', { name: '采用云端这一组并继续同步' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '继续核对既有恢复' })).toBeDisabled();
    await click('采用云端这一组并继续同步');
    expect(calls('/recover-resolve')).toHaveLength(1);
    await act(async () => {
      release(failure('SYNC_RECOVERY_STALE'));
    });
  });

  it('读预览失败继续锁定最终选择，可以安全刷新重试', async () => {
    current = { ...current, recoverySession: session() };
    onRequest = url =>
      url.includes('/recovery-preview') ? failure('SYNC_RECOVERY_PREVIEW_FAILED') : response(current);
    await mount();
    expect(screen.getByRole('button', { name: '保留本机这一组并继续同步' })).toBeDisabled();
    onRequest = url => response(url.includes('/recovery-preview') ? preview() : current);
    await click('刷新整组预览');
    expect(screen.getByRole('button', { name: '保留本机这一组并继续同步' })).toBeEnabled();
  });

  it('离开面板清除未使用的密码，重新打开会话身份仍相同', async () => {
    current = { ...current, recoverySession: session('prepared') };
    await mount();
    credentials();
    await click('关闭对话框');
    await click(/云端同步已暂停/);
    expect(screen.getByLabelText('登录密码')).toHaveValue('');
    expect(screen.getByText(/新同步编号：/)).toHaveTextContent('new-sender');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
  it('以前已完成的会话不能替下一次恢复授权，必须重新勾选两个确认', async () => {
    current = { ...current, recoverySession: session('completed') };
    await mount();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '先备份并核对恢复' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '继续核对既有恢复' })).toBeNull();
    await click('先备份并核对恢复');
    expect(calls('/recover')).toHaveLength(0);
  });

  it('恢复前发出的慢状态查询不能抹掉失败后已保存的会话和新编号', async () => {
    await mount();
    credentials();
    confirmations();
    const oldStatus = current;
    let release: (value: Response) => void = () => {};
    let holdNextStatus = true;
    onRequest = url => {
      if (url === '/api/local-runtime/sync' && holdNextStatus) {
        holdNextStatus = false;
        return new Promise(resolve => {
          release = resolve;
        });
      }
      if (url.endsWith('/recover')) {
        current = { ...current, recoverySession: session('prepared') };
        return failure();
      }
      return response(current);
    };
    await tick();
    await click('先备份并核对恢复');
    expect(screen.getByText(/新同步编号：/)).toHaveTextContent('new-sender');
    await act(async () => {
      release(response(oldStatus));
    });
    expect(screen.getByRole('button', { name: '继续核对既有恢复' })).toBeEnabled();
    expect(screen.getByText(/新同步编号：/)).toHaveTextContent('new-sender');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
