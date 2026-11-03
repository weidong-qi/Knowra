import { useEffect, useState } from 'react';
import type { CommandNoteSearchHit, CommandNoteSearcher } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogFooter, SearchBox, TextField } from '../../components/ui';
import type { NoteLinkEditSession } from './editorNoteLinks';
import styles from './EditorNoteLinkDialog.module.css';

export function EditorNoteLinkDialog({ session, spaceId, search, folderPath, canWrite, onApply, onClose }: {
  session: NoteLinkEditSession; spaceId: string; search?: CommandNoteSearcher;
  folderPath(id: string | null): string; canWrite: boolean;
  onApply(targetId: string | null, label: string): Promise<void>; onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [label, setLabel] = useState(session.label);
  const [target, setTarget] = useState(session.targetNoteId ?? '');
  const [hits, setHits] = useState<CommandNoteSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!search) { setError('当前环境尚不支持笔记链接搜索'); return; }
    let active = true;
    setLoading(true); setHits([]);
    const timer = setTimeout(() => {
      void search({ query, spaceId }).then(rows => { if (active) { setHits(rows); setError(''); } })
        .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '搜索失败'); })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [query, search, spaceId]);
  async function apply(targetId: string | null) {
    if (pending || !canWrite) return;
    setPending(true); setError('');
    try { await onApply(targetId, label); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '插入失败'); }
    finally { setPending(false); }
  }
  return <Dialog title={session.targetNoteId ? '编辑笔记链接' : '插入笔记链接'} isOpen isPending={pending}
    onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogBody>
      <TextField label="显示文字" value={label} onChange={setLabel} isDisabled={pending || !canWrite} />
      <SearchBox label="搜索当前空间笔记" size="field" value={query} onChange={event => setQuery(event.target.value)} onClear={query ? () => setQuery('') : undefined} maxLength={200} disabled={pending} />
      <p role="status">{loading ? '正在搜索…' : hits.length ? '选择目标笔记；仅搜索当前空间' : '没有匹配笔记'}</p>
      <div className={styles.results} aria-label="目标笔记">
        {hits.map(hit => <Button key={hit.id} variant={target === hit.id ? 'primary' : 'ghost'}
          aria-label={`${hit.title} · ${folderPath(hit.folderId)}`}
          isDisabled={pending || !canWrite} onPress={() => setTarget(hit.id)}>
          <span>{hit.title}</span><small>{folderPath(hit.folderId)}</small>
        </Button>)}
      </div>
      {target ? <p>已选择：{hits.find(hit => hit.id === target)?.title ?? '原目标笔记'}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </DialogBody>
    <DialogFooter>
      {session.targetNoteId ? <Button variant="danger" isDisabled={pending || !canWrite} onPress={() => void apply(null)}>移除链接</Button> : null}
      <Button variant="ghost" isDisabled={pending} onPress={onClose}>取消</Button>
      <Button variant="primary" isDisabled={pending || !canWrite || !target || !label.trim()}
        onPress={() => void apply(target)}>确认</Button>
    </DialogFooter>
  </Dialog>;
}
