import assert from 'node:assert/strict';
import { analyzeProposal, proposalProgress } from '../src/modules/ai/proposal-progress.ts';
import { proposalProgress as workerProposalProgress } from '../src/modules/ai/agent-worker.ts';

const ref = (noteId, start, end) => ({ noteId, start, end });
const first = { annotationId: 'a', importance: 'core', start: 0, end: 4 };
const second = { annotationId: 'b', importance: 'important', start: 5, end: 9 };
const refs = [ref('n', 0, 4), ref('n', 5, 9)];
const listed = (annotations = [first, second], total = 2) => ({
  toolName: 'annotations_list',
  status: 'succeeded',
  resultJson: { noteId: 'n', title: '私密标题', total, offset: 0, annotations },
  sourceRefs: refs
});
const saved = (citedRanges = [refs[0]]) => ({
  toolName: 'knowledge_propose',
  status: 'succeeded',
  resultJson: { saved: true, candidates: [{}], citedRanges },
  sourceRefs: []
});
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const aiProposalProgressTests = [
  {
    name: '提炼进度：旧 worker 文本入口保留同一实现，空输入和失败工具不要求提交',
    run() {
      assert.equal(workerProposalProgress, proposalProgress);
      assert.deepEqual(analyzeProposal([]), { text: '', needPropose: false });
      assert.deepEqual(analyzeProposal([{ ...listed(), status: 'failed' }], refs), { text: '', needPropose: false });
    }
  },
  {
    name: '提炼进度：当前窗口的待提交重点决定 needPropose，部分保存不代表全部处理',
    run() {
      assert.equal(analyzeProposal([listed()], refs).needPropose, true);
      const partial = analyzeProposal([listed(), saved()], refs);
      assert.equal(partial.needPropose, true);
      assert(partial.text.includes('其中 1 处已提交；1 处待提交'));
      const finished = analyzeProposal([listed(), saved(refs)], refs);
      assert.equal(finished.needPropose, false);
      assert(finished.text.includes('重点已全部处理，请用一两句话告知用户。'));
      assert.equal(analyzeProposal([listed(), saved([ref('n', 0, 100)])], refs).needPropose, true);
    }
  },
  {
    name: '提炼进度：窗口淘汰、重新读取与未读分页均不误报可提交',
    run() {
      assert.deepEqual(analyzeProposal([listed()], [ref('other', 0, 4)]), { text: '', needPropose: false });
      const dropped = analyzeProposal([listed(), saved([refs[1]])], [refs[1]], 1);
      assert.equal(dropped.needPropose, false);
      assert(dropped.text.includes('offset=0 起用 limit=1 重新读取'));
      assert(dropped.text.includes('重新读取被移出 sources 的重点'));
      const nextPage = analyzeProposal([listed([first], 2), saved()], [refs[0]]);
      assert.equal(nextPage.needPropose, false);
      assert(nextPage.text.includes('offset=1 继续翻页'));
      assert(nextPage.text.includes('先别重复读取已读的页'));
    }
  },
  {
    name: '提炼进度：无重点提示严格保留文本且不泄露窗口外笔记信息',
    run() {
      assert.deepEqual(analyzeProposal([listed([], 0)], refs), {
        text: '\n已完成：annotations_list 显示一篇笔记没有可用重点，可读取正文后提炼。这些步骤不要重复；信息已足够时现在调用 knowledge_propose 提交候选。',
        needPropose: false
      });
      assert.deepEqual(analyzeProposal([listed([], 0)], []), { text: '', needPropose: false });
      assert(!analyzeProposal([listed()], refs).text.includes('私密标题'));
    }
  },
  {
    name: '提炼进度：冻结的工具记录和来源可重复计算，输出不反写输入',
    run() {
      const calls = freeze([listed(), saved()]);
      const sourceRefs = freeze(structuredClone(refs));
      const before = structuredClone({ calls, sourceRefs });
      const result = analyzeProposal(calls, sourceRefs, 2);
      assert.equal(proposalProgress(calls, sourceRefs, 2), result.text);
      assert.deepEqual(analyzeProposal(calls, sourceRefs, 2), result);
      result.text = '调用方本地修改';
      result.needPropose = false;
      assert.equal(analyzeProposal(calls, sourceRefs, 2).needPropose, true);
      assert.deepEqual({ calls, sourceRefs }, before);
    }
  }
];
