import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, DialogBody, DialogFooter, TextField, TextAreaField } from '../../../components/ui';
import { decide, undoDecision, projectSession, DEMO_NAME_LIMIT, DEMO_SENSE_LIMIT, type DemoDecision, type DemoSession } from './incrementalConfirmation';
import { INCREMENTAL_CONFIRMATION_FIXTURE as fixture } from './incrementalConfirmation.fixture';
import styles from './IncrementalConfirmationDemo.module.css';

const statusLabel = (decision?: DemoDecision) => !decision ? '未决定' : decision.kind === 'defer' ? '待定' : '已选择';

/** 合成内存演示：关闭即卸载，不接触外层导入图、应用 store 或持久化。 */
export function IncrementalConfirmationDemo({ onClose }: { onClose(): void }) {
  const [selected, setSelected] = useState(fixture.proposals[0].id);
  const [session, setSession] = useState<DemoSession>({});
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [sense, setSense] = useState('');
  const proposal = fixture.proposals.find(row => row.id === selected)!;
  const candidate = fixture.concepts.find(row => row.id === proposal.candidateId)!;
  const oldItems = fixture.items.filter(row => row.conceptIds.includes(candidate.id));
  const decision = session[selected];
  const resultRef = useRef<HTMLParagraphElement>(null);
  const initialFocus = useRef(true);
  useEffect(() => {
    if (initialFocus.current) { initialFocus.current = false; return; }
    // 提交/撤销会移除当前按钮，把焦点留在弹窗内，避免 Esc 或 Tab 落到原图。
    resultRef.current?.focus();
  }, [decision]);
  const projection = useMemo(() => projectSession(fixture, session), [session]);
  const validNew = Boolean(name.trim() && sense.trim() && name.trim().length <= DEMO_NAME_LIMIT && sense.trim().length <= DEMO_SENSE_LIMIT);
  function choose(id: string) { setSelected(id); setCreating(false); setName(''); setSense(''); }
  function commit(value: DemoDecision) { setSession(current => decide(fixture, current, selected, value)); setCreating(false); }
  const result = !decision ? '尚未选择，原有概念和条目保持不变。'
    : decision.kind === 'defer' ? '已暂缓：没有新增概念或条目挂靠。'
      : decision.kind === 'existing' ? `本次演示：新增条目归入“${candidate.name}”，旧条目未改动。`
        : `本次演示：另建“${decision.name}”并挂入新增条目，旧条目未改动。`;

  return <Dialog title="增量确认演示（实验）" isOpen size="md" onOpenChange={open => { if (!open) onClose(); }}
    description="仅使用合成内容。只在本页内存中模拟，不写入知识库；关闭或刷新即清空。">
    <DialogBody><div className={styles.content}>
      <p className={styles.notice}>这里只验证操作闭环，不代表 AI 判断效果。选择归属也不代表事实已核实或已经掌握。原图及已导入结果不受影响。</p>
      <nav className={styles.choices} aria-label="合成案例">
        {fixture.proposals.map((row, index) => <Button key={row.id} size="compact" variant={row.id === selected ? 'primary' : 'ghost'}
          aria-current={row.id === selected ? 'step' : undefined} onPress={() => choose(row.id)}>{index + 1}. {row.title} · {statusLabel(session[row.id])}</Button>)}
      </nav>
      <div className={styles.comparison}>
        <section className={styles.card} aria-label="新增条目与原文">
          <h3>新增条目</h3><h4>{proposal.title}</h4><p>{proposal.statement}</p>
          <strong>原文 · {proposal.source.note}</strong><blockquote className={styles.quote}>{proposal.source.quote}</blockquote>
          {proposal.opinion ? <section aria-label="演示意见"><strong>演示意见（非原文）</strong><p className={styles.hint}>{proposal.opinion}</p></section> : null}
        </section>
        <section className={styles.card} aria-label="已有概念与内容">
          <h3>已有概念候选</h3><h4>{candidate.name}</h4><p>{candidate.sense}</p>
          <strong>已有内容（保持原样）</strong>
          {oldItems.map(item => <div key={item.id}><h4>{item.title}</h4><p>{item.statement}</p></div>)}
        </section>
      </div>
      <p ref={resultRef} tabIndex={-1} className={styles.result} role="status">{result}</p>
      {decision ? <Button variant="ghost" onPress={() => setSession(current => undoDecision(current, selected))}>撤销本条选择</Button>
        : creating ? <section className={styles.form} aria-label="另建概念表单">
          <TextField label="新概念名称" value={name} maxLength={DEMO_NAME_LIMIT} onChange={setName} autoFocus />
          <TextAreaField label="语境说明" value={sense} maxLength={DEMO_SENSE_LIMIT} onChange={setSense} rows={3} />
          <p className={styles.hint}>名称与语境说明都必填。只新增演示概念，不改旧结构。</p>
          <div className={styles.actions}><Button variant="primary" isDisabled={!validNew} onPress={() => commit({ kind: 'new', name, sense })}>确认另建（仅演示）</Button>
            <Button variant="ghost" onPress={() => { setCreating(false); resultRef.current?.focus(); }}>取消另建</Button></div>
        </section> : <div className={styles.actions} role="group" aria-label="选择归属">
          <Button variant="primary" onPress={() => commit({ kind: 'existing', conceptId: candidate.id })}>归到这里</Button>
          <Button onPress={() => { setName(proposal.suggestedName); setSense(proposal.suggestedSense); setCreating(true); }}>另建</Button>
          <Button variant="ghost" onPress={() => commit({ kind: 'defer' })}>暂不决定</Button>
        </div>}
      <p className={styles.hint} aria-label="本次演示统计">本次模拟新增 {projection.concepts.length} 个概念、{projection.items.length} 条条目；
        待定 {Object.values(session).filter(value => value.kind === 'defer').length} 条。旧内容未修改。</p>
    </div></DialogBody>
    <DialogFooter><Button variant="ghost" onPress={onClose}>关闭并清空演示</Button></DialogFooter>
  </Dialog>;
}
