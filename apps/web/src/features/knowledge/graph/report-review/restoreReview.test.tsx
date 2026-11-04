import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createReviewDraft, decideReview, type ReviewEnvelope } from '@study-accelerator/shared/incremental-review';
import { LocalReportReview } from './LocalReportReview';
import * as downloads from './downloadReview';

const fixture = (): ReviewEnvelope => JSON.parse(readFileSync('../../packages/shared/test/fixtures/incremental-review.json', 'utf8'));
const summary = () => screen.getByLabelText('报告审阅统计');
function select(value: unknown) {
  const text = JSON.stringify(value);
  const file = new File([text], 'synthetic.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text });
  fireEvent.change(screen.getByLabelText('选择离线审阅报告文件'), { target: { files: [file] } });
}
function draft(kind: 'existing' | 'defer' = 'existing') {
  const report = fixture();
  return createReviewDraft(report, decideReview(report, {}, report.rows[0].proposals[0].proposalId,
    kind === 'existing' ? { kind, conceptId: 'C1' } : { kind }));
}
async function download(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '下载未授权草稿' }));
  await user.click(screen.getByRole('button', { name: '确认下载（含原文）' }));
}

describe('恢复未授权审阅草稿', () => {
  it('恢复选择、再次导出等价，撤销后导出完整未决定，关闭重开清空', async () => {
    const user = userEvent.setup(); const save = vi.spyOn(downloads, 'downloadReview').mockImplementation(() => {});
    const close = vi.fn(); const view = render(<LocalReportReview onClose={close} />);
    const saved = draft(); select(saved);
    await waitFor(() => expect(summary()).toHaveTextContent('已选择 1'));
    expect(screen.getByRole('dialog')).toHaveTextContent('恢复不会授予执行授权');
    const request = vi.spyOn(globalThis, 'fetch'); const write = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    await download(user); expect(JSON.parse(save.mock.calls[0][0])).toEqual(saved);
    await user.click(screen.getByRole('button', { name: '撤销本条选择' }));
    await download(user);
    expect(JSON.parse(save.mock.calls[1][0])).toEqual(createReviewDraft(saved.report, {}));
    expect(request).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '关闭审阅' })); expect(close).toHaveBeenCalledOnce();
    view.unmount(); render(<LocalReportReview onClose={() => {}} />); expect(summary()).toHaveTextContent('尚未导入报告');
  });
  it('替换取消/非法保留旧决定，同文件再次导入可确认恢复，原报告仍清空', async () => {
    const user = userEvent.setup(); render(<LocalReportReview onClose={() => {}} />);
    select(draft()); await waitFor(() => expect(summary()).toHaveTextContent('已选择 1'));
    select(draft('defer')); await user.click(await screen.findByRole('button', { name: /^取消$/ }));
    expect(summary()).toHaveTextContent('已选择 1');
    const broken = draft('defer'); broken.counts.selected = 1; select(broken);
    await screen.findByRole('alert'); expect(summary()).toHaveTextContent('已选择 1');
    select(draft('defer')); await user.click(await screen.findByRole('button', { name: '确认替换' }));
    expect(summary()).toHaveTextContent('待定 1');
    select(fixture()); await user.click(await screen.findByRole('button', { name: '确认替换' }));
    expect(summary()).toHaveTextContent('未决定 1');
  });
  it('读取期间新增的决定仍须确认，取消后保留最新会话', async () => {
    const user = userEvent.setup(); render(<LocalReportReview onClose={() => {}} />);
    select(fixture()); await screen.findByRole('region', { name: '报告笔记原文' });
    let finish!: (text: string) => void;
    fireEvent.change(screen.getByLabelText('选择离线审阅报告文件'), { target: { files: [{ size: 1,
      text: () => new Promise<string>(resolve => { finish = resolve; }) }] } });
    await user.click(screen.getByRole('button', { name: '归到 合成概念（C1）' }));
    await act(async () => { finish(JSON.stringify(draft('defer'))); });
    await screen.findByRole('button', { name: '确认替换' });
    await user.click(screen.getByRole('button', { name: /^取消$/ }));
    expect(summary()).toHaveTextContent('已选择 1');
  });
  it('慢草稿 A 不能覆盖 B；取消确认、取消读取、关闭和卸载阻止迟到安装', async () => {
    const user = userEvent.setup(); const close = vi.fn(); const view = render(<LocalReportReview onClose={close} />);
    let finish!: (text: string) => void;
    const slow = () => fireEvent.change(screen.getByLabelText('选择离线审阅报告文件'), { target: { files: [{ size: 1,
      text: () => new Promise<string>(resolve => { finish = resolve; }) }] } });
    slow(); select(draft('defer')); await waitFor(() => expect(summary()).toHaveTextContent('待定 1'));
    await act(async () => { finish(JSON.stringify(draft())); }); expect(summary()).toHaveTextContent('待定 1');
    slow(); await user.click(screen.getByRole('button', { name: '取消读取' }));
    await act(async () => { finish(JSON.stringify(draft())); }); expect(summary()).toHaveTextContent('待定 1');
    slow(); await user.click(screen.getByRole('button', { name: '关闭审阅' }));
    await user.click(screen.getByRole('button', { name: /^取消$/ }));
    await act(async () => { finish(JSON.stringify(draft())); }); expect(summary()).toHaveTextContent('待定 1');
    expect(screen.queryByRole('button', { name: '确认替换' })).not.toBeInTheDocument();
    slow(); view.unmount(); await act(async () => { finish(JSON.stringify(draft())); }); expect(close).not.toHaveBeenCalled();
  });
});
