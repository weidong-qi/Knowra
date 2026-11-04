import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { flushBeforeWorkspaceRestore } from '../../app/desktopLifecycle';
import { ArchiveSettings } from './ArchiveSettings';
import { pdfRequest } from './pdfApi';

vi.mock('../../store/AppStoreProvider', () => ({
  useAppStore: (selector: (state: { canWriteWorkspace(): boolean }) => unknown) =>
    selector({ canWriteWorkspace: () => true })
}));
vi.mock('../../app/desktopLifecycle', () => ({ flushBeforeWorkspaceRestore: vi.fn() }));
vi.mock('./pdfApi', () => ({ pdfRequest: vi.fn(), randomId: () => 'operation-id-0001' }));

const request = vi.mocked(pdfRequest);
const flush = vi.mocked(flushBeforeWorkspaceRestore);
const preview = (token: string, notes = 1) => ({ token, notes, pdfs: 0, annotations: 0, attachments: 0 });
const file = (name = 'backup.zip') => new File(['backup'], name, { type: 'application/zip' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function open() {
  const view = render(<ArchiveSettings />);
  await userEvent.click(screen.getByRole('button', { name: '导入资料库…' }));
  return { ...view, input: screen.getByLabelText('选择备份包') };
}
beforeEach(() => {
  request.mockReset();
  flush.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

it('连续更换四份备份时先释放旧预检，关闭时释放最后一个 token', async () => {
  const pending = new Set<string>();
  let number = 0;
  request.mockImplementation(async (url, options) => {
    if (options?.method === 'DELETE') {
      pending.delete(url.split('/').pop()!);
      return { discarded: true };
    }
    if (pending.size >= 3) throw new Error('已有三个待确认的导入');
    const token = `token-${++number}`;
    pending.add(token);
    return preview(token, number);
  });
  const { input } = await open();
  for (let index = 1; index <= 4; index++) {
    await userEvent.upload(input, file(`${index}.zip`));
    await screen.findByText(new RegExp(`检查通过：${index} 份资料`));
    expect([...pending]).toEqual([`token-${index}`]);
  }
  expect(request.mock.calls.map(([url, options]) => [options?.method, url])).toEqual([
    ['POST', '/api/storage/archive/inspect'],
    ['DELETE', '/api/storage/archive/token-1'],
    ['POST', '/api/storage/archive/inspect'],
    ['DELETE', '/api/storage/archive/token-2'],
    ['POST', '/api/storage/archive/inspect'],
    ['DELETE', '/api/storage/archive/token-3'],
    ['POST', '/api/storage/archive/inspect']
  ]);
  await userEvent.click(screen.getByRole('button', { name: '取消' }));
  await waitFor(() => expect(pending.size).toBe(0));
});

it('更换为无效备份时也释放旧预检，错误后仍可重新选择', async () => {
  request
    .mockResolvedValueOnce(preview('first'))
    .mockResolvedValueOnce({ discarded: true })
    .mockRejectedValueOnce(new Error('备份包不完整'))
    .mockResolvedValueOnce(preview('next', 2));
  const { input } = await open();
  await userEvent.upload(input, file());
  await screen.findByText(/检查通过：1 份资料/);
  await userEvent.upload(input, file('invalid.zip'));
  await expect(screen.findByRole('alert')).resolves.toHaveTextContent('备份包不完整');
  expect(request.mock.calls[1]).toEqual(['/api/storage/archive/first', { method: 'DELETE' }]);
  await userEvent.upload(input, file('next.zip'));
  await screen.findByText(/检查通过：2 份资料/);
});

it('旧预检释放失败时保留 token 以便关闭重试，不继续占用新名额', async () => {
  request
    .mockResolvedValueOnce(preview('first'))
    .mockRejectedValueOnce(new Error('预检清理失败'))
    .mockResolvedValueOnce({ discarded: true });
  const { input } = await open();
  await userEvent.upload(input, file());
  await screen.findByText(/检查通过：1 份资料/);
  await userEvent.upload(input, file('next.zip'));
  await expect(screen.findByRole('alert')).resolves.toHaveTextContent('预检清理失败');
  expect(request).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(request).toHaveBeenLastCalledWith('/api/storage/archive/first', { method: 'DELETE' });
});

it('组件卸载时释放已有预检', async () => {
  request.mockResolvedValueOnce(preview('unmount')).mockResolvedValue({ discarded: true });
  const { input, unmount } = await open();
  await userEvent.upload(input, file());
  await screen.findByText(/检查通过：1 份资料/);
  unmount();
  await waitFor(() => expect(request).toHaveBeenLastCalledWith('/api/storage/archive/unmount', { method: 'DELETE' }));
});

it('检查在卸载后才返回时取消请求并释放迟到的 token', async () => {
  const pending = deferred<ReturnType<typeof preview>>();
  request.mockReturnValueOnce(pending.promise).mockResolvedValue({ discarded: true });
  const { input, unmount } = await open();
  await userEvent.upload(input, file());
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  const signal = request.mock.calls[0][1]!.signal!;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(preview('late')));
  await waitFor(() => expect(request).toHaveBeenLastCalledWith('/api/storage/archive/late', { method: 'DELETE' }));
});

it('卸载发生在保存等待期间时，不再发起新的预检', async () => {
  const pending = deferred<void>();
  flush.mockReturnValueOnce(pending.promise);
  const { input, unmount } = await open();
  await userEvent.upload(input, file());
  await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
  unmount();
  await act(async () => pending.resolve());
  expect(request).not.toHaveBeenCalled();
});

it('恢复进行中卸载不能提前释放原文件，恢复失败后再清理预检', async () => {
  const pending = deferred<unknown>();
  request
    .mockResolvedValueOnce(preview('restore-token'))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ discarded: true });
  const { input, unmount } = await open();
  await userEvent.upload(input, file());
  await screen.findByText(/检查通过：1 份资料/);
  await userEvent.click(screen.getByText('我确认使用这份备份替换当前资料库'));
  await userEvent.click(screen.getByRole('button', { name: '确认恢复资料库' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith('/api/storage/archive/restore', expect.anything()));
  unmount();
  expect(request).toHaveBeenCalledTimes(2);
  await act(async () => pending.reject(new Error('恢复失败')));
  await waitFor(() =>
    expect(request).toHaveBeenLastCalledWith('/api/storage/archive/restore-token', { method: 'DELETE' })
  );
});

it('响应返回前取消检查时按操作 ID 释放服务端预检', async () => {
  const pending = deferred<unknown>();
  request.mockReturnValueOnce(pending.promise).mockResolvedValue({ discarded: true });
  const { input, unmount } = await open();
  await userEvent.upload(input, file());
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(request.mock.calls[0][1]!.headers).toMatchObject({ 'X-Knowra-Operation-Id': 'operation-id-0001' });
  unmount();
  await act(async () => pending.reject(new DOMException('aborted', 'AbortError')));
  await waitFor(() =>
    expect(request).toHaveBeenLastCalledWith('/api/storage/archive/operations/operation-id-0001', { method: 'DELETE' })
  );
});
