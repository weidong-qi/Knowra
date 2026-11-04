import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConversationTrace } from './ConversationTrace';
import type { ConversationTurn, ToolCall } from './conversationApi';

const turn: ConversationTurn = { turnId: 'turn-1', conversationId: 'conversation-1', requestedPolicyId: null,
  status: 'succeeded', phase: 'finished', errorCode: null, toolCalls: [], modelAttempts: [] };
const call = (patch: Partial<ToolCall> = {}): ToolCall => ({ callId: 'call-1', ordinal: 1,
  toolName: 'notes_search', argumentsJson: {}, resultJson: null, status: 'succeeded', sourceRefs: [], errorCode: null, ...patch });
const props = () => ({ turnId: turn.turnId, turn, turnStatusLabel: '已完成', onLoad: vi.fn(), onReviewCandidates: vi.fn() });

it('原生折叠节点只在打开时请求记录，加载完成及同消息重绘保留节点与展开状态', async () => {
  const input = props();
  const view = render(<ConversationTrace {...input} turn={undefined} turnStatusLabel={undefined} />);
  const summary = screen.getByText('检索与调用记录');
  const details = summary.closest('details')!;
  expect(details.open).toBe(false);
  expect(input.onLoad).not.toHaveBeenCalled();
  fireEvent.click(summary);
  await waitFor(() => expect(input.onLoad).toHaveBeenCalledWith('turn-1'));
  expect(details.open).toBe(true);
  expect(screen.getByText('正在读取记录…')).toBeVisible();
  view.rerender(<ConversationTrace {...input} />);
  expect(screen.getByText('检索与调用记录').closest('details')).toBe(details);
  expect(details.open).toBe(true);
  expect(screen.getByText('本轮没有检索或阅读工具记录。')).toBeVisible();
  view.rerender(<ConversationTrace {...input} turn={{ ...turn, toolCalls: [call()] }} />);
  expect(screen.getByText('检索与调用记录').closest('details')).toBe(details);
  expect(details.open).toBe(true);
  expect(screen.getByText('检索笔记')).toBeVisible();
  input.onLoad.mockClear();
  fireEvent.click(summary);
  await waitFor(() => expect(details.open).toBe(false));
  // 直接发出关闭事件，验证 onToggle 不会为关闭请求读取。
  fireEvent(details, new Event('toggle', { bubbles: false }));
  expect(input.onLoad).not.toHaveBeenCalled();
});

it.each([
  ['notes_search', {}, '检索笔记'],
  ['notes_search', { origin: 'automatic' }, '自动检索笔记'],
  ['notes_read', {}, '阅读笔记'],
  ['annotations_list', {}, '读取重点标记'],
  ['knowledge_propose', {}, '提交知识候选（待审核）'],
  ['notes_create', {}, '生成笔记计划（尚未写入）'],
  ['notes_append', {}, '生成笔记计划（尚未写入）'],
  ['notes_propose_patch', {}, '生成笔记计划（尚未写入）'],
  ['notes_propose_organize', {}, '生成笔记计划（尚未写入）']
] as const)('工具 %s 的审计标签保持原语义', (toolName, argumentsJson, label) => {
  render(<ConversationTrace {...props()} turn={{ ...turn, toolCalls: [call({ toolName, argumentsJson })] }} />);
  expect(screen.getByText(label)).toBeInTheDocument();
});

it.each([
  [call({ status: 'failed', errorCode: 'AI_ERROR' }), 'succeeded', '失败：AI_ERROR'],
  [call({ status: 'failed' }), 'succeeded', '失败：未知原因'],
  [call({ status: 'requested' }), 'running', '执行中'],
  [call({ status: 'requested' }), 'interrupted', '执行未完成'],
  [call({ toolName: 'annotations_list', resultJson: { annotations: [{}, {}], total: 7 } }), 'succeeded', '共 7 处重点，本页 2 处 · 0 个来源片段'],
  [call({ toolName: 'annotations_list' }), 'succeeded', '0 处重点 · 0 个来源片段'],
  [call({ toolName: 'knowledge_propose', resultJson: { candidates: [{}] } }), 'succeeded', '已校验 1 条候选（未保存）']
] as const)('工具结果摘要分支 %# 保持不变', (toolCall, status, summary) => {
  render(<ConversationTrace {...props()} turn={{ ...turn, status, toolCalls: [toolCall] }} />);
  expect(screen.getByText(`· ${summary}`)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '在知识库审核候选', hidden: true })).not.toBeInTheDocument();
});

it('关键词回退、查询与受限提示保持可见，只有成功保存候选显示审核入口', () => {
  const input = props();
  render(<ConversationTrace {...input} turn={{ ...turn, errorCode: 'AI_WARNING', toolCalls: [
    call({ callId: 'search', argumentsJson: { query: 'alpha' }, resultJson: { mode: 'keyword_fallback', truncated: true } }),
    call({ callId: 'keyword', resultJson: { mode: 'keyword' } }),
    call({ callId: 'saved', toolName: 'knowledge_propose', resultJson: { saved: true, candidates: [{}, {}] } })
  ] }} />);
  fireEvent.click(screen.getByText('检索与调用记录'));
  expect(screen.getByText(/本轮：已完成 · AI_WARNING · 模型尝试 0 次/)).toBeVisible();
  expect(screen.getByText(/alpha/)).toBeVisible();
  expect(screen.getByText('· 索引无可用结果，已改用关键词检索')).toBeVisible();
  expect(screen.getByText('· 关键词检索')).toBeVisible();
  expect(screen.getByText('· 检索范围受限')).toBeVisible();
  expect(screen.getByText('· 已保存 2 条候选，尚未入库，需在知识库审核')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '在知识库审核候选' }));
  expect(input.onReviewCandidates).toHaveBeenCalledOnce();
});
