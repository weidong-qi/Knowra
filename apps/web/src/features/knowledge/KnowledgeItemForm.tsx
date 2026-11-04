import { useEffect, useRef } from 'react';
import type { KnowledgeItem, KnowledgeType } from '@study-accelerator/web-core';
import { registerDesktopSave } from '../../app/desktopLifecycle';
import { registerNavigationGuard } from '../../app/navigationGuard';
import { Select, TextAreaField, TextField } from '../../components/ui';
import { KNOWLEDGE_TYPE_OPTIONS } from './knowledgeViewModel';
import styles from './KnowledgeWorkspaceView.module.css';

export type KnowledgeFormValue = Pick<KnowledgeItem, 'title' | 'canonicalStatement' | 'userExplanation' | 'knowledgeType'>;

export function KnowledgeItemForm({ value, disabled, onChange }: {
  value: KnowledgeFormValue; disabled: boolean; onChange(value: KnowledgeFormValue): void;
}) {
  return <div className={styles.form}>
    <TextField label="标题" autoFocus value={value.title} isDisabled={disabled} onChange={title => onChange({ ...value, title })} />
    <Select label="知识类型" selectedKey={value.knowledgeType} isDisabled={disabled}
      options={[...KNOWLEDGE_TYPE_OPTIONS]} onSelectionChange={key => onChange({ ...value, knowledgeType: String(key) as KnowledgeType })} />
    <TextAreaField label="核心陈述" rows={5} value={value.canonicalStatement} isDisabled={disabled} onChange={canonicalStatement => onChange({ ...value, canonicalStatement })} placeholder="用一段可以独立理解的话说明这条知识" />
    <TextAreaField label="我的解释" rows={3} value={value.userExplanation} isDisabled={disabled} onChange={userExplanation => onChange({ ...value, userExplanation })} placeholder="可补充理解、例子或仍待核实的问题" />
  </div>;
}

/** 显式保存的知识表单不能被关闭窗口或桌面退出静默丢弃。 */
export function useKnowledgeFormSafety(dirty: boolean, persistRecovery?: () => Promise<void>, unsavedMessage = '知识表单仍有未保存的修改，请先保存或取消编辑，再退出。') {
  const release = useRef(() => {});
  const recovery = useRef(persistRecovery);
  recovery.current = persistRecovery;
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    const unregister = registerDesktopSave(async mode => {
      if (mode === 'recovery' && recovery.current) { await recovery.current(); return; }
      throw new Error(unsavedMessage);
    }, 0);
    const unregisterNavigation = registerNavigationGuard(() => false);
    const cleanup = () => { window.removeEventListener('beforeunload', beforeUnload); unregister(); unregisterNavigation(); };
    release.current = cleanup;
    return cleanup;
  }, [dirty, unsavedMessage]);
  return () => release.current();
}

export function knowledgeFormValue(item?: Partial<KnowledgeFormValue>): KnowledgeFormValue {
  return { title: item?.title ?? '', canonicalStatement: item?.canonicalStatement ?? '', userExplanation: item?.userExplanation ?? '', knowledgeType: item?.knowledgeType ?? 'concept' };
}
