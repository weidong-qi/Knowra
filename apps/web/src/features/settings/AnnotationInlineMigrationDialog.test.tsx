import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registerDesktopSave } from '../../app/desktopLifecycle';
import { callBackup } from '../sync/backupApi';
import { checkInlineMigration, executeInlineMigration } from '../editor/annotationInlineMigrationRunner';
import { AnnotationInlineMigrationDialog } from './AnnotationInlineMigrationDialog';

const fixtures = vi.hoisted(() => ({
  note: { id: 'synthetic-note', title: '合成笔记', spaceId: 'synthetic-space' },
  loadWorkspace: vi.fn(async () => {}),
  ready: true,
  writable: true,
  notesLoaded: true,
  codec: { parse: vi.fn(), serialize: vi.fn(), takeProblems: vi.fn(() => []), destroy: vi.fn(async () => {}) }
}));

vi.mock('../../store/AppStoreProvider', () => {
  const getState = () => ({
    serverData: { notes: fixtures.notesLoaded ? [fixtures.note] : [], currentSpaceId: fixtures.note.spaceId },
    editorHasLocalChanges: false,
    saveState: 'saved',
    workspaceLoadState: fixtures.ready ? 'ready' : 'loading',
    canWriteWorkspace: () => fixtures.writable,
    loadWorkspace: fixtures.loadWorkspace
  });
  const api = { getState };
  return { useAppStore: (selector: (state: unknown) => unknown) => selector(getState()), useAppStoreApi: () => api };
});
vi.mock('../editor/headlessNoteCodec', () => ({ createHeadlessNoteCodec: vi.fn(async () => fixtures.codec) }));
vi.mock('../editor/annotationInlineMigrationRunner', () => ({
  checkInlineMigration: vi.fn(async () => [{ note: fixtures.note }]),
  summarizeChecks: vi.fn(() => ({ notes: 1, migratable: 1, abandoned: 0, blockedNotes: 0, rewritesFormat: 0 })),
  executeInlineMigration: vi.fn(async () => [])
}));
vi.mock('../sync/backupApi', () => ({ callBackup: vi.fn() }));

let unregisterSave = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.ready = true;
  fixtures.writable = true;
  fixtures.notesLoaded = true;
  fixtures.loadWorkspace.mockResolvedValue(undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { serverUrl: null, error: null, conflicts: [] } }), { status: 200 })
    )
  );
  vi.mocked(callBackup).mockImplementation(async path =>
    path === 'backup'
      ? { id: 'synthetic-backup', directory: '/synthetic/backup' }
      : {
          valid: true,
          createdAt: '',
          fileCount: 1,
          size: 1,
          noteCount: 1,
          attachmentCount: 0,
          pendingOperations: 0,
          draftCount: 0
        }
  );
});
afterEach(() => {
  unregisterSave();
  unregisterSave = () => {};
  vi.unstubAllGlobals();
});

async function startMigration() {
  const user = userEvent.setup();
  render(<AnnotationInlineMigrationDialog isOpen onOpenChange={vi.fn()} />);
  await user.click(await screen.findByRole('checkbox', { name: '我已了解以上影响，开始迁移' }));
  await user.click(screen.getByRole('button', { name: '备份并迁移' }));
}

it('已离开编辑器但保存参与者仍有冲突时严格停止，不能用救援备份继续迁移', async () => {
  const save = vi.fn(async mode => {
    if (mode === 'save') throw new Error('正文存在未解决的保存冲突');
  });
  unregisterSave = registerDesktopSave(save);
  await startMigration();
  expect(await screen.findByRole('alert')).toHaveTextContent('正文存在未解决的保存冲突');
  expect(save).toHaveBeenCalledWith('save');
  expect(save).not.toHaveBeenCalledWith('recovery');
  expect(callBackup).not.toHaveBeenCalled();
  expect(executeInlineMigration).not.toHaveBeenCalled();
});

it('备份创建失败时不迁移', async () => {
  vi.mocked(callBackup).mockRejectedValueOnce(new Error('备份写入失败'));
  await startMigration();
  expect(await screen.findByRole('alert')).toHaveTextContent('备份写入失败');
  expect(executeInlineMigration).not.toHaveBeenCalled();
});

it('创建成功但完整备份检查拒绝 rescue-only 时不迁移', async () => {
  vi.mocked(callBackup).mockImplementation(async path => {
    if (path === 'backup') return { id: 'synthetic-backup', directory: '/synthetic/backup' };
    throw new Error('此备份仅供原始资料救援，不能直接恢复');
  });
  await startMigration();
  expect(await screen.findByRole('alert')).toHaveTextContent('此备份仅供原始资料救援');
  expect(callBackup).toHaveBeenLastCalledWith('backups/synthetic-backup/inspect', {});
  expect(executeInlineMigration).not.toHaveBeenCalled();
});

it.each([{ valid: false }, { valid: true, restoreReady: false }])('检查未确认可恢复时不迁移：%j', async inspection => {
  vi.mocked(callBackup).mockImplementation(async path =>
    path === 'backup' ? { id: 'synthetic-backup', directory: '/synthetic/backup' } : inspection
  );
  await startMigration();
  expect(await screen.findByRole('alert')).toHaveTextContent('迁移前备份未通过完整恢复检查');
  expect(executeInlineMigration).not.toHaveBeenCalled();
});

it('严格保存与完整恢复检查都完成后才执行迁移', async () => {
  const save = vi.fn(async () => {});
  unregisterSave = registerDesktopSave(save);
  await startMigration();
  await waitFor(() => expect(executeInlineMigration).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith('save');
  expect(callBackup).toHaveBeenNthCalledWith(
    1,
    'backup',
    expect.objectContaining({ recoveryDrafts: expect.any(Object) })
  );
  expect(callBackup).toHaveBeenNthCalledWith(2, 'backups/synthetic-backup/inspect', {});
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(callBackup).mock.invocationCallOrder[0]);
  expect(vi.mocked(callBackup).mock.invocationCallOrder[1]).toBeLessThan(
    vi.mocked(executeInlineMigration).mock.invocationCallOrder[0]
  );
  expect(fixtures.loadWorkspace).toHaveBeenCalledOnce();
});

it('直接打开设置时等待工作区加载完成，再使用刚加载的笔记检查', async () => {
  fixtures.ready = false;
  fixtures.notesLoaded = false;
  let finish!: () => void;
  fixtures.loadWorkspace.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = () => {
          fixtures.ready = true;
          fixtures.notesLoaded = true;
          resolve();
        };
      })
  );
  render(<AnnotationInlineMigrationDialog isOpen onOpenChange={vi.fn()} />);
  await waitFor(() => expect(fixtures.loadWorkspace).toHaveBeenCalledOnce());
  expect(checkInlineMigration).not.toHaveBeenCalled();
  expect(screen.queryByText(/没有需要迁移的旧重点/)).not.toBeInTheDocument();
  finish();
  await screen.findByRole('checkbox', { name: '我已了解以上影响，开始迁移' });
  expect(checkInlineMigration).toHaveBeenCalledWith(
    [expect.objectContaining({ id: 'synthetic-note' })],
    expect.anything(),
    fixtures.codec,
    expect.any(Function)
  );
});

it('工作区加载后仍处于缓存或恢复模式时不检查、不迁移', async () => {
  fixtures.ready = false;
  fixtures.writable = false;
  fixtures.loadWorkspace.mockImplementationOnce(async () => {
    fixtures.ready = true;
  });
  render(<AnnotationInlineMigrationDialog isOpen onOpenChange={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('资料尚未成功加载或处于只读恢复模式');
  expect(checkInlineMigration).not.toHaveBeenCalled();
  expect(callBackup).not.toHaveBeenCalled();
  expect(executeInlineMigration).not.toHaveBeenCalled();
});

it('检查之后或备份期间切入只读状态时不会绕过工作区写入保护', async () => {
  vi.mocked(callBackup).mockImplementation(async path => {
    if (path === 'backup') return { id: 'synthetic-backup', directory: '/synthetic/backup' };
    fixtures.writable = false;
    return { valid: true };
  });
  await startMigration();
  expect(await screen.findByRole('alert')).toHaveTextContent('资料已进入只读或加载状态');
  expect(executeInlineMigration).not.toHaveBeenCalled();
});

it('逐篇迁移期间切入只读模式后，每个实际写方法都拒绝继续', async () => {
  vi.mocked(executeInlineMigration).mockImplementationOnce(async (_checks, api) => {
    fixtures.writable = false;
    expect(() => api.updateNote('note', { rawMarkdown: 'new' })).toThrow('资料已进入只读或加载状态');
    expect(() => api.updateAnnotation!('annotation', { comment: 'new', expectedRevision: 1 })).toThrow(
      '资料已进入只读或加载状态'
    );
    expect(() => api.deleteAnnotation('annotation', 1)).toThrow('资料已进入只读或加载状态');
    return [];
  });
  await startMigration();
  await waitFor(() => expect(executeInlineMigration).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledTimes(1);
});
