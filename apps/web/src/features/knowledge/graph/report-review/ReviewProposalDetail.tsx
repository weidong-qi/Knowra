import { useEffect, useRef, useState } from 'react';
import { holdReasons, REVIEW_LIMITS, type HoldReason, type ReviewDecision, type ReviewProposal, type ReviewRow } from '@study-accelerator/shared/incremental-review';
import { Button, TextField, TextAreaField } from '../../../../components/ui';
import styles from './ReportReview.module.css';

const HOLD_LABELS: Record<HoldReason, string> = {
  'validation-rejected': '提案结构无效', 'reported-risk': '模型报告风险',
  'risk-dependency': '依赖带风险的提案', 'item-reuse-not-supported': '复用旧条目尚不支持确认'
};
export const decisionLabel = (decision?: ReviewDecision) => !decision ? '未决定' : decision.kind === 'defer' ? '待定' : '已选择（未授权）';

export function ReviewProposalDetail({ row, proposal, decision, onDecide, onUndo }: {
  row: ReviewRow; proposal: ReviewProposal; decision?: ReviewDecision;
  onDecide(value: ReviewDecision): void; onUndo(): void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(''); const [sense, setSense] = useState('');
  const status = useRef<HTMLParagraphElement>(null);
  const initial = useRef(true);
  useEffect(() => { if (initial.current) { initial.current = false; return; } status.current?.focus(); }, [decision]);
  const holds = holdReasons(proposal);
  const original = proposal.validationAccepted ? proposal.original : null;
  const validNew = Boolean(name.trim() && sense.trim() && name.trim().length <= REVIEW_LIMITS.name && sense.trim().length <= REVIEW_LIMITS.sense);
  const commit = (value: ReviewDecision) => { onDecide(value); setCreating(false); };
  return <div className={styles.content}>
    <div className={styles.comparison}>
      <section className={styles.card} aria-label="模型提案">
        <h3>模型提案（未经事实核实）</h3>
        {original ? <>
          <h4>{original.item.title}</h4><p>{original.item.statement}</p>
          <p>条目操作：{original.itemAction === 'new' ? '新增条目' : '复用旧条目'}{original.existingItemId ? ` · ${original.existingItemId}` : ''}</p>
          <p>模型建议：{original.conceptAction === 'reuse' ? `归入 ${original.conceptId}` : `新建 ${original.newConcept?.name}`}</p>
          {original.newConcept ? <p>{original.newConcept.sense}</p> : null}
          {original.possibleDuplicateOf ? <p>疑似重复概念：{original.possibleDuplicateOf}</p> : null}
          <strong>引用原文</strong><blockquote className={styles.quote}>{original.item.quote}</blockquote>
          {original.sourceIssue ? <p>模型风险意见（非原文）：{original.sourceIssue}</p> : null}
        </> : <><p>无效提案：仅可待定。</p><ul>{proposal.validationErrors.map((error, i) => <li key={i}>{error}</li>)}</ul>
          <pre className={styles.raw}>{JSON.stringify(proposal.original, null, 2)}</pre></>}
        <p>{holds.length ? holds.map(reason => HOLD_LABELS[reason]).join('；') : '未报告风险不代表事实可靠。'}</p>
        {proposal.heldByProposalIndices.length ? <p>依赖原始提案索引：{proposal.heldByProposalIndices.join('、')}（从 0 起）</p> : null}
      </section>
      <section className={styles.card} aria-label="候选概念与旧条目">
        <h3>候选概念与旧条目</h3>
        <p className={styles.hint}>候选来自文件，不认证来源；不自动选中任何候选。旧内容不会改动。</p>
        {row.candidateConcepts.length ? row.candidateConcepts.map(concept => <section key={concept.id} aria-label={`候选 ${concept.name}`}>
          <h4>{concept.name} · {concept.id}</h4><p>{concept.sense}</p>
          {row.candidateItems.filter(item => item.conceptId === concept.id).map(item => <div key={item.id}><strong>{item.title} · {item.id}</strong><p>{item.statement}</p></div>)}
          {!holds.length && !decision && !creating ? <Button size="compact" className={styles.bounded} aria-label={`归到 ${concept.name}（${concept.id}）`} onPress={() => commit({ kind: 'existing', conceptId: concept.id })}><span className={styles.buttonText}>归入此概念</span></Button> : null}
        </section>) : <p>没有候选概念。可另建或待定，不自动归属。</p>}
      </section>
    </div>
    <p ref={status} tabIndex={-1} className={styles.result} role="status">{decisionLabel(decision)}{decision?.kind === 'existing' ? ` · ${decision.conceptId}` : decision?.kind === 'new' ? ` · 另建 ${decision.name}` : ''}。仅本页内存，未提交知识库。</p>
    {decision ? <Button variant="ghost" onPress={onUndo}>撤销本条选择</Button> : creating ? <section className={styles.form} aria-label="报告新概念表单">
      <TextField label="新概念名称" value={name} maxLength={REVIEW_LIMITS.name} onChange={setName} autoFocus />
      <TextAreaField label="语境说明" value={sense} maxLength={REVIEW_LIMITS.sense} onChange={setSense} rows={3} />
      <div className={styles.actions}><Button variant="primary" isDisabled={!validNew} onPress={() => commit({ kind: 'new', name, sense })}>确认另建（仅草稿）</Button>
        <Button variant="ghost" onPress={() => { setCreating(false); status.current?.focus(); }}>取消另建</Button></div>
    </section> : <div className={styles.actions}>
      {!holds.length ? <Button onPress={() => { setName(''); setSense(''); setCreating(true); }}>另建概念</Button> : null}
      <Button variant="ghost" onPress={() => commit({ kind: 'defer' })}>暂不决定</Button>
    </div>}
  </div>;
}
