import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TrainingAssetRecord } from '@study-accelerator/web-core';
import { QuestionDetailPanel } from './QuestionDetailPanel';

const question: TrainingAssetRecord = { id: 'q1', updatedAt: '2026-10-02T00:00:00Z', stem: '解释变化率', questionType: 'shortAnswer', reviewStatus: 'candidate',
  referenceAnswer: '导数刻画瞬时变化率', rubric: { totalPoints: 2, criteria: [{ description: '说明变化率', points: 2 }] }, explanation: '平均变化率的极限',
  learningObjectiveIds: ['o2', 'o1', 'missing'], sources: [{ id: 's1', sourceType: 'learningObjective', sourceId: 'o1', quote: '编题时的目标', status: 'stale' }] };
const objectives = [{ id: 'o1', objective: '解释导数', reviewStatus: 'confirmed', updatedAt: question.updatedAt }, { id: 'o2', objective: '计算导数', reviewStatus: 'archived', updatedAt: question.updatedAt }];
function props(value = question) {
  return { question: value, objectives, knowledgeItems: [], onClose: vi.fn(), onCompare: vi.fn(), onOpenKnowledge: vi.fn(), onOpenObjective: vi.fn() };
}

describe('题目详情', () => {
  it('按关联顺序展示全部目标、不可用标识、评分标准和需复核来源', async () => {
    const input = props(); render(<QuestionDetailPanel {...input} />);
    const goals = within(screen.getByRole('region', { name: '关联学习目标' }));
    const rows = goals.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('计算导数'); expect(rows[0]).toHaveTextContent('已归档');
    expect(rows[1]).toHaveTextContent('解释导数'); expect(rows[2]).toHaveTextContent('missing');
    expect(screen.getByRole('region', { name: '评分标准' })).toHaveTextContent('说明变化率');
    expect(screen.getByRole('region', { name: '参考答案' })).toHaveTextContent('导数刻画瞬时变化率');
    expect(screen.getByRole('region', { name: '题目解析' })).toHaveTextContent('平均变化率的极限');
    await userEvent.click(screen.getByRole('button', { name: '对照来源' }));
    expect(input.onCompare).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', quote: '编题时的目标', status: 'stale' }));
    await userEvent.click(goals.getAllByRole('button', { name: '查看学习目标' })[0]);
    expect(input.onOpenObjective).toHaveBeenCalledWith(objectives[1]);
  });

  it.each([[true, '正确'], [false, '错误']])('判断题答案 %s 保留布尔语义', (answer, label) => {
    render(<QuestionDetailPanel {...props({ ...question, questionType: 'trueFalse', referenceAnswer: answer })} />);
    expect(screen.getByRole('region', { name: '参考答案' })).toHaveTextContent(label);
  });

  it('多选答案对应选项文本，未知选项明确提示，结构化评分中的零和 false 不丢失', () => {
    render(<QuestionDetailPanel {...props({ ...question, questionType: 'multipleChoice', options: [{ id: 'A', text: '切线斜率' }, { id: 'B', text: '瞬时变化率' }], referenceAnswer: ['A', 'B', 'C'], rubric: { points: 0, required: false } })} />);
    const answer = screen.getByRole('region', { name: '参考答案' });
    expect(answer).toHaveTextContent('A · 切线斜率'); expect(answer).toHaveTextContent('B · 瞬时变化率'); expect(answer).toHaveTextContent('C（未找到对应选项）');
    expect(screen.getByRole('region', { name: '评分标准' })).toHaveTextContent('0');
    expect(screen.getByRole('region', { name: '评分标准' })).toHaveTextContent('否');
  });

  it('空答案、空评分、无目标和无来源均有可读的空状态', () => {
    render(<QuestionDetailPanel {...props({ ...question, referenceAnswer: null, rubric: null, learningObjectiveIds: [], sources: [] })} />);
    expect(screen.getByText('尚未填写参考答案。')).toBeInTheDocument();
    expect(screen.getByText('尚未填写评分标准。')).toBeInTheDocument();
    expect(screen.getByText('尚未关联学习目标。')).toBeInTheDocument();
    expect(screen.getByText('尚未记录题目来源。')).toBeInTheDocument();
  });

  it.each([[1, 1], [' A ', 'A'], ['A', ' A ']])('后端合法的选项ID %s 与答案 %s 按同一规则匹配', (optionId, answerId) => {
    render(<QuestionDetailPanel {...props({ ...question, questionType: 'singleChoice', options: [{ id: optionId, text: '正确选项' }, { id: 'B', text: '其他选项' }], referenceAnswer: answerId })} />);
    const answer = screen.getByRole('region', { name: '参考答案' });
    expect(answer).toHaveTextContent('正确选项');
    expect(answer).not.toHaveTextContent('未找到对应选项');
  });
});
