import { ExtractionDemoNotice } from '../editor/ExtractionEnvironment';
import { useRef, useState, type ReactNode } from 'react';
import type { KnowledgeItem } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogFooter } from '../../components/ui';
import { downloadTextFile } from '../../browser/downloadFile';
import { KnowledgeItemForm, useKnowledgeFormSafety, type KnowledgeFormValue } from './KnowledgeItemForm';
import { getKnowledgeDraftScope, knowledgeDraftRecovery, type KnowledgeDraft } from './knowledgeDraftRecovery';
import { knowledgeError } from './knowledgeViewModel';
import styles from './KnowledgeWorkspaceView.module.css';

export function KnowledgeItemDialog({ title, draft, recovered = false, canWrite, readOnlyReason, children, onClose, onSubmit, onSaved }: {
  title: string; draft: KnowledgeDraft; recovered?: boolean; canWrite: boolean; readOnlyReason?: string;
  children?: ReactNode; onClose(): void; onSubmit(value: KnowledgeFormValue, baseline: KnowledgeDraft): Promise<KnowledgeItem | void>;
  onSaved?(item: KnowledgeItem | void): void;
}) {
  const [baseline] = useState(draft);
  const [scope] = useState(getKnowledgeDraftScope);
  const [value, setValue] = useState(draft.value);
  const latest = useRef(draft);
  const savedResult = useRef<{ item: KnowledgeItem | void } | null>(null);
  const [committed, setCommitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = recovered || JSON.stringify(baseline.initialValue) !== JSON.stringify(value);
  const releaseSafety = useKnowledgeFormSafety(dirty || pending, async () => { knowledgeDraftRecovery.write(scope, latest.current); await knowledgeDraftRecovery.flush(); });
  function updateValue(next: KnowledgeFormValue) {
    setValue(next);
    latest.current = { ...baseline, value: next };
    knowledgeDraftRecovery.write(scope, latest.current);
    void knowledgeDraftRecovery.flush().catch(cause => setError(knowledgeError(cause, '恢复草稿写入失败，请保留当前窗口。')));
  }
  async function clearDraft() { knowledgeDraftRecovery.remove(scope, latest.current); await knowledgeDraftRecovery.flush(); }
  async function discard() {
    try { await clearDraft(); releaseSafety(); onClose(); }
    catch (cause) { setConfirmDiscard(false); setError(knowledgeError(cause)); }
  }
  function requestClose() { if (!pending) { if (committed) void submit(); else if (dirty) setConfirmDiscard(true); else void discard(); } }
  async function submit() {
    if (!canWrite || pending || !value.title.trim()) return;
    setPending(true); setError('');
    let item: KnowledgeItem | void;
    try {
      // 保存前先保留候选 id 与来源基线，丢响应后可安全重试同一候选。
      if (!savedResult.current) {
        knowledgeDraftRecovery.write(scope, latest.current);
        await knowledgeDraftRecovery.flush();
        item = await onSubmit({ ...value, title: value.title.trim(), canonicalStatement: value.canonicalStatement.trim(), userExplanation: value.userExplanation.trim() }, baseline);
        savedResult.current = { item };
        setCommitted(true);
      } else item = savedResult.current.item;
      await clearDraft();
    }
    catch (cause) {
      setError(savedResult.current ? '知识已保存，但恢复草稿清理失败。请重试清理；不会重复提交知识。' : knowledgeError(cause, '保存失败，输入已保留。'));
      setPending(false); return;
    }
    releaseSafety();
    onClose();
    onSaved?.(item);
  }
  return <>
    <Dialog title={title} size="md" isOpen isPending={pending} onOpenChange={open => { if (!open) requestClose(); }}>
      <DialogBody>
      <ExtractionDemoNotice />
        {!canWrite ? <p className={styles.notice}>{readOnlyReason ?? '当前为只读模式，暂不能修改知识。'}</p> : null}
        {recovered ? <p role="status" className={styles.notice}>已恢复未保存的知识草稿。原来源与编辑版本已保留，请核对后保存。</p> : null}
        {children}
        <KnowledgeItemForm value={value} disabled={!canWrite || pending || committed} onChange={updateValue} />
        <p className={styles.hint}>先保存为候选，核对核心陈述与来源后再确认。修改已确认的正文会转为待修订。</p>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        {error && !committed ? <p className={styles.hint}>若上次提交可能已成功，请先核对当前已保存内容。草稿保留原编辑版本以避免覆盖；也可导出后重新整理。</p> : null}
      </DialogBody>
      <DialogFooter><Button variant="ghost" isDisabled={pending} onPress={() => downloadTextFile(`${value.title || '未命名知识'}-恢复草稿.json`, JSON.stringify(latest.current, null, 2), 'application/json;charset=utf-8')}>导出草稿</Button><Button variant="ghost" isDisabled={pending} onPress={requestClose}>取消</Button><Button variant="primary" isPending={pending} isDisabled={!canWrite || !value.title.trim()} onPress={() => void submit()}>{committed ? '重试清理' : '保存'}</Button></DialogFooter>
    </Dialog>
    {confirmDiscard ? <Dialog title="放弃未保存的知识修改？" description="关闭后，本次输入的修改将丢失。" isOpen onOpenChange={open => { if (!open) setConfirmDiscard(false); }}>
      <DialogFooter><Button variant="primary" onPress={() => setConfirmDiscard(false)}>继续编辑</Button><Button variant="danger" onPress={() => void discard()}>放弃修改</Button></DialogFooter>
    </Dialog> : null}
  </>;
}
