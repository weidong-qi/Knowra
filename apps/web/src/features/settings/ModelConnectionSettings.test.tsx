import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiRequestError } from '@study-accelerator/web-core';
import { ModelConnectionSettings } from './ModelConnectionSettings';
import { modelSettings } from './modelSettings';
import { assistantApi } from '../assistant/assistantApi';
import { ASSISTANT_STATUS_CHANGED_EVENT } from '../assistant/assistantEvents';
import { CREDENTIAL_CHANGED_EVENT, notifyCredentialChanged } from './credentialEvents';

vi.mock('./modelSettings', async importOriginal => ({ ...await importOriginal<typeof import('./modelSettings')>(), modelSettings: {
  status: vi.fn(), save: vi.fn(), check: vi.fn(), remove: vi.fn()
} }));
vi.mock('../assistant/assistantApi', () => ({ assistantApi: { status: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(assistantApi.status).mockResolvedValue({ provider: 'deepseek', modelId: 'deepseek-flash', configured: true, executionLocation: 'local', generationAvailable: true, unavailableReason: null, budget: null, capabilities: { readScopes: ['note'], actions: ['answer'], responseMode: 'polling', writeTools: false, providerAdvertised: null, providerVerified: false } });
});

it('在设置页保存、检查及移除 DeepSeek 配置，密钥不回显', async () => {
  vi.mocked(modelSettings.status).mockResolvedValue({ provider: 'deepseek', modelId: 'deepseek-flash', configured: false });
  vi.mocked(modelSettings.save).mockResolvedValue({ provider: 'deepseek', modelId: 'deepseek-flash', configured: true });
  vi.mocked(modelSettings.check).mockResolvedValue({ provider: 'deepseek', modelId: 'deepseek-flash', configured: true, connected: true, modelAvailable: true });
  vi.mocked(modelSettings.remove).mockResolvedValue({ provider: 'deepseek', modelId: 'deepseek-flash', configured: false });
  render(<ModelConnectionSettings />);
  expect(await screen.findByText('尚未配置')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'test-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(modelSettings.save).toHaveBeenCalledWith({ modelId: 'deepseek-flash', apiKey: 'test-secret' }));
  await waitFor(() => expect(screen.getByLabelText('API Key')).toHaveValue(''));
  fireEvent.click(screen.getByRole('button', { name: '检查连接' }));
  expect(await screen.findByText(/连接检查通过/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '移除配置' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认移除' }));
  await waitFor(() => expect(screen.getByText('尚未配置')).toBeInTheDocument());
});

it('状态接口 404 时结束加载并允许保留已输入的密钥重试', async () => {
  vi.mocked(modelSettings.status)
    .mockRejectedValueOnce(new ApiRequestError('Route not found', { status: 404, code: 'ROUTE_NOT_FOUND' }))
    .mockResolvedValueOnce({ provider: 'deepseek', modelId: 'deepseek-flash', configured: false });
  render(<ModelConnectionSettings />);
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'test-secret' } });
  expect(await screen.findByText('配置状态读取失败')).toBeInTheDocument();
  expect(screen.getByText(/当前 API 服务未提供模型配置接口/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
  expect(await screen.findByText('尚未配置')).toBeInTheDocument();
  expect(screen.getByLabelText('API Key')).toHaveValue('test-secret');
  expect(screen.getByRole('button', { name: '保存配置' })).toBeEnabled();
});

it('保存或移除配置后通知依赖账户的展示，检查连接不触发', async () => {
  vi.mocked(modelSettings.status).mockResolvedValue({ provider: 'deepseek', modelId: 'deepseek-flash', configured: true });
  vi.mocked(modelSettings.save).mockResolvedValue({ provider: 'deepseek', modelId: 'deepseek-flash', configured: true });
  vi.mocked(modelSettings.check).mockResolvedValue({ provider: 'deepseek', modelId: 'deepseek-flash', configured: true, connected: true, modelAvailable: true });
  vi.mocked(modelSettings.remove).mockResolvedValue({ provider: 'deepseek', modelId: 'deepseek-flash', configured: false });
  const changed = vi.fn();
  window.addEventListener(CREDENTIAL_CHANGED_EVENT, changed);
  try {
    render(<ModelConnectionSettings />);
    await screen.findByText(/已配置/);
    fireEvent.click(screen.getByRole('button', { name: '检查连接' }));
    await screen.findByText(/连接检查通过/);
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'test-secret-b' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认替换' }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '移除配置' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认移除' }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
  } finally { window.removeEventListener(CREDENTIAL_CHANGED_EVENT, changed); }
});


const saved = { provider: 'deepseek' as const, modelId: 'deepseek-flash', configured: true };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

it('替换/移除必须确认；取消不会提交或清空输入，留空直接保留原密钥', async () => {
  vi.mocked(modelSettings.status).mockResolvedValue(saved);
  vi.mocked(modelSettings.save).mockResolvedValue(saved);
  render(<ModelConnectionSettings />);
  await screen.findByText(/已配置/);
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'synthetic-replacement' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('后续 AI 调用使用新密钥所属');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(modelSettings.save).not.toHaveBeenCalled();
  expect(screen.getByLabelText('API Key')).toHaveValue('synthetic-replacement');
  fireEvent.click(screen.getByRole('button', { name: '移除配置' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('不会撤销 DeepSeek 平台上的密钥，也不会删除笔记');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(modelSettings.remove).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(modelSettings.save).toHaveBeenCalledExactlyOnceWith({ modelId: 'deepseek-flash', apiKey: '' }));
});

it('检查成功后编辑密钥立即使检查失效，恢复原输入也不恢复旧结果', async () => {
  vi.mocked(modelSettings.status).mockResolvedValue(saved);
  vi.mocked(modelSettings.check).mockResolvedValue({ ...saved, connected: true, checkedAt: '2026-10-09T10:00:00Z' });
  render(<ModelConnectionSettings />);
  await screen.findByText(/已配置/);
  fireEvent.click(screen.getByRole('button', { name: '检查连接' }));
  await screen.findByText(/最近一次连接检查/);
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'synthetic-edit' } });
  expect(screen.queryByText(/最近一次连接检查/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '检查连接' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: '' } });
  expect(screen.queryByText(/最近一次连接检查/)).not.toBeInTheDocument();
});

it('保存失败保留输入且不泄漏错误中的密钥，确认双击只提交一次', async () => {
  const pending = deferred<typeof saved>();
  vi.mocked(modelSettings.status).mockResolvedValue(saved);
  vi.mocked(modelSettings.save).mockRejectedValueOnce(new Error('DeepSeek rejected synthetic-secret')).mockReturnValueOnce(pending.promise);
  render(<ModelConnectionSettings />);
  await screen.findByText(/已配置/);
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'synthetic-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认替换' }));
  expect(await screen.findByRole('alert')).not.toHaveTextContent('synthetic-secret');
  expect(screen.getByLabelText('API Key')).toHaveValue('synthetic-secret');
  const confirm = screen.getByRole('button', { name: '确认替换' });
  fireEvent.click(confirm); fireEvent.click(confirm);
  expect(modelSettings.save).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  await act(async () => pending.resolve(saved));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('API Key')).toHaveValue('');
});

it('旧模型如实保留，不能保存或检查，不会自动换模型或删除密钥', async () => {
  vi.mocked(modelSettings.status).mockResolvedValue({ ...saved, modelId: 'legacy-model' });
  render(<ModelConnectionSettings />);
  await screen.findByText('已配置 · legacy-model');
  expect(screen.getByText(/已保留原配置 legacy-model/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '检查连接' })).toBeDisabled();
  expect(modelSettings.save).not.toHaveBeenCalled(); expect(modelSettings.remove).not.toHaveBeenCalled();
  vi.mocked(modelSettings.save).mockResolvedValue(saved);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /legacy-model.*模型/ }));
  await user.click(await screen.findByRole('option', { name: 'deepseek-flash（已适配）' }));
  expect(screen.getByRole('button', { name: '保存配置' })).toBeEnabled();
  expect(modelSettings.save).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(modelSettings.save).toHaveBeenCalledExactlyOnceWith({ modelId: 'deepseek-flash', apiKey: '' }));
});

it('凭据更新丢弃旧连接结果并重新读取状态', async () => {
  const pending = deferred<typeof saved>();
  vi.mocked(modelSettings.status).mockResolvedValueOnce(saved).mockResolvedValueOnce({ ...saved, configured: false });
  vi.mocked(modelSettings.check).mockReturnValueOnce(pending.promise);
  render(<ModelConnectionSettings />);
  await screen.findByText(/已配置/);
  fireEvent.click(screen.getByRole('button', { name: '检查连接' }));
  act(() => notifyCredentialChanged());
  await screen.findByText('尚未配置');
  await act(async () => pending.resolve(saved));
  expect(screen.getByText('尚未配置')).toBeInTheDocument();
  expect(screen.queryByText(/连接检查通过/)).not.toBeInTheDocument();
  expect(screen.queryByText(/最近一次连接检查/)).not.toBeInTheDocument();
});

it('卸载后成功保存仍通知当前消费者重读，不回写卸载组件状态', async () => {
  const pending = deferred<typeof saved>();
  vi.mocked(modelSettings.status).mockResolvedValue({ ...saved, configured: false });
  vi.mocked(modelSettings.save).mockReturnValueOnce(pending.promise);
  const changed = vi.fn(); window.addEventListener(CREDENTIAL_CHANGED_EVENT, changed);
  const reread = vi.fn(() => { void assistantApi.status(); });
  try {
    const view = render(<ModelConnectionSettings />);
    await screen.findByText('尚未配置');
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'synthetic-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    view.unmount();
    // 模拟已导航到助手的消费者：收到失效通知后重新读取当前凭据状态。
    window.addEventListener(ASSISTANT_STATUS_CHANGED_EVENT, reread);
    await act(async () => pending.resolve(saved));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(reread).toHaveBeenCalledTimes(1);
  } finally { window.removeEventListener(CREDENTIAL_CHANGED_EVENT, changed); window.removeEventListener(ASSISTANT_STATUS_CHANGED_EVENT, reread); }
});

it('分开显示运行就绪和未验证的供应商能力，并显示已有价格提示', async () => {
  vi.mocked(modelSettings.status).mockResolvedValue(saved);
  const ready = await assistantApi.status();
  vi.mocked(assistantApi.status).mockResolvedValue({ ...ready, priceNotice: '价格档案已超过复核日期，显示的费用为估算。' });
  render(<ModelConnectionSettings />);
  expect(await screen.findByText(/当前运行端已就绪/)).toBeInTheDocument();
  expect(screen.getByText(/价格档案已超过复核日期/)).toBeInTheDocument();
  expect(screen.getByText(/不代表账户余额充足、生成成功或工具调用已验证/)).toBeInTheDocument();
  expect(screen.getByText(/不会开启 AI 功能/)).toBeInTheDocument();
  expect(modelSettings.check).not.toHaveBeenCalled();
});

it('桌面模式解释本机加密存储，网页模式说明服务器账户文件', async () => {
  vi.mocked(modelSettings.status).mockResolvedValue(saved);
  const web = render(<ModelConnectionSettings />);
  expect(await screen.findByText(/网页版：密钥保存在当前 API 服务器/)).toBeInTheDocument();
  web.unmount();
  const previous = window.knowraDesktop;
  window.knowraDesktop = { ...previous, modelSettings: vi.fn() } as typeof window.knowraDesktop;
  try {
    render(<ModelConnectionSettings />);
    expect(await screen.findByText(/桌面版：密钥保存在这台电脑/)).toBeInTheDocument();
    expect(screen.queryByText(/网页版：密钥保存在/)).not.toBeInTheDocument();
  } finally { window.knowraDesktop = previous; }
});
