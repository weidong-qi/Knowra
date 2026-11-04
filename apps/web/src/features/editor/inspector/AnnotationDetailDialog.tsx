import { MathText } from '../../../components/math/MathText';
import { Button, Dialog, DialogBody, DialogFooter, DialogClose, Select, TextAreaField } from '../../../components/ui';
import type { useAnnotationDetails } from './useAnnotationDetails';
import type { EditorInspectorProps } from './types';
import { KIND_OPTIONS, IMPORTANCE_OPTIONS, scopeLabel } from './annotationOptions';
import styles from '../EditorInspector.module.css';

interface DetailProps {
  props: Pick<EditorInspectorProps, 'canWrite' | 'onConfirmAnnotationRange' | 'onOpenKnowledgeItem' | 'onDeleteAnnotationExclusion' | 'onUpdateAnnotation'>;
  details: ReturnType<typeof useAnnotationDetails>;
  pendingIds: ReadonlySet<string>;
  run(id: string, action: () => Promise<void>): Promise<void>;
}

export function AnnotationDetailDialog({ props, details, pendingIds, run }: DetailProps) {
  const { detail, setDetail, kind, setKind, importance, setImportance, setImportanceChanged, comment, setComment, saveMetadata } = details;
  async function restoreExclusion(exclusionId: string) {
    if (!detail || !props.canWrite || !props.onDeleteAnnotationExclusion) return;
    const restore = props.onDeleteAnnotationExclusion;
    await run(detail.annotation.id, async () => {
      try { await restore(detail.annotation.id, exclusionId, detail.annotation.revision ?? 1); }
      catch (reason) { throw reason instanceof Error ? reason : new Error('恢复范围失败'); }
      setDetail(null);
    });
  }
  return detail ? <Dialog title="重点详情" description={`${scopeLabel(detail.annotation.scopeType)} · ${detail.preview.resolution.status === 'resolved' ? '当前范围可定位' : '范围需要检查'}`} isOpen onOpenChange={(open) => { if (!open) setDetail(null); }} isPending={pendingIds.has(detail.annotation.id)}>
        <DialogBody><div className={styles.annotationDetailFields}>
          <Select label="类型" options={KIND_OPTIONS} selectedKey={kind} onSelectionChange={(key) => setKind(String(key) as typeof kind)} />
          <Select label="重要程度" options={IMPORTANCE_OPTIONS} selectedKey={importance} onSelectionChange={(key) => { setImportance(String(key)); setImportanceChanged(true); }} />
          <TextAreaField label="备注" maxLength={2000} value={comment} onChange={setComment} />
          {detail.annotation.scopeType === 'list' ? <p>本项及全部子项 · 子项 {detail.annotation.anchor?.list?.childCount ?? 0} 项</p> : null}
          <pre><MathText text={detail.preview.resolution.quoteText ?? detail.annotation.quoteText} inlineOnly /></pre>
          {detail.preview.pendingRange ? <>
            <p>原范围保留在上方。确认后将使用以下新范围：</p>
            <pre><MathText text={detail.preview.pendingRange.anchor.quoteText} inlineOnly /></pre>
            <Button isDisabled={!props.canWrite || !props.onConfirmAnnotationRange || pendingIds.has(detail.annotation.id)} onPress={() => void run(detail.annotation.id, async () => {
              if (!props.canWrite) return;
              await props.onConfirmAnnotationRange?.(detail.annotation.id, { expectedRevision: detail.annotation.revision ?? 1, noteContentHash: detail.preview.currentContentHash, candidateHash: detail.preview.pendingRange!.candidateHash });
              setDetail(null);
            })}>确认新范围</Button>
          </> : null}
          {detail.links.evidenceStatus.some(item => item.status !== 'valid') ? <p role="status">关联内容待检查：原文更新不会改写已有知识或历史依据。</p> : null}
          <p>关联候选 {detail.links.candidates.length} · 已确认知识 {detail.links.confirmed.length} · 局部排除 {detail.preview.exclusions.filter((item) => item.status === 'active').length}</p>
          {props.onOpenKnowledgeItem ? <div className={styles.noteLinks}>{[...detail.links.candidates, ...detail.links.confirmed].map(({ knowledgeItem }) => <button type="button" key={knowledgeItem.id} onClick={() => props.onOpenKnowledgeItem?.(knowledgeItem.id)}>{knowledgeItem.title}</button>)}</div> : null}
          {detail.preview.exclusions.filter((item) => item.status === 'active').map((exclusion) => <button key={exclusion.id} type="button" disabled={!props.canWrite || pendingIds.has(detail.annotation.id) || !props.onDeleteAnnotationExclusion} onClick={() => void restoreExclusion(exclusion.id)}>恢复排除范围：{exclusion.anchor.quoteText.slice(0, 32)}</button>)}
        </div></DialogBody>
        <DialogFooter><DialogClose variant="ghost">关闭</DialogClose><Button variant="primary" isDisabled={!props.canWrite || !props.onUpdateAnnotation || pendingIds.has(detail.annotation.id)} onPress={() => void saveMetadata()}>保存信息</Button></DialogFooter>
      </Dialog> : null;
}
