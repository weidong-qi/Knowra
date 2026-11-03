import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LocalReportReview } from './LocalReportReview';
import { ConceptGraphView } from '../ConceptGraphView';
import { REUSED_ITEM_RESULT } from '../experimentGraph.fixture';
import { REVIEW_LIMITS } from '@study-accelerator/shared/incremental-review';
import * as downloads from './downloadReview';

const fixture = () => JSON.parse(readFileSync('../../packages/shared/test/fixtures/incremental-review.json', 'utf8'));
function sync(report: ReturnType<typeof fixture>) {
  const row = report.rows[0]; row.providerResult.parsed.links = row.proposals.map((p: { original: unknown }) => p.original);
  row.providerResult.rawText = JSON.stringify(row.providerResult.parsed); return report;
}
async function upload(report = fixture()) {
  const file = new File([JSON.stringify(report)], 'synthetic.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(report) });
  fireEvent.change(screen.getByLabelText('选择离线审阅报告文件'), { target: { files: [file] } });
  await screen.findByRole('region', { name: '报告笔记原文' });
}
const summary = () => screen.getByLabelText('报告审阅统计');
const assign = () => screen.getByRole('button', { name: '归到 合成概念（C1）' });

describe('离线报告审阅', () => {
  it('展示原文、提案、候选与旧条目；不默认选择，选择/待定可撤销；下载保留全部会话', async () => {
    const user = userEvent.setup(); const download = vi.spyOn(downloads, 'downloadReview').mockImplementation(() => {});
    render(<LocalReportReview onClose={() => {}} />); await upload();
    expect(assign()).toHaveTextContent('归入此概念');
    expect(summary()).toHaveTextContent('未决定 1'); expect(screen.getByRole('dialog')).toHaveTextContent('不认证文件来源');
    expect(screen.getByRole('region', { name: '候选概念与旧条目' })).toHaveTextContent('合成旧陈述保持原样');
    expect(screen.getByRole('region', { name: '模型提案' })).toHaveTextContent('未报告风险不代表事实可靠');
    await user.click(assign()); expect(summary()).toHaveTextContent('已选择 1');
    expect(screen.getByRole('status')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '下载未授权草稿' }));
    expect(screen.getByRole('dialog', { name: '下载包含原文的草稿？' })).toHaveTextContent('不是正式提交');
    await user.click(screen.getByRole('button', { name: '确认下载（含原文）' }));
    const draft = JSON.parse(download.mock.calls[0][0]); expect(draft.approval).toBe('not-granted');
    expect(draft.report.rows[0].note.markdown).toBe('合成甲属于示例。'); expect(draft.counts.selected).toBe(1);
    expect(summary()).toHaveTextContent('已选择 1');
    await user.click(screen.getByRole('button', { name: '撤销本条选择' }));
    await user.click(screen.getByRole('button', { name: '暂不决定' })); expect(summary()).toHaveTextContent('待定 1');
    await user.click(screen.getByRole('button', { name: '撤销本条选择' })); expect(summary()).toHaveTextContent('未决定 1');
  });
  it('成功替换和重置清空；有选择时须确认，取消及失败保留旧报告', async () => {
    const user = userEvent.setup(); render(<LocalReportReview onClose={() => {}} />); await upload(); await user.click(assign());
    await upload(); await screen.findByRole('button', { name: '确认替换' });
    await user.click(screen.getByRole('button', { name: /^取消$/ })); expect(summary()).toHaveTextContent('已选择 1');
    const bad = new File(['{}'], 'bad.json'); Object.defineProperty(bad, 'text', { value: async () => '{}' });
    fireEvent.change(screen.getByLabelText('选择离线审阅报告文件'), { target: { files: [bad] } });
    await screen.findByRole('alert'); expect(summary()).toHaveTextContent('已选择 1');
    await upload(); await user.click(await screen.findByRole('button', { name: '确认替换' })); expect(summary()).toHaveTextContent('未决定 1');
    await user.click(assign()); await user.click(screen.getByRole('button', { name: '重置报告' }));
    await user.keyboard('{Escape}'); expect(summary()).toHaveTextContent('已选择 1');
    await user.click(screen.getByRole('button', { name: '重置报告' })); await user.click(screen.getByRole('button', { name: '确认重置' }));
    expect(summary()).toHaveTextContent('尚未导入报告');
  });
  it('无候选可另建；必填、取消焦点与键盘；不调用网络或持久化', async () => {
    const user = userEvent.setup(); const report = fixture(); const row = report.rows[0];
    row.candidateConcepts = []; row.candidateItems = [];
    Object.assign(row.proposals[0].original, { conceptAction: 'create', conceptId: null, newConcept: { name: '新概念', sense: '合成语境' } }); sync(report);
    render(<LocalReportReview onClose={() => {}} />); await upload(report);
    const request = vi.spyOn(globalThis, 'fetch'); const write = vi.spyOn(Storage.prototype, 'setItem'); const remove = vi.spyOn(Storage.prototype, 'removeItem');
    expect(screen.queryByRole('button', { name: /^归到/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '另建概念' }));
    expect(screen.getByRole('button', { name: '确认另建（仅草稿）' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '取消另建' })); expect(screen.getByRole('status')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '另建概念' }));
    await user.type(screen.getByLabelText('新概念名称'), '合成新概念'); await user.type(screen.getByLabelText('语境说明'), '独立语境');
    screen.getByRole('button', { name: '确认另建（仅草稿）' }).focus(); await user.keyboard('{Enter}');
    expect(summary()).toHaveTextContent('已选择 1'); expect(request).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it.each(['risk', 'reuse', 'invalid', 'dependency'])('%s 提案只能待定', async kind => {
    const user = userEvent.setup(); const report = fixture(); const p = report.rows[0].proposals[0];
    if (kind === 'risk') p.original.sourceIssue = '合成风险';
    if (kind === 'reuse') Object.assign(p.original, { itemAction: 'reuse', existingItemId: 'K1' });
    if (kind === 'invalid') Object.assign(p, { original: null, validationAccepted: false, validationErrors: ['合成结构错误'] });
    if (kind === 'dependency') {
      Object.assign(p.original, { conceptAction: 'create', conceptId: null, newConcept: { name: '合成依赖概念', sense: '合成语境' }, sourceIssue: '风险' }); p.heldByProposalIndices = [0];
      const second = structuredClone(p); second.originalIndex = 1; second.proposalId = p.proposalId.replace('#0', '#1'); second.original.sourceIssue = null;
      report.rows[0].proposals.push(second);
    }
    render(<LocalReportReview onClose={() => {}} />); await upload(sync(report));
    if (kind === 'dependency') await user.click(screen.getByRole('button', { name: '提案 2 · 未决定' }));
    expect(screen.queryByRole('button', { name: /^归到/ })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: '另建概念' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '暂不决定' })); expect(summary()).toHaveTextContent('待定 1');
  });
  it.each(['no_proposals', 'invalid_response', 'provider_failure'])('区分 %s 状态', async state => {
    const report = fixture(); const row = report.rows[0]; row.proposals = []; row.responseState = state;
    if (state === 'no_proposals') { sync(report); row.explanation = { kind: 'model-explanation-unverified', text: '', nativeAbstain: false, nextAction: 'inspect-or-clarify' }; }
    else row.providerResult = { kind: 'provider-result', status: state === 'provider_failure' ? 'invocation-failed' : 'invalid-json', ...(state === 'provider_failure' ? {} : { rawText: '{' }) };
    render(<LocalReportReview onClose={() => {}} />); await upload(report);
    expect(summary()).toHaveTextContent('0 条提案'); expect(screen.queryByRole('button', { name: '暂不决定' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent(state === 'no_proposals' ? '完整响应：无提案' : state === 'invalid_response' ? '响应无效或不完整' : '模型调用失败');
  });
  it('输入声明小但正文超限仍由纯解析拒绝，多个候选不默认归属', async () => {
    render(<LocalReportReview onClose={() => {}} />);
    const tooLarge = { size: 1, text: async () => ' '.repeat(REVIEW_LIMITS.bytes + 1) };
    fireEvent.change(screen.getByLabelText('选择离线审阅报告文件'), { target: { files: [tooLarge] } }); await screen.findByRole('alert');
    const report = fixture(); report.rows[0].candidateConcepts.push({ id: 'C2', name: '另一个合成候选', sense: '不同语境' });
    await upload(report); expect(screen.getAllByRole('button', { name: /^归到/ })).toHaveLength(2); expect(summary()).toHaveTextContent('未决定 1');
  });
  it('关闭审阅保留原图 DOM、选中项；重开清空', async () => {
    const user = userEvent.setup(); render(<ConceptGraphView />);
    const file = new File(['{}'], 'synthetic-graph.json'); Object.defineProperty(file, 'text', { value: async () => JSON.stringify(REUSED_ITEM_RESULT) });
    fireEvent.change(screen.getByLabelText('选择实验结果文件'), { target: { files: [file] } }); await screen.findByRole('button', { name: '回到示例' });
    await user.click(screen.getByRole('button', { name: /^梯度，/ }));
    const graph = screen.getByRole('group', { name: '概念图' }).innerHTML; const detail = screen.getByRole('region', { name: '详情' }).textContent;
    const launch = screen.getByRole('button', { name: '离线报告审阅（实验）' }); await user.click(launch); await upload(); await user.click(assign());
    await user.keyboard('{Escape}'); await user.click(screen.getByRole('button', { name: '关闭并清空选择' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByRole('group', { name: '概念图' }).innerHTML).toBe(graph);
    expect(screen.getByRole('region', { name: '详情' }).textContent).toBe(detail);
    await user.click(launch); expect(summary()).toHaveTextContent('尚未导入报告');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭审阅' }));
  });
});
