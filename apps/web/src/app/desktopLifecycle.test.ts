import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let prepare: () => Promise<void>;
let cancel: () => void;
const originalFetch = window.fetch;
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"><input /></div>';
  window.fetch = vi.fn(async () => new Response('{}'));
  window.knowraDesktop = {
    onPrepareClose: callback => { prepare = callback; },
    onCancelClose: callback => { cancel = callback; }
  };
});
afterEach(() => { delete window.knowraDesktop; window.fetch = originalFetch; document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('桌面退出保存', () => {
  it('先等待附件操作，再提取编辑器正文和清空保存队列；等待期间禁止继续编辑', async () => {
    const { installDesktopLifecycle, registerDesktopSave, trackDesktopTask } = await import('./desktopLifecycle');
    installDesktopLifecycle();
    const order: string[] = [];
    let uploaded!: () => void;
    const pending = trackDesktopTask(() => new Promise<void>(resolve => { uploaded = () => { order.push('attachment'); resolve(); }; }));
    registerDesktopSave(async () => { order.push('flush'); });
    registerDesktopSave(async () => { order.push('editor'); }, 0);
    const closing = prepare();
    expect(document.getElementById('root')?.inert).toBe(true);
    uploaded(); await pending; await closing;
    expect(order).toEqual(['attachment', 'editor', 'flush']);
    expect(document.getElementById('root')?.inert).toBe(true);
    cancel();
    expect(document.getElementById('root')?.inert).toBe(false);
  });
  it('保存失败拒绝退出，并恢复页面编辑', async () => {
    const { installDesktopLifecycle, registerDesktopSave } = await import('./desktopLifecycle');
    installDesktopLifecycle();
    registerDesktopSave(async () => { throw new Error('磁盘写入失败'); });
    await expect(prepare()).rejects.toThrow('磁盘写入失败');
    expect(document.querySelector('[role=status]')).toBeNull();
    expect(document.getElementById('root')?.inert).toBe(false);
  });
  it('输入法候选未结束时不确认退出', async () => {
    const { installDesktopLifecycle } = await import('./desktopLifecycle');
    installDesktopLifecycle();
    document.dispatchEvent(new CompositionEvent('compositionstart'));
    await expect(prepare()).rejects.toThrow('输入法');
    document.dispatchEvent(new CompositionEvent('compositionend'));
    await prepare(); cancel();
  });
});

describe('本机备份与恢复前保存', () => {
  it.each(['close', 'restore'] as const)('完整目录 IPC 未完成时 %s 保存屏障必须等待', async mode => {
    const { installDesktopLifecycle, registerDesktopSave, flushBeforeWorkspaceRestore } = await import('./desktopLifecycle');
    const { transferBackup } = await import('../features/sync/backupApi');
    vi.stubGlobal('knowraRuntime', { persistenceMode: 'desktop-local', datasetId: 'dataset-test' });
    let finish!: (value: null) => void;
    window.knowraDesktop!.transferBackup = vi.fn(() => new Promise<null>(resolve => { finish = resolve; }));
    const save = vi.fn(async () => {});
    registerDesktopSave(save);
    installDesktopLifecycle();
    const transfer = transferBackup('export', '123-aaaaaaaa');
    const barrier = mode === 'close' ? prepare() : flushBeforeWorkspaceRestore();
    try {
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(save).not.toHaveBeenCalled();
      finish(null); await transfer; await barrier;
      expect(save).toHaveBeenCalledOnce();
      expect(window.knowraDesktop!.transferBackup).toHaveBeenCalledWith({ action: 'export', datasetId: 'dataset-test', backupId: '123-aaaaaaaa' });
    } finally { finish(null); await Promise.allSettled([transfer, barrier]); if (mode === 'close') cancel(); }
  });
  it('正文保存失败时可备份恢复草稿，但严格恢复仍拒绝', async () => {
    const { flushBeforeWorkspaceBackup, flushBeforeWorkspaceRestore, registerDesktopSave } = await import('./desktopLifecycle');
    const calls: string[] = [];
    registerDesktopSave(async mode => { calls.push(mode ?? 'save'); if (mode !== 'recovery') throw new Error('保存冲突'); });
    await expect(flushBeforeWorkspaceBackup()).resolves.toEqual({ hasUnsavedDrafts: true });
    expect(calls).toEqual(['save', 'recovery']);
    await expect(flushBeforeWorkspaceRestore()).rejects.toThrow('保存冲突');
  });
  it('恢复草稿落盘也失败时不能宣称备份已包含未保存正文', async () => {
    const { flushBeforeWorkspaceBackup, registerDesktopSave } = await import('./desktopLifecycle');
    registerDesktopSave(async mode => { throw new Error(mode === 'recovery' ? '草稿写入失败' : '保存失败'); });
    await expect(flushBeforeWorkspaceBackup()).rejects.toThrow('草稿写入失败');
  });
});
