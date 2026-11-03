import { MathText } from '../../components/math/MathText';
import { useEffect, useMemo, useState } from 'react';
import type { Annotation, KnowledgeEvidence, Note } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogFooter, Select } from '../../components/ui';
import { knowledgeError } from './knowledgeViewModel';
import styles from './KnowledgeWorkspaceView.module.css';

export function KnowledgeSourceDialog({ notes, evidence, replacing, onClose, onListAnnotations, onSave }: {
  notes: Note[];
  evidence: KnowledgeEvidence[];
  replacing?: KnowledgeEvidence | null;
  onClose(): void;
  onListAnnotations(noteId: string): Promise<Annotation[]>;
  onSave(annotation: Annotation, replacing?: KnowledgeEvidence | null): Promise<void>;
}) {
  const availableNotes = useMemo(() => notes.filter(note => !note.deleted), [notes]);
  const [noteId, setNoteId] = useState(replacing?.noteId ?? availableNotes[0]?.id ?? '');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationId, setAnnotationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setAnnotationId('');
    setAnnotations([]);
    if (!noteId) return;
    setLoading(true); setError('');
    void onListAnnotations(noteId).then(result => {
      if (!active) return;
      setAnnotations(result.filter(annotation => {
        const archived = annotation.lifecycleStatus === 'archived' || annotation.status === 'archived' || Boolean(annotation.deletedAt);
        const unresolved = annotation.anchorStatus ? annotation.anchorStatus !== 'resolved' : annotation.status === 'stale';
        const alreadyLinked = evidence.some(record => record.status !== 'invalid' && record.annotationId === annotation.id && record.id !== replacing?.id);
        return !archived && !unresolved && !alreadyLinked;
      }));
    }).catch(cause => { if (active) setError(knowledgeError(cause, '来源标注加载失败。')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [noteId, onListAnnotations, evidence, replacing?.id]);

  const selected = annotations.find(annotation => annotation.id === annotationId);
  async function submit() {
    if (!selected || pending) return;
    setPending(true); setError('');
    try { await onSave(selected, replacing); onClose(); }
    catch (cause) { setError(knowledgeError(cause, '知识来源保存失败。')); setPending(false); }
  }

  return <Dialog title={replacing ? '更换知识来源' : '添加知识来源'} description={replacing ? '新来源保存成功后，旧来源会标记为已移除并继续保留在历史中。' : '从笔记中的有效重点标记关联来源，保存时会记录原文快照。'} isOpen isPending={pending} onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogBody>
      {availableNotes.length ? <Select label="来源笔记" selectedKey={noteId} isDisabled={pending} options={availableNotes.map(note => ({ id: note.id, label: note.title || '无标题笔记' }))} onSelectionChange={key => setNoteId(String(key))} /> : <p className={styles.hint}>还没有可用笔记，请先新建笔记并标记重点。</p>}
      {loading ? <p className={styles.hint} role="status">正在加载重点标记…</p> : null}
      {!loading && noteId && annotations.length === 0 ? <p className={styles.notice}>这篇笔记没有可关联的有效重点。请先打开笔记标记重点，或检查已失效的标注。</p> : null}
      {annotations.length ? <fieldset className={styles.sourceOptions}><legend>选择重点标记</legend>{annotations.map(annotation => <label key={annotation.id}>
        <input type="radio" name="knowledge-source" value={annotation.id} checked={annotationId === annotation.id} disabled={pending} onChange={() => setAnnotationId(annotation.id)} />
        <span><strong>{annotation.headingPath.at(-1) || '正文摘录'}</strong><small><MathText text={annotation.quoteText} inlineOnly /></small></span>
      </label>)}</fieldset> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </DialogBody>
    <DialogFooter><Button variant="ghost" isDisabled={pending} onPress={onClose}>取消</Button><Button variant="primary" isPending={pending} isDisabled={!selected} onPress={() => void submit()}>{replacing ? '确认更换' : '添加来源'}</Button></DialogFooter>
  </Dialog>;
}
