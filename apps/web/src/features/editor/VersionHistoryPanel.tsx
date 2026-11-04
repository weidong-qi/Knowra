import { useEffect, useMemo, useRef, useState } from 'react';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import type { Note, NoteVersion, NoteVersionPage, NoteVersionPageOptions, NoteVersionPrunePreview, NoteVersionSummary } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogClose, DialogFooter, PressableButton } from '../../components/ui';
import { TextDiff } from '../../components/ui/TextDiff';
import { ClockIcon, NoteIcon } from '../../components/icons/knowra';
import { InspectorSection } from './inspector/InspectorSection';
import styles from './EditorInspector.module.css';

interface Props {
  note: Note;
  markdown: string;
  canWrite: boolean;
  onListVersions(noteId: string): Promise<NoteVersion[]>;
  onListVersionPage?(noteId: string, options?: NoteVersionPageOptions): Promise<NoteVersionPage>;
  onPreviewVersionPrune?(noteId: string): Promise<NoteVersionPrunePreview>;
  onGetVersion(noteId: string, versionId: string): Promise<NoteVersion>;
  onRestoreVersion?(version: NoteVersion): Promise<void>;
  onSaveVersionAs?(version: NoteVersion): Promise<void>;
}

function dateLabel(value: string) {
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** 列表行只显示到秒；跨年时补年份，完整时间放在 title。 */
function shortDateLabel(value: string) {
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString('zh-CN', { ...(sameYear ? {} : { year: 'numeric' }), month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** Group only the presentation. Every immutable source snapshot stays available. */
export function groupVersionSessions(versions: NoteVersionSummary[]) {
  const groups: NoteVersionSummary[][] = [];
  for (const version of versions) {
    const previous = groups.at(-1);
    if (previous && Date.parse(previous.at(-1)!.createdAt) - Date.parse(version.createdAt) <= 5 * 60_000) previous.push(version);
    else groups.push([version]);
  }
  return groups;
}

export function VersionHistoryPanel({ note, markdown, canWrite, onListVersions, onListVersionPage, onPreviewVersionPrune, onGetVersion, onRestoreVersion, onSaveVersionAs }: Props) {
  const [versions, setVersions] = useState<NoteVersionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<NoteVersion | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [compare, setCompare] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [prunePreview, setPrunePreview] = useState<NoteVersionPrunePreview | null>(null);
  const requestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const currentHash = useMemo(() => calculateContentHash(markdown), [markdown]);
  const groups = useMemo(() => groupVersionSessions(versions), [versions]);

  useEffect(() => {
    let active = true;
    ++requestRef.current;
    ++detailRequestRef.current;
    setDetailLoading(false);
    setListLoading(true);
    setError('');
    const request = onListVersionPage ? onListVersionPage(note.id, { limit: 20 }) : onListVersions(note.id).then((items) => ({ items, total: items.length, nextCursor: null }));
    void request.then((page) => {
      if (!active) return;
      setVersions(page.items);
      setTotal(page.total);
      setCursor(page.nextCursor);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : '历史记录加载失败');
    }).finally(() => { if (active) setListLoading(false); });
    return () => { active = false; ++requestRef.current; ++detailRequestRef.current; };
  }, [note.id, note.updatedAt, onListVersionPage, onListVersions]);

  async function loadMore() {
    if (!cursor || !onListVersionPage || listLoading) return;
    const requestId = requestRef.current;
    setListLoading(true);
    setError('');
    try {
      const page = await onListVersionPage(note.id, { limit: 20, cursor });
      if (requestId !== requestRef.current) return;
      setVersions((items) => [...items, ...page.items.filter((item) => !items.some((existing) => existing.id === item.id))]);
      setTotal(page.total);
      setCursor(page.nextCursor);
    } catch (reason) {
      if (requestId === requestRef.current) setError(reason instanceof Error ? reason.message : '历史记录加载失败');
    } finally { if (requestId === requestRef.current) setListLoading(false); }
  }

  async function select(version: NoteVersionSummary) {
    const requestId = ++detailRequestRef.current;
    setSelected(null);
    setDetailLoading(true);
    setError('');
    setMessage('');
    try {
      const detail = await onGetVersion(note.id, version.id);
      if (requestId === detailRequestRef.current) setSelected(detail);
    } catch (reason) {
      if (requestId === detailRequestRef.current) setError(reason instanceof Error ? reason.message : '版本正文加载失败');
    } finally { if (requestId === detailRequestRef.current) setDetailLoading(false); }
  }

  async function act(action: 'restore' | 'saveAs') {
    if (!selected || !canWrite || pending) return;
    const handler = action === 'restore' ? onRestoreVersion : onSaveVersionAs;
    if (!handler) return;
    setPending(true);
    setError('');
    try {
      await handler(selected);
      setRestoreOpen(false);
      setMessage(action === 'restore' ? '已恢复历史正文，原正文保留在历史记录中。' : '已另存为新笔记。');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '历史记录操作失败'); }
    finally { setPending(false); }
  }

  const row = (version: NoteVersionSummary) => <PressableButton key={version.id} type="button" aria-pressed={selected?.id === version.id} onPress={() => void select(version)}>
    <span data-current={version.contentHash === currentHash || undefined}>{version.contentHash === currentHash ? '当前正文' : '历史正文'}</span>
    <time dateTime={version.createdAt} title={dateLabel(version.createdAt)}>{shortDateLabel(version.createdAt)}</time>
  </PressableButton>;

  return <section className={styles.versionPanel} aria-label="历史记录">
    <InspectorSection icon={<ClockIcon size={18} />} title={`${total} 条历史记录`}
      action={onPreviewVersionPrune ? <Button size="mini" onPress={() => void onPreviewVersionPrune(note.id).then(setPrunePreview).catch(reason => setError(reason instanceof Error ? reason.message : '清理预览失败'))}>清理预览</Button> : undefined}>
      <p className={styles.versionHint}>相邻修改间隔 5 分钟内归组，可展开全部快照。来源快照持续保留。</p>
      {markdown !== note.rawMarkdown ? <p className={styles.versionNotice} role="status">当前草稿尚未保存；差异对比包含这部分修改。</p> : null}
      {error && !restoreOpen ? <p className={styles.versionError} role="alert">{error}</p> : null}
      {message ? <p className={styles.versionNotice} role="status">{message}</p> : null}
      {listLoading ? <p className={styles.versionHint} role="status">正在加载历史记录…</p> : null}
      {!listLoading && versions.length === 0 && !error ? <p className={styles.emptyPanel}>暂无历史记录。</p> : null}
      {versions.length ? <div className={styles.versionList} aria-label="版本列表">
        {groups.map((group) => <div key={group[0].id} className={styles.versionGroup}>
          {row(group[0])}
          {group.length > 1 ? <details><summary>展开本组其余 {group.length - 1} 条快照</summary>{group.slice(1).map(row)}</details> : null}
        </div>)}
      </div> : null}
      {cursor ? <Button variant="ghost" size="mini" className={styles.versionMore} isPending={listLoading} onPress={() => void loadMore()}>加载更早记录</Button> : null}
    </InspectorSection>
    {detailLoading ? <p className={styles.panelStatus} role="status">正在加载版本正文…</p> : null}
    {!selected && !detailLoading && versions.length ? <p className={styles.versionPlaceholder}>选择一条记录查看正文或比较差异。</p> : null}
    {selected ? <InspectorSection icon={<NoteIcon size={18} />} title="所选版本">
      <p className={styles.versionHint}>{dateLabel(selected.createdAt)} · {selected.content.length.toLocaleString('zh-CN')} 字符</p>
      <div className={styles.versionActions}>
        <Button size="mini" onPress={() => setCompare((value) => !value)}>{compare ? '查看历史正文' : '与当前正文对比'}</Button>
        <Button size="mini" isDisabled={!canWrite || !onRestoreVersion || pending || selected.content === markdown} onPress={() => setRestoreOpen(true)}>恢复此版本</Button>
        <Button variant="ghost" size="mini" isDisabled={!canWrite || !onSaveVersionAs || pending} onPress={() => void act('saveAs')}>另存为新笔记</Button>
      </div>
      {compare ? <TextDiff before={selected.content} after={markdown} beforeLabel="所选历史正文" afterLabel="当前正文（含草稿）" /> : <article className={styles.versionPreview} aria-label="版本正文预览"><pre>{selected.content || '（空白版本）'}</pre></article>}
    </InspectorSection> : null}
    <Dialog title="恢复历史正文" isOpen={restoreOpen} onOpenChange={setRestoreOpen} isPending={pending}>
      <DialogBody><p>先保存当前草稿，再恢复所选正文。恢复前的内容仍可在历史记录中找回；标题、目录和标签保持现状。关联标注会重新检查位置。</p>{error ? <p className={styles.versionError} role="alert">{error}</p> : null}</DialogBody>
      <DialogFooter><DialogClose variant="ghost">取消</DialogClose><Button variant="primary" isPending={pending} isDisabled={!canWrite} onPress={() => void act('restore')}>确认恢复</Button></DialogFooter>
    </Dialog>
    <Dialog title="历史版本清理预览" isOpen={Boolean(prunePreview)} onOpenChange={open => { if (!open) setPrunePreview(null); }}>
      <DialogBody><p>当前只提供预览，不会自动裁剪。保留点尚无独立标记，任何版本都不会在此删除。</p>
        <ul>{prunePreview?.versions.map(version => <li key={version.id}>{dateLabel(version.createdAt)}：{version.references.length ? `保留，${version.references.map(reference => `${reference.type} ${reference.id}`).join('、')}` : '暂无已知引用；需先核对是否为保留点'}</li>)}</ul>
      </DialogBody>
      <DialogFooter><Button onPress={() => setPrunePreview(null)}>关闭</Button></DialogFooter>
    </Dialog>
  </section>;
}
