import { useEffect, useState } from 'react';
import type { Attachment, AttachmentDeleteResult, AttachmentDeletionPreflight } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogClose, DialogFooter } from '../../components/ui';
import styles from './EditorInspector.module.css';

export function AttachmentDeleteDialog({ target, canWrite, inspect, onDelete, onClose, onOpenNote, onOpenKnowledgeItem }: {
  target: Attachment;
  canWrite: boolean;
  inspect?: (id: string) => Promise<AttachmentDeletionPreflight>;
  onDelete(id: string): Promise<AttachmentDeleteResult | void>;
  onClose(): void;
  onOpenNote?(id: string): void;
  onOpenKnowledgeItem?(id: string): void;
}) {
  const [report, setReport] = useState<AttachmentDeletionPreflight | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setReport(null);
    const request = inspect ? inspect(target.id) : Promise.reject(new Error('附件引用检查暂不可用，已阻止删除'));
    void request.then(value => {
      if (!value || value.asset?.id !== target.id || !Array.isArray(value.references) || !value.coverage?.persistedCurrentAndHistory) throw new Error('附件引用检查结果无效');
      if (active) { setReport(value); setError(''); }
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '附件引用检查失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [target.id, inspect, revision]);
  return <Dialog title="删除附件？" description={`检查“${target.fileName}”的保留引用。`} isOpen isPending={pending} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogBody>
      {loading ? <p role="status">正在检查删除依赖…</p> : null}
      {report ? <>
        {report.references.length ? <>
          <p>保留的资产仍引用此附件，暂时不能删除。</p>
          <ul>{report.references.map(reference => <li key={`${reference.collection}:${reference.id}`}>
            <span>{reference.retention === 'recycle-bin' ? '回收站' : reference.category === 'history' ? '历史记录' : reference.collection === 'notes' ? '笔记' : '业务来源'}：{reference.title ?? reference.id}</span>
            {onOpenNote && reference.collection === 'notes' && !reference.retention ? <Button variant="ghost" onPress={() => { onClose(); onOpenNote(reference.id); }}>查看笔记</Button> : null}
            {onOpenKnowledgeItem && reference.knowledgeItemId ? <Button variant="ghost" onPress={() => { onClose(); onOpenKnowledgeItem(reference.knowledgeItemId!); }}>查看知识</Button> : null}
            {reference.category === 'history' ? <small>此历史记录仍需保留原附件。</small> : null}
          </li>)}</ul>
        </> : <p>当前持久化资产和历史记录中未发现保留引用，可删除附件记录。</p>}
        <p>移除正文引用后，保留版本仍可能阻止删除。</p>
        <p>其他设备、备份与运行任务尚未纳入全端清除确认；桌面本机副本按现有规则保留。</p>
      </> : null}
      {error ? <p role="alert" className={styles.versionError}>{error}</p> : null}
      {operationError ? <p role="alert" className={styles.versionError}>{operationError}</p> : null}
    </DialogBody>
    <DialogFooter>
      <DialogClose variant="ghost">取消</DialogClose>
      <Button onPress={() => setRevision(value => value + 1)} isDisabled={loading || pending}>重新检查</Button>
      <Button variant="danger" isPending={pending} isDisabled={!canWrite || loading || !report || report.decision !== 'can-purge-no-history' || report.references.length > 0} onPress={() => {
        setPending(true); setOperationError('');
        void onDelete(target.id).then(onClose).catch(reason => { setOperationError(reason instanceof Error ? reason.message : '附件删除失败'); setRevision(value => value + 1); })
          .finally(() => setPending(false));
      }}>删除附件</Button>
    </DialogFooter>
  </Dialog>;
}
