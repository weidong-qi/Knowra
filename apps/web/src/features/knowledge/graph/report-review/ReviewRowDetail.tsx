import { useState } from 'react';
import type { ReviewDecision, ReviewRow, ReviewSession } from '@study-accelerator/shared/incremental-review';
import { Button } from '../../../../components/ui';
import { decisionLabel, ReviewProposalDetail } from './ReviewProposalDetail';
import styles from './ReportReview.module.css';
export const responseLabels: Record<ReviewRow['responseState'], string> = {
  proposals: '有模型提案', no_proposals: '完整响应：无提案', invalid_response: '响应无效或不完整', provider_failure: '模型调用失败'
};
export function ReviewRowDetail({ row, session, onDecide, onUndo }: {
  row: ReviewRow; session: ReviewSession; onDecide(id: string, value: ReviewDecision): void; onUndo(id: string): void;
}) {
  const [index, setIndex] = useState(0);
  const proposal = row.proposals[index];
  return <div className={styles.content}>
    <section className={styles.card} aria-label="报告笔记原文"><h3>原文 · {row.note.id}</h3><p className={styles.source}>{row.note.markdown}</p></section>
    <p>{responseLabels[row.responseState]} · {row.arm === 'retrieval' ? '检索组' : '对照组'} · {row.requestId}</p>
    {row.explanation ? <p className={styles.notice}>模型解释（未核实，不是原生弃权）：{row.explanation.text}。请检查原文或补充语境。</p> : null}
    <nav className={styles.navigation} aria-label="本行提案">{row.proposals.map((item, i) => <Button key={item.proposalId} size="compact"
      variant={i === index ? 'primary' : 'ghost'} aria-current={i === index ? 'step' : undefined} onPress={() => setIndex(i)}>
      提案 {i + 1} · {decisionLabel(session[item.proposalId])}</Button>)}</nav>
    {proposal ? <ReviewProposalDetail key={proposal.proposalId} row={row} proposal={proposal} decision={session[proposal.proposalId]}
      onDecide={value => onDecide(proposal.proposalId, value)} onUndo={() => onUndo(proposal.proposalId)} /> : <p>本行没有可审阅的提案。无提案、响应损坏和调用失败不会混为“已确认”。</p>}
    <details className={styles.card}><summary>查看文件内模型原始响应</summary><pre className={styles.raw}>{JSON.stringify(row.providerResult, null, 2)}</pre></details>
  </div>;
}
