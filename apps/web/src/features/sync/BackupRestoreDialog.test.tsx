import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackupRestoreDialog } from './BackupRestoreDialog';
import { callBackup, transferBackup } from './backupApi';

vi.mock('../../store/AppStoreProvider', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    editorHasLocalChanges: false, saveState: 'saved', editorSaveError: null
  })
}));
vi.mock('./backupApi', () => ({
  transferBackup: vi.fn(),
  callBackup: vi.fn(async () => ({ items: [
    { id: '1-aaaaaaaa', createdAt: '2026-09-24T00:00:00.000Z', purpose: 'manual', fileCount: 2, size: 1048576 },
    { id: '2-bbbbbbbb', createdAt: '2026-09-23T00:00:00.000Z', purpose: 'legacy-unspecified', fileCount: 2, size: 2097152 }
  ] }))
}));

afterEach(() => { delete window.knowraDesktop; vi.clearAllMocks(); });

it('备份列表显示合计占用与未自动清理状态，并识别历史备份', async () => {
  render(<BackupRestoreDialog isOpen onOpenChange={vi.fn()} />);
  expect(await screen.findByText(/本机列出 2 份备份，清单合计 3\.0 MB/)).toBeInTheDocument();
  expect(screen.getByText(/备份目前不会自动到期清理/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /选择备份/ }));
  expect(await screen.findByRole('option', { name: /历史备份.*2\.0 MB/ })).toBeInTheDocument();
});

it('明确说明默认备份位置和浏览器能力限制', async () => {
  render(<BackupRestoreDialog isOpen onOpenChange={vi.fn()} />);
  await screen.findByText(/默认本机备份保存在本机资料目录中/);
  expect(screen.getByText(/浏览器暂不支持/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '导入外部完整备份' })).toBeDisabled();
});

it('原生导入成功仅选中备份，仍需检查和明确确认恢复；取消导出给出提示', async () => {
  window.knowraDesktop = { onPrepareClose: vi.fn(), onCancelClose: vi.fn(), transferBackup: vi.fn() };
  vi.mocked(transferBackup).mockResolvedValueOnce({ id: '1-aaaaaaaa', directory: '合成导入目录', inspection: { valid: true, createdAt: '', fileCount: 2, size: 1, noteCount: 1, attachmentCount: 0, pendingOperations: 1, draftCount: 1 } }).mockResolvedValueOnce(null);
  render(<BackupRestoreDialog isOpen onOpenChange={vi.fn()} />);
  await screen.findByText(/本机列出 2 份备份/);
  await userEvent.click(screen.getByRole('button', { name: '导入外部完整备份' }));
  await screen.findByText(/外部完整备份已校验并导入本机列表/);
  expect(transferBackup).toHaveBeenCalledWith('import');
  expect(screen.queryByRole('heading', { name: '完整性检查通过' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '确认恢复所选备份' })).not.toBeInTheDocument();
  expect(vi.mocked(callBackup).mock.calls.every(([route]) => !route.endsWith('/restore'))).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: '导出所选完整备份' }));
  await screen.findByText(/已取消导出，当前资料和已有目标未改动/);
  expect(transferBackup).toHaveBeenCalledWith('export', '1-aaaaaaaa');
});
