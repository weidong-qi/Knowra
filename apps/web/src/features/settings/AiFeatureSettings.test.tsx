import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiRequestError } from '@study-accelerator/web-core';
import { AiFeatureSettings } from './AiFeatureSettings';
import { aiFeatures } from './aiFeatures';

vi.mock('./aiFeatures', () => ({ aiFeatures: { get: vi.fn(), set: vi.fn() } }));

beforeEach(() => vi.resetAllMocks());
const toggle = () => screen.getByRole('checkbox', { name: 'AI 提炼知识点', hidden: true });

it('默认关闭；开启前弹出说明，取消不保存，确认后保存并提示读取范围仍需授权', async () => {
  vi.mocked(aiFeatures.get).mockResolvedValue({ knowledgeProposals: false });
  vi.mocked(aiFeatures.set).mockResolvedValue({ knowledgeProposals: true });
  render(<AiFeatureSettings />);
  expect(await screen.findByText('未开启')).toBeInTheDocument();
  expect(toggle()).not.toBeChecked();
  fireEvent.click(toggle());
  const dialog = await screen.findByRole('dialog', { name: '开启“AI 提炼知识点”？' });
  expect(dialog).toHaveTextContent('相关笔记片段会被发送到外部服务');
  expect(dialog).toHaveTextContent('只有在你明确授权读取范围后才会读取');
  expect(dialog).toHaveTextContent('候选不会自动入库，需要你在知识库逐条审核');
  expect(aiFeatures.set).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(aiFeatures.set).not.toHaveBeenCalled(); expect(toggle()).not.toBeChecked();
  fireEvent.click(toggle());
  fireEvent.click(await screen.findByRole('button', { name: '确认开启' }));
  await waitFor(() => expect(aiFeatures.set).toHaveBeenCalledExactlyOnceWith({ knowledgeProposals: true }));
  expect(await screen.findByText('已开启')).toBeInTheDocument();
  expect(toggle()).toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('读取范围仍需在每次对话中授权');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('关闭时不弹提示，直接生效', async () => {
  vi.mocked(aiFeatures.get).mockResolvedValue({ knowledgeProposals: true });
  vi.mocked(aiFeatures.set).mockResolvedValue({ knowledgeProposals: false });
  render(<AiFeatureSettings />);
  expect(await screen.findByText('已开启')).toBeInTheDocument();
  fireEvent.click(toggle());
  await waitFor(() => expect(aiFeatures.set).toHaveBeenCalledExactlyOnceWith({ knowledgeProposals: false }));
  expect(await screen.findByText('未开启')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(toggle()).not.toBeChecked();
});

it('保存失败时保持关闭并显示错误，确认弹窗保留可重试', async () => {
  vi.mocked(aiFeatures.get).mockResolvedValue({ knowledgeProposals: false });
  vi.mocked(aiFeatures.set).mockRejectedValueOnce(new Error('磁盘不可写')).mockResolvedValueOnce({ knowledgeProposals: true });
  render(<AiFeatureSettings />);
  await screen.findByText('未开启');
  fireEvent.click(toggle()); fireEvent.click(await screen.findByRole('button', { name: '确认开启' }));
  expect(await within(await screen.findByRole('dialog', { name: '开启“AI 提炼知识点”？' })).findByRole('alert')).toHaveTextContent('磁盘不可写');
  expect(toggle()).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '确认开启' }));
  expect(await screen.findByText('已开启')).toBeInTheDocument();
});

it('读取失败（含接口 404）时开关不可用并可重试，不会误显示为已关闭', async () => {
  vi.mocked(aiFeatures.get)
    .mockRejectedValueOnce(new ApiRequestError('Route not found', { status: 404, code: 'ROUTE_NOT_FOUND' }))
    .mockResolvedValueOnce({ knowledgeProposals: true });
  render(<AiFeatureSettings />);
  expect(await screen.findByText('状态未知')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('当前服务未提供 AI 功能开关接口');
  expect(toggle()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
  expect(await screen.findByText('已开启')).toBeInTheDocument();
  expect(toggle()).toBeEnabled(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
