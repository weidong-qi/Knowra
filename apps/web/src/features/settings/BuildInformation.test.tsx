import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BuildInformation } from './BuildInformation';
import { SettingsView } from './SettingsView';
import { defaultAppPreferences } from './preferences';

vi.mock('./ModelConnectionSettings', () => ({ ModelConnectionSettings: () => <section>模型接入测试</section> }));
vi.mock('./BudgetLimitsSettings', () => ({ BudgetLimitsSettings: () => <section>预算测试</section> }));
vi.mock('./UsageSettings', () => ({ UsageSettings: () => <section>用量测试</section> }));

test('显示完整 SHA、UTC 时间以及 dirty/unknown 状态，不隐藏未提交构建', () => {
  const info = { schemaVersion: 1, version: '2.27.2', commit: 'a'.repeat(40), state: 'dirty' as const, source: 'git' as const, builtAt: '2026-10-02T00:00:00.000Z' };
  const { rerender } = render(<BuildInformation info={info} />);
  expect(screen.getByText(info.commit)).toBeVisible();
  expect(screen.getByText(info.builtAt)).toBeVisible();
  expect(screen.getByText('含未提交修改（dirty）')).toBeVisible();
  rerender(<BuildInformation info={{ ...info, commit: null, state: 'unknown', source: 'unknown' }} />);
  expect(screen.getByText('无法确认（unknown）')).toBeVisible();
  expect(screen.queryByText(info.commit)).not.toBeInTheDocument();
});

test('设置分类提供关于入口，切换后显示构建信息', async () => {
  const user = userEvent.setup();
  render(<SettingsView preferences={defaultAppPreferences} sidebarOpen onPreferencesChange={() => {}} onSidebarOpenChange={() => {}} />);
  await user.click(screen.getByRole('button', { name: /关于知境/ }));
  expect(screen.getByRole('heading', { name: '关于知境·Knowra' })).toBeVisible();
  expect(screen.getByText('完整提交 SHA')).toBeVisible();
  expect(screen.getByText('显示 1 / 9 项设置')).toBeVisible();
  expect(screen.queryByText('模型接入测试')).not.toBeInTheDocument();
});
