import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BudgetAlertBanner } from './BudgetAlertBanner';
import { assistantApi, type BudgetAlert, type BudgetAlerts } from './assistantApi';
import { ASSISTANT_STATUS_CHANGED_EVENT } from './assistantEvents';

const navigate = vi.fn();
vi.mock('../../app/router', () => ({ useNavigate: () => navigate }));
vi.mock('./assistantApi', () => ({ assistantApi: { alerts: vi.fn(), markAlerts: vi.fn(), allowRule: vi.fn(), pauseRule: vi.fn(), resumeRule: vi.fn() } }));

const alert = (threshold: number, over: Partial<BudgetAlert> = {}): BudgetAlert => ({ id: `daily:2026-10-08:${threshold}`, rule: 'daily', threshold,
  period: '2026-10-08', mode: 'stop', usedMicrounits: threshold * 200_000, limitMicrounits: 20_000_000, notified: true, dismissed: false, ...over });
// 默认按提醒推出规则状态：最高阈值 ≥100 且为“达到即停”、未放行时视为已拦截；需要独立于阈值的情形可显式传入 rules。
const rulesOf = (alerts: BudgetAlert[], overrides: BudgetAlerts['overrides']): BudgetAlerts['rules'] => (['daily', 'monthly'] as const).flatMap(rule => {
  const top = alerts.filter(item => item.rule === rule).sort((a, b) => b.threshold - a.threshold)[0];
  return top ? [{ rule, mode: top.mode, period: top.period, usedMicrounits: top.usedMicrounits, limitMicrounits: top.limitMicrounits,
    blocked: top.threshold >= 100 && top.mode === 'stop' && !overrides.some(item => item.rule === rule) }] : [];
});
const state = (alerts: BudgetAlert[], overrides: BudgetAlerts['overrides'] = [], pauses: BudgetAlerts['pauses'] = [], rules?: BudgetAlerts['rules']): BudgetAlerts =>
  ({ day: '2026-10-08', location: 'local', alerts, rules: rules ?? rulesOf(alerts, overrides), overrides, pauses });

beforeEach(() => {
  vi.resetAllMocks();
  delete (window as { knowraDesktop?: unknown }).knowraDesktop;
});

it('只展示最高的已越过阈值；“继续”把同规则的所有阈值标为已关闭', async () => {
  vi.mocked(assistantApi.alerts).mockResolvedValue(state([alert(50), alert(80)]));
  vi.mocked(assistantApi.markAlerts).mockResolvedValue(state([alert(50, { dismissed: true }), alert(80, { dismissed: true })]));
  render(<BudgetAlertBanner />);
  expect(await screen.findByText(/今日 AI 费用已达上限的 80%/)).toBeInTheDocument();
  expect(screen.queryByText(/的 50%/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '继续' }));
  await waitFor(() => expect(assistantApi.markAlerts).toHaveBeenCalledWith(['daily:2026-10-08:50', 'daily:2026-10-08:80'], 'dismissed'));
  await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
});

it('达到即停并 100% 时显示已暂停，可放行当日或去提高上限', async () => {
  vi.mocked(assistantApi.alerts).mockResolvedValue(state([alert(50), alert(80), alert(100)]));
  vi.mocked(assistantApi.allowRule).mockResolvedValue(state([alert(100)], [{ rule: 'daily', period: '2026-10-08' }]));
  render(<BudgetAlertBanner />);
  expect(await screen.findByRole('alert')).toHaveTextContent('今日费用已达上限，AI 已暂停');
  expect(screen.queryByRole('button', { name: /暂停 AI 至/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '提高上限' }));
  expect(navigate).toHaveBeenCalledWith('/settings');
  fireEvent.click(screen.getByRole('button', { name: '今日放行' }));
  await waitFor(() => expect(assistantApi.allowRule).toHaveBeenCalledWith('daily'));
  expect(await screen.findByText(/今日已放行/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('“暂停 AI”只记录本周期暂停，不改写预算设置；暂停后显示恢复入口，可提前恢复', async () => {
  const alerts = [alert(50, { mode: 'warn' }), alert(80, { mode: 'warn' })];
  vi.mocked(assistantApi.alerts).mockResolvedValue(state(alerts));
  vi.mocked(assistantApi.pauseRule).mockResolvedValue(state(alerts, [], [{ rule: 'daily', period: '2026-10-08' }]));
  vi.mocked(assistantApi.markAlerts).mockResolvedValue(state(alerts.map(item => ({ ...item, dismissed: true })), [], [{ rule: 'daily', period: '2026-10-08' }]));
  vi.mocked(assistantApi.resumeRule).mockResolvedValue(state([]));
  render(<BudgetAlertBanner />);
  fireEvent.click(await screen.findByRole('button', { name: '暂停 AI 至明天' }));
  await waitFor(() => expect(assistantApi.pauseRule).toHaveBeenCalledWith('daily'));
  expect(await screen.findByText(/AI 已暂停至明天/)).toBeInTheDocument();
  expect(screen.queryByText(/的 80%/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '立即恢复' }));
  await waitFor(() => expect(assistantApi.resumeRule).toHaveBeenCalledWith('daily'));
  await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
});

it('Mac 版经主进程发系统通知：确认已交给系统才记为已通知，每条规则只发最高阈值；网页版不发', async () => {
  const fresh = [alert(50, { notified: false }), alert(80, { notified: false })];
  vi.mocked(assistantApi.alerts).mockImplementation(async () => state(fresh));
  vi.mocked(assistantApi.markAlerts).mockResolvedValue(state(fresh.map(item => ({ ...item, notified: true }))));
  render(<BudgetAlertBanner />);
  await screen.findByText(/80%/);
  expect(assistantApi.markAlerts).not.toHaveBeenCalled(); // 网页版没有主进程通知能力
  const notify = vi.fn(async (_input: { title: string; body: string }) => true);
  (window as { knowraDesktop?: unknown }).knowraDesktop = { notify };
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(assistantApi.markAlerts).toHaveBeenCalledWith(['daily:2026-10-08:50', 'daily:2026-10-08:80'], 'notified'));
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls[0][0]).toMatchObject({ title: expect.stringContaining('80%') });
});

it('系统通知被拒绝或抛错时不记为已通知，同一会话内不反复重试', async () => {
  const fresh = [alert(80, { notified: false })];
  vi.mocked(assistantApi.alerts).mockImplementation(async () => state(fresh));
  const notify = vi.fn(async () => false);
  (window as { knowraDesktop?: unknown }).knowraDesktop = { notify };
  render(<BudgetAlertBanner />);
  await screen.findByText(/80%/);
  await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(notify).toHaveBeenCalledTimes(1);
  expect(assistantApi.markAlerts).not.toHaveBeenCalled();
  (window as { knowraDesktop?: unknown }).knowraDesktop = { notify: vi.fn(async () => { throw new Error('ipc'); }) };
});

it('阈值不含 100% 时，用量已达上限仍显示“已拦截”并提供放行入口，而不是“继续”', async () => {
  // 阈值只设为 80%，实际已用 ¥20 / 上限 ¥20（达到即停）
  const only80 = alert(80, { usedMicrounits: 20_000_000, limitMicrounits: 20_000_000 });
  const rules: BudgetAlerts['rules'] = [{ rule: 'daily', mode: 'stop', period: '2026-10-08', usedMicrounits: 20_000_000, limitMicrounits: 20_000_000, blocked: true }];
  vi.mocked(assistantApi.alerts).mockResolvedValue(state([only80], [], [], rules));
  vi.mocked(assistantApi.allowRule).mockResolvedValue(state([only80], [{ rule: 'daily', period: '2026-10-08' }], [], [{ ...rules[0], blocked: false }]));
  render(<BudgetAlertBanner />);
  expect(await screen.findByRole('alert')).toHaveTextContent('今日费用已达上限，AI 已暂停');
  expect(screen.queryByRole('button', { name: '继续' })).not.toBeInTheDocument();
  expect(screen.queryByText(/的 80%/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '今日放行' }));
  await waitFor(() => expect(assistantApi.allowRule).toHaveBeenCalledWith('daily'));
  expect(await screen.findByText(/今日已放行/)).toBeInTheDocument();
});

it('完全没有越过任何阈值（阈值列表为空）时，用量达到上限也显示已拦截；“关闭提示”只在本次会话隐藏', async () => {
  const rules: BudgetAlerts['rules'] = [{ rule: 'monthly', mode: 'stop', period: '2026-10', usedMicrounits: 100_000_000, limitMicrounits: 100_000_000, blocked: true }];
  vi.mocked(assistantApi.alerts).mockImplementation(async () => state([], [], [], rules));
  render(<BudgetAlertBanner />);
  expect(await screen.findByRole('alert')).toHaveTextContent('本月费用已达上限');
  fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
  await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
  expect(assistantApi.markAlerts).not.toHaveBeenCalled();
});

it('仅提醒（不拦截）的规则用到上限也只显示提醒，不显示已拦截', async () => {
  const warnOnly = alert(100, { mode: 'warn', usedMicrounits: 20_000_000, limitMicrounits: 20_000_000 });
  vi.mocked(assistantApi.alerts).mockResolvedValue(state([warnOnly], [], [], [{ rule: 'daily', mode: 'warn', period: '2026-10-08', usedMicrounits: 20_000_000, limitMicrounits: 20_000_000, blocked: false }]));
  render(<BudgetAlertBanner />);
  expect(await screen.findByText(/已达上限的 100%/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument();
});

it('读取提醒失败时不显示任何横幅', async () => {
  vi.mocked(assistantApi.alerts).mockRejectedValue(new Error('x'));
  render(<BudgetAlertBanner />);
  await waitFor(() => expect(assistantApi.alerts).toHaveBeenCalled());
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});

it('放行后通知助手视图刷新状态', async () => {
  const changed = vi.fn();
  window.addEventListener(ASSISTANT_STATUS_CHANGED_EVENT, changed);
  try {
    vi.mocked(assistantApi.alerts).mockResolvedValue(state([alert(100)]));
    vi.mocked(assistantApi.allowRule).mockResolvedValue(state([alert(100)], [{ rule: 'daily', period: '2026-10-08' }]));
    render(<BudgetAlertBanner />);
    fireEvent.click(await screen.findByRole('button', { name: '今日放行' }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  } finally { window.removeEventListener(ASSISTANT_STATUS_CHANGED_EVENT, changed); }
});

it('仅关闭横幅不改变助手能否调用，不通知', async () => {
  const changed = vi.fn();
  window.addEventListener(ASSISTANT_STATUS_CHANGED_EVENT, changed);
  try {
    vi.mocked(assistantApi.alerts).mockResolvedValue(state([alert(80)]));
    vi.mocked(assistantApi.markAlerts).mockResolvedValue(state([alert(80, { dismissed: true })]));
    render(<BudgetAlertBanner />);
    fireEvent.click(await screen.findByRole('button', { name: '继续' }));
    await waitFor(() => expect(assistantApi.markAlerts).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
    expect(changed).not.toHaveBeenCalled();
  } finally { window.removeEventListener(ASSISTANT_STATUS_CHANGED_EVENT, changed); }
});

it('暂停状态文件损坏时显示阻止提示，重置后通知助手视图', async () => {
  const changed = vi.fn();
  window.addEventListener(ASSISTANT_STATUS_CHANGED_EVENT, changed);
  try {
    vi.mocked(assistantApi.alerts).mockResolvedValue({ ...state([]), stateInvalid: true });
    vi.mocked(assistantApi.resumeRule).mockResolvedValue(state([]));
    render(<BudgetAlertBanner />);
    expect(await screen.findByRole('alert')).toHaveTextContent('暂停/提醒状态文件已损坏，AI 已被阻止');
    fireEvent.click(screen.getByRole('button', { name: '重置并恢复' }));
    await waitFor(() => expect(assistantApi.resumeRule).toHaveBeenCalledWith('daily'));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
  } finally { window.removeEventListener(ASSISTANT_STATUS_CHANGED_EVENT, changed); }
});

it('暂停到期或跨日恢复后通知助手视图刷新状态（首次读取不通知）', async () => {
  const changed = vi.fn();
  window.addEventListener(ASSISTANT_STATUS_CHANGED_EVENT, changed);
  try {
    vi.mocked(assistantApi.alerts)
      .mockImplementationOnce(async () => state([], [], [{ rule: 'daily', period: '2026-10-08' }]))
      .mockImplementation(async () => ({ ...state([]), day: '2026-10-09' })); // 跨日后暂停已不再生效
    render(<BudgetAlertBanner />);
    expect(await screen.findByText(/AI 已暂停至明天/)).toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled(); // 首次读取只是建立基准
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.queryByText(/AI 已暂停至明天/)).not.toBeInTheDocument());
    expect(changed).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(changed).toHaveBeenCalledTimes(1); // 状态没再变化，不重复通知
  } finally { window.removeEventListener(ASSISTANT_STATUS_CHANGED_EVENT, changed); }
});
