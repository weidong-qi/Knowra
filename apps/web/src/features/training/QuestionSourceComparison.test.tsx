import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuestionSourceComparison } from './QuestionSourceComparison';
import type { QuestionSourceContent } from './questionSourceModel';
import type { QuestionSource } from './questionDetailModel';

const source: QuestionSource = { id: 's1', sourceType: 'noteVersion', sourceId: 'v1', quote: '旧摘录', status: 'stale', locator: null };
const content: QuestionSourceContent = { title: '旧版本', content: '完整历史正文', contentLabel: '引用版本正文', noteId: 'n1' };

describe('来源对照弹窗', () => {
  it('加载失败保留保存摘录，重试后展示历史正文与当前笔记入口', async () => {
    const onLoad = vi.fn().mockRejectedValueOnce(new Error('暂时无法读取')).mockResolvedValue(content);
    const onOpenNote = vi.fn();
    render(<QuestionSourceComparison source={source} onLoad={onLoad} onOpenNote={onOpenNote} onOpenKnowledge={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取');
    expect(screen.getByRole('region', { name: '编题时保存的摘录' })).toHaveTextContent('旧摘录');
    await userEvent.click(screen.getByRole('button', { name: '重新读取来源' }));
    expect(await screen.findByText('完整历史正文')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '打开当前笔记' }));
    expect(onOpenNote).toHaveBeenCalledWith('n1');
  });
  it('切换来源后迟到的旧正文不能覆盖当前选择', async () => {
    let finish!: (value: QuestionSourceContent) => void;
    const onLoad = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ...content, content: '另一来源正文' });
    const input = { source, onLoad, onOpenNote: vi.fn(), onOpenKnowledge: vi.fn(), onClose: vi.fn() };
    const view = render(<QuestionSourceComparison {...input} />);
    view.rerender(<QuestionSourceComparison {...input} source={{ ...source, id: 's2', quote: '另一来源摘录' }} />);
    await screen.findByText('另一来源正文');
    await act(async () => finish(content));
    expect(within(screen.getByRole('region', { name: '来源内容' })).queryByText('完整历史正文')).not.toBeInTheDocument();
    expect(screen.getByText('另一来源摘录')).toBeInTheDocument();
  });
});
