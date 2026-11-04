import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BudgetLimitsSettings } from './BudgetLimitsSettings';
import { assistantApi, type BudgetSettings } from '../assistant/assistantApi';

vi.mock('../assistant/assistantApi', () => ({ assistantApi: { budgetSettings: vi.fn(), saveBudgetSettings: vi.fn() } }));

const defaults = (): BudgetSettings => ({ location: 'local', price: null, alerts: { thresholds: [50, 80, 100] },
  basePrice: { version: 'v1', inputMicrounitsPerMillion: 2_000_000, outputMicrounitsPerMillion: 8_000_000, reviewedUntil: '2026-10-09T00:00:00.000Z' },
  rules: { daily: { mode: 'stop', limitMicrounits: 20_000_000 }, monthly: { mode: 'off', limitMicrounits: null },
    turn: { mode: 'stop', limitMicrounits: 2_000_000 }, balanceFloor: { mode: 'off', limitMicrounits: null } } });

beforeEach(() => vi.resetAllMocks());

it('显示默认的每日 20 元与单次 2 元，并标明是本机设置', async () => {
  vi.mocked(assistantApi.budgetSettings).mockResolvedValue(defaults());
  render(<BudgetLimitsSettings />);
  expect(await screen.findByLabelText('每日上限金额（元）')).toHaveValue('20');
  expect(screen.getByLabelText('单次回合上限金额（元）')).toHaveValue('2');
  expect(screen.getByLabelText('每月上限金额（元）')).toBeDisabled();
  expect(screen.getByText(/这是本机的设置/)).toBeInTheDocument();
});

it('修改金额后保存，发送以微元为单位的规则；金额无效时不发送', async () => {
  vi.mocked(assistantApi.budgetSettings).mockResolvedValue(defaults());
  vi.mocked(assistantApi.saveBudgetSettings).mockImplementation(async value => ({ ...defaults(), ...value }));
  render(<BudgetLimitsSettings />);
  const daily = await screen.findByLabelText('每日上限金额（元）');
  fireEvent.change(daily, { target: { value: 'abc' } });
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('每日上限');
  expect(assistantApi.saveBudgetSettings).not.toHaveBeenCalled();
  fireEvent.change(daily, { target: { value: '35.5' } });
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await waitFor(() => expect(assistantApi.saveBudgetSettings).toHaveBeenCalled());
  const sent = vi.mocked(assistantApi.saveBudgetSettings).mock.calls[0][0];
  expect(sent.rules.daily).toEqual({ mode: 'stop', limitMicrounits: 35_500_000 });
  expect(sent.price).toBeNull();
  expect(await screen.findByRole('status')).toHaveTextContent('预算设置已保存');
});

it('把已有上限改为关闭需要二次确认，取消则不保存', async () => {
  const settings = defaults();
  settings.rules.monthly = { mode: 'warn', limitMicrounits: 100_000_000 };
  vi.mocked(assistantApi.budgetSettings).mockResolvedValue(settings);
  vi.mocked(assistantApi.saveBudgetSettings).mockImplementation(async value => ({ ...defaults(), ...value }));
  render(<BudgetLimitsSettings />);
  await screen.findByLabelText('每月上限金额（元）');
  fireEvent.click(screen.getByRole('button', { name: /每月上限/ }));
  fireEvent.click(await screen.findByRole('option', { name: '关闭' }));
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(await screen.findByRole('alertdialog', { name: '确认不设上限' })).toBeInTheDocument();
  expect(assistantApi.saveBudgetSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认不设上限' }));
  await waitFor(() => expect(assistantApi.saveBudgetSettings).toHaveBeenCalledTimes(1));
  expect(vi.mocked(assistantApi.saveBudgetSettings).mock.calls[0][0].rules.monthly).toEqual({ mode: 'off', limitMicrounits: null });
});

it('读取失败时提示并允许重试', async () => {
  vi.mocked(assistantApi.budgetSettings).mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(defaults());
  render(<BudgetLimitsSettings />);
  expect(await screen.findByRole('alert')).toHaveTextContent('无法读取预算设置');
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
  expect(await screen.findByLabelText('每日上限金额（元）')).toHaveValue('20');
});
