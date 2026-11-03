import { act, fireEvent, render, screen } from '@testing-library/react';
import { assistantApi, type AssistantStatus } from '../assistant/assistantApi';
import { notifyAssistantStatusChanged } from '../assistant/assistantEvents';
import { notifyCredentialChanged } from './credentialEvents';
import { ModelRuntimeStatus } from './ModelRuntimeStatus';
vi.mock('../assistant/assistantApi', () => ({ assistantApi: { status: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
const state: AssistantStatus = { provider: 'deepseek', modelId: 'deepseek-flash', configured: true,
  executionLocation: 'local', generationAvailable: false, unavailableReason: '本机预算账本不可用，已阻止模型调用。', budget: null,
  capabilities: { readScopes: ['note'], actions: ['answer'], responseMode: 'polling', writeTools: false, providerAdvertised: null, providerVerified: false } };

it('读取失败与配置失败分开，并允许重试显示运行阻塞原因', async () => {
  vi.mocked(assistantApi.status).mockRejectedValueOnce(new Error('secret-bearing runtime failure')).mockResolvedValueOnce(state);
  render(<ModelRuntimeStatus />);
  expect(await screen.findByText(/暂时无法读取运行状态/)).not.toHaveTextContent('secret-bearing');
  fireEvent.click(screen.getByRole('button', { name: '重试读取运行状态' }));
  expect(await screen.findByText(/本机预算账本不可用/)).toBeInTheDocument();
});

it('换凭据立即清空旧就绪状态，丢弃较早读取结果，预算变化也刷新', async () => {
  let resolve!: (value: AssistantStatus) => void;
  vi.mocked(assistantApi.status).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce(state)
    .mockResolvedValueOnce({ ...state, generationAvailable: true, unavailableReason: null });
  render(<ModelRuntimeStatus />);
  act(() => notifyCredentialChanged());
  await screen.findByText(/本机预算账本不可用/);
  await act(async () => resolve({ ...state, generationAvailable: true, unavailableReason: null }));
  expect(screen.queryByText(/当前运行端已就绪/)).not.toBeInTheDocument();
  act(() => notifyAssistantStatusChanged());
  expect(await screen.findByText(/当前运行端已就绪/)).toBeInTheDocument();
});
