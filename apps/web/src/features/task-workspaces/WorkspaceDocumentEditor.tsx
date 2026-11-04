import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentDTO } from '@study-accelerator/web-core';
import { Button } from '../../components/ui/button/Button';
import { TextField } from '../../components/ui/input';
import { Dialog, DialogBody, DialogFooter } from '../../components/ui/overlay';
import { MilkdownNoteEditor } from '../editor/MilkdownNoteEditor';
import type { EditorCommandTarget } from '../editor/editorCommands';
import { clearDocumentDraft, documentDraftKey, readDocumentDraft, writeDocumentDraft, type DocumentDraft } from './drafts';
import { createWorkspaceResourcePolicy } from './resourcePolicy';
import { taskError } from './taskPresentation';
import styles from './TaskWorkspaces.module.css';

interface Props {
  document: DocumentDTO;
  datasetId: string;
  datasetEpoch: string;
  readOnly?: boolean;
  onSave(input: DocumentDraft): Promise<DocumentDTO>;
  onReload(): Promise<DocumentDTO>;
  onUpload(file: File, expectedRevision: number): Promise<{ imageUri: string; documentRevision: number; attachment: DocumentDTO['attachments'][number] }>;
}
/** Mounted with a dataset/workspace/document key; delayed writes never mutate another editor. */
export function WorkspaceDocumentEditor({ document: initial, datasetId, datasetEpoch, readOnly = false, onSave, onReload, onUpload }: Props) {
  const key = documentDraftKey(datasetId, datasetEpoch, initial.workspaceId, initial.id);
  const [document, setDocument] = useState(initial);
  const [draft, setDraft] = useState<DocumentDraft>(() => !readOnly && readDocumentDraft(key) || { title: initial.title, markdown: initial.markdown, baseRevision: initial.revision });
  const draftRef = useRef(draft); draftRef.current = draft;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [latest, setLatest] = useState<DocumentDTO | null>(null);
  const alive = useRef(true);
  const operation = useRef(false);
  const editor = useRef<EditorCommandTarget>(null);
  const previews = useRef(new Map<string, string>());
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; for (const url of previews.current.values()) URL.revokeObjectURL(url); previews.current.clear(); }; }, []);
  const policy = useMemo(() => createWorkspaceResourcePolicy(document.workspaceId, document.id, document.attachments.map(item => item.id), { versionId: document.version.id, previews: previews.current }), [document]);
  const dirty = draft.title !== document.title || draft.markdown !== document.markdown;
  function change(next: DocumentDraft) {
    draftRef.current = next; setDraft(next);
    if (!readOnly && !writeDocumentDraft(key, next)) setMessage('本地草稿存储不可用，请保持页面打开并保存。');
  }
  async function save() {
    if (operation.current || readOnly) return;
    operation.current = true; setPending(true); setMessage('');
    const savedDraft = draftRef.current;
    try {
      const saved = await onSave(savedDraft);
      if (!alive.current) return;
      setDocument(saved);
      if (draftRef.current === savedDraft) { setDraft({ title: saved.title, markdown: saved.markdown, baseRevision: saved.revision }); clearDocumentDraft(key); }
      else change({ ...draftRef.current, baseRevision: saved.revision });
      setMessage('文档版本已保存。已发布的需求和成果快照保持不变。');
    } catch (error) { if (alive.current) setMessage(taskError(error)); }
    finally { operation.current = false; if (alive.current) setPending(false); }
  }
  async function upload(file: File) {
    if (operation.current || readOnly) throw new Error('请等待当前操作完成。');
    operation.current = true; setPending(true);
    try {
      const result = await onUpload(file, draftRef.current.baseRevision);
      if (!alive.current) throw new Error('已离开文档。');
      previews.current.set(result.imageUri, URL.createObjectURL(file));
      setDocument(current => ({ ...current, revision: result.documentRevision, attachments: [...current.attachments, result.attachment] }));
      // Permit the exact server-generated path before Milkdown inserts its image node.
      policy.resolveImage = createWorkspaceResourcePolicy(document.workspaceId, document.id, [...document.attachments.map(item => item.id), result.attachment.id], { versionId: document.version.id, previews: previews.current }).resolveImage;
      change({ ...draftRef.current, baseRevision: result.documentRevision });
      return { url: result.imageUri, alt: file.name };
    } catch (error) { if (alive.current) setMessage(taskError(error)); throw error; }
    finally { operation.current = false; if (alive.current) setPending(false); }
  }
  return <section className={styles.detail} aria-label={readOnly ? '冻结文档版本' : '协作文档编辑器'}>
    <div className={styles.actions}>
      <span className={styles.meta}>版本 {document.version.ordinal} · 修订 {draft.baseRevision}{dirty ? ' · 有未保存修改' : ''}</span>
      {!readOnly && <><Button isDisabled={pending || !dirty} onPress={() => void save()}>保存文档</Button>
        <Button variant="default" isDisabled={pending} onPress={() => picker.current?.click()}>插入图片</Button>
        <Button variant="ghost" isDisabled={pending} onPress={() => {
          setPending(true); void onReload().then(value => { if (alive.current) setLatest(value); }).catch(error => { if (alive.current) setMessage(taskError(error)); }).finally(() => { if (alive.current) setPending(false); });
        }}>核对最新版本</Button></>}
    </div>
    <TextField label="文档标题" value={draft.title} onChange={title => change({ ...draftRef.current, title })} isReadOnly={readOnly} />
    <p className={styles.meta}>此文档仅属于当前任务工作区，与私人笔记隔离。外链图片和笔记跳转已禁用。图片支持 PNG、JPEG、WebP，最大 5 MiB / 1600 万像素。</p>
    {draft.baseRevision !== document.revision && <p role="alert">本地草稿基于旧修订。请核对最新版本并手动合并，直接保存会被拒绝。</p>}
    {message && <p role="status">{message}</p>}
    <div className={styles.editor}><MilkdownNoteEditor ref={editor} noteId={key} markdown={draft.markdown} readOnly={readOnly}
      allowExternalSync resourcePolicy={policy} onChange={markdown => change({ ...draftRef.current, markdown })} onUploadImage={readOnly ? undefined : upload} /></div>
    <input ref={picker} type="file" aria-label="上传工作区图片" accept="image/png,image/jpeg,image/webp" hidden onChange={event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (file) void upload(file).then(result => { if (alive.current) editor.current?.insertImage(result.url, result.alt); }).catch(() => undefined);
    }} />
    {latest && <Dialog title="核对文档版本" isOpen onOpenChange={open => { if (!open) setLatest(null); }} size="md">
      <DialogBody><p>当前服务端修订 {latest.revision}。下方为最新正文；你的本地草稿仍保留。选择合并基线后，请手动整合内容再保存。</p>
        <p>最新标题：{latest.title}</p><pre className={styles.prewrap}>{latest.markdown}</pre></DialogBody>
      <DialogFooter><Button variant="ghost" onPress={() => setLatest(null)}>保留草稿，暂不合并</Button>
        <Button onPress={() => { setDocument(latest); change({ ...draftRef.current, baseRevision: latest.revision }); setLatest(null); setMessage('已更新合并基线，请核对本地草稿后保存。'); }}>以此版本为合并基线</Button></DialogFooter>
    </Dialog>}
  </section>;
}
