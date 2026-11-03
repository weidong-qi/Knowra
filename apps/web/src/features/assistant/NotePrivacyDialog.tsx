import { useEffect, useRef, useState } from 'react';
import type { Note } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogFooter } from '../../components/ui';
import { useAppStore, useAppStoreApi } from '../../store/AppStoreProvider';

/** Shared by note entry points; changes only visibility using the displayed version. */
export function NotePrivacyDialog({ note, isOpen, onOpenChange }: {
  note: Note; isOpen: boolean; onOpenChange(open: boolean): void;
}) {
  const store = useAppStoreApi();
  const canWrite = useAppStore(state => state.canWriteWorkspace());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setPending(false); setError(null); }, [note.id, isOpen]);
  const makePrivate = note.aiVisibility !== 'private';
  async function save() {
    if (pending || !store.getState().canWriteWorkspace()) return;
    const current = generation.current;
    setPending(true); setError(null);
    try {
      if (!note.updatedAt) throw new Error('当前笔记缺少版本信息，请刷新后重试。');
      await store.getState().setNoteAiVisibility(note.id, {
        aiVisibility: makePrivate ? 'private' : 'normal', expectedUpdatedAt: note.updatedAt
      });
      if (current === generation.current) onOpenChange(false);
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : '隐私更新失败，请刷新笔记后重试。');
    } finally { if (current === generation.current) setPending(false); }
  }
  return <Dialog title="笔记 AI 隐私" isOpen={isOpen} onOpenChange={onOpenChange} size="sm">
    <DialogBody>
      <p>「{note.title || '未命名笔记'}」当前为{makePrivate ? '普通' : '私密'}笔记。</p>
      <p>普通笔记可供 AI 读取；普通不代表公开共享。私密笔记禁止 AI 读取标题、正文、附件和历史版本。</p>
      {makePrivate ? <p>改为私密后，AI 将不再读取原资料。已生成的历史回答或派生成果可能仍含这些信息，已经发送的内容无法收回。</p>
        : <p>改为普通后，此笔记可以参与 AI 检索与阅读。</p>}
      {error ? <p role="alert">{error}</p> : null}
    </DialogBody>
    <DialogFooter><Button variant="ghost" isDisabled={pending} onPress={() => onOpenChange(false)}>取消</Button>
      <Button variant="primary" isDisabled={pending || !canWrite} onPress={() => void save()}>{makePrivate ? '设为私密' : '设为普通'}</Button></DialogFooter>
  </Dialog>;
}
