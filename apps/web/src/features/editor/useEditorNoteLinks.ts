import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { calculateContentHash, type NoteLinkLocator } from '@study-accelerator/content-anchor';
import type { Note, NoteLinkRelations } from '@study-accelerator/web-core';
import type { EditorCommandTarget } from './editorCommands';
import type { NoteLinkEditSession } from './editorNoteLinks';
import type { NoteAutosaveController } from './useNoteAutosave';
import { getNoteDraftScope } from './noteDraftScope';
import { requestNoteLinkNavigation, takeNoteLinkNavigation } from './editorLinkNavigation';
import { useNoteLinkRelations } from './useNoteLinkRelations';

interface Options {
  note: Note | null;
  canWrite: boolean;
  canEditContent: boolean;
  refreshKey: unknown;
  editorRef: RefObject<EditorCommandTarget | null>;
  autosave: Pick<NoteAutosaveController, 'getLatestMarkdown' | 'saveNow' | 'hasLocalChanges'>;
  onGetNoteLinkRelations?: (noteId: string) => Promise<NoteLinkRelations>;
  onOpenNote(noteId: string): void;
  onFileStatus(message: string): void;
  saveCurrentScrollPosition(): void;
  restoreCurrentScrollPosition(): Promise<void>;
}

/** 链接会话、保存后导航与恢复后的来源定位；关系读取仍由既有 hook 负责。 */
export function useEditorNoteLinks({ note, canWrite, canEditContent, refreshKey, editorRef, autosave,
  onGetNoteLinkRelations, onOpenNote, onFileStatus, saveCurrentScrollPosition, restoreCurrentScrollPosition }: Options) {
  const scope = getNoteDraftScope(note?.spaceId);
  const context = useRef({ noteId: note?.id, scope, canEditContent });
  // 保留对象身份：离开再返回同一笔记仍会使途中的异步导航过期。
  if (context.current.noteId !== note?.id || context.current.scope !== scope || context.current.canEditContent !== canEditContent) {
    context.current = { noteId: note?.id, scope, canEditContent };
  }
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [edit, setEdit] = useState<{ noteId: string; scope: string | undefined; session: NoteLinkEditSession } | null>(null);
  const [notice, setNotice] = useState<{ noteId: string; scope: string | undefined } | null>(null);
  const relations = useNoteLinkRelations(note?.id, note?.spaceId, refreshKey, onGetNoteLinkRelations);
  const statuses = Object.fromEntries((relations.relations?.outgoing ?? []).map(item => [item.id, item.status]));
  const markdown = () => editorRef.current?.getMarkdown() ?? autosave.getLatestMarkdown();
  const saveImmediately = async () => { if (canWrite) await autosave.saveNow(markdown()); };

  async function openLinkedNote(targetNoteId: string, locator?: NoteLinkLocator) {
    if (!note || !onGetNoteLinkRelations) return;
    const before = context.current;
    const content = markdown();
    try {
      if (!canWrite && autosave.hasLocalChanges) throw new Error('当前正文尚未保存，请先处理草稿');
      await saveImmediately();
      if (!mounted.current) return;
      if (context.current !== before || markdown() !== content) throw new Error('保存期间来源已变化，请重试');
      const result = await onGetNoteLinkRelations(locator ? targetNoteId : note.id);
      if (!mounted.current) return;
      if (context.current !== before || markdown() !== content) throw new Error('跳转期间来源已变化，请重试');
      if (result.noteId !== (locator ? targetNoteId : note.id) || result.spaceId !== note.spaceId) throw new Error('引用查询已失效');
      if (!locator && !result.outgoing.some(item => item.id === targetNoteId && item.status === 'active')) throw new Error('目标已删除或链接已移除');
      saveCurrentScrollPosition();
      if (locator) requestNoteLinkNavigation(targetNoteId, scope, locator, result.contentHash);
      onOpenNote(targetNoteId);
    } catch (cause) { if (mounted.current) onFileStatus(cause instanceof Error ? cause.message : '跳转失败'); }
  }

  async function applyLink(targetId: string | null, label: string) {
    if (!note || !edit || !canEditContent || edit.noteId !== note.id || edit.scope !== scope) throw new Error('笔记或编辑状态已变化，请重新选择');
    if (context.current.noteId !== edit.noteId || context.current.scope !== edit.scope || !context.current.canEditContent
      || !editorRef.current?.applyNoteLinkEdit?.(edit.session, targetId, label)) throw new Error('正文或选区已变化，请重新选择');
    await saveImmediately();
  }

  async function onReady() {
    if (!note) return;
    const readyContext = context.current;
    await restoreCurrentScrollPosition();
    if (!mounted.current || context.current !== readyContext || readyContext.noteId !== note.id) return;
    const navigation = takeNoteLinkNavigation(note.id, scope);
    if (navigation) {
      const located = calculateContentHash(note.rawMarkdown) === navigation.contentHash
        && editorRef.current?.matchesMarkdownDocument?.(note.rawMarkdown)
        && editorRef.current?.selectNoteLinkOccurrence?.(navigation.locator);
      setNotice(located ? null : { noteId: note.id, scope });
    }
  }

  return {
    relations, statuses, openLinkedNote, onReady, applyLink,
    editSession: edit?.noteId === note?.id && edit?.scope === scope ? edit?.session : undefined,
    navigationNotice: Boolean(notice && notice.noteId === note?.id && notice.scope === scope),
    dismissNavigationNotice: () => setNotice(null),
    requestLink: (session: NoteLinkEditSession) => { if (note) setEdit({ noteId: note.id, scope, session }); },
    closeLink: () => { setEdit(null); window.requestAnimationFrame(() => editorRef.current?.focus()); }
  };
}
