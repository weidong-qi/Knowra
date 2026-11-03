import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { AnalysisScopeInput, AnalysisScopePreview, Annotation, Note, NoteVersion } from '@study-accelerator/web-core';
import type { EditorCommandTarget } from './editorCommands';
import type { NoteAutosaveController } from './useNoteAutosave';

interface Options {
  note: Note | null;
  canWrite: boolean;
  showSourceEditor: boolean;
  extractionScope: object;
  editorRef: RefObject<EditorCommandTarget | null>;
  autosave: Pick<NoteAutosaveController, 'getLatestMarkdown' | 'saveNow' | 'updateDraft'>;
  onPreviewAnalysisScope?(input: AnalysisScopeInput): Promise<AnalysisScopePreview>;
  onCreateKnowledgeCandidate?(annotation: Annotation): Promise<void>;
  onExtractWithAssistant?(noteId: string): void;
  onSaveVersionAs?(version: NoteVersion): Promise<void>;
  onFileStatus(message: string): void;
}

/** 依赖已保存正文的动作；保存排队与持久化仍由 autosave 负责。 */
export function useEditorSavedActions({ note, canWrite, showSourceEditor, extractionScope, editorRef, autosave,
  onPreviewAnalysisScope, onCreateKnowledgeCandidate, onExtractWithAssistant, onSaveVersionAs, onFileStatus }: Options) {
  const session = useRef({ noteId: note?.id, spaceId: note?.spaceId, canWrite, showSourceEditor, extractionScope });
  const current = session.current;
  // 使用会话身份阻断“离开再返回”；普通保存引起的 note/回调对象更新不作废操作。
  if (current.noteId !== note?.id || current.spaceId !== note?.spaceId || current.canWrite !== canWrite
    || current.showSourceEditor !== showSourceEditor || current.extractionScope !== extractionScope) {
    session.current = { noteId: note?.id, spaceId: note?.spaceId, canWrite, showSourceEditor, extractionScope };
  }
  const renderSession = session.current;
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const readMarkdown = () => showSourceEditor ? autosave.getLatestMarkdown() : editorRef.current?.getMarkdown() ?? autosave.getLatestMarkdown();

  function capture(message: string, targetNoteId = note?.id) {
    if (!mounted.current || session.current !== renderSession || !canWrite || !note || targetNoteId !== note.id) throw new Error(message);
    const editor = editorRef.current;
    const markdown = readMarkdown();
    const isCurrent = () => mounted.current && session.current === renderSession && editorRef.current === editor;
    return {
      markdown, isCurrent,
      assertCurrent(stateMessage: string, draftMessage = stateMessage) {
        if (!isCurrent()) throw new Error(stateMessage);
        if (readMarkdown() !== markdown) throw new Error(draftMessage);
      }
    };
  }

  async function restoreVersion(version: NoteVersion) {
    const before = capture('当前状态无法恢复此历史记录', version.noteId);
    await autosave.saveNow(before.markdown);
    before.assertCurrent('笔记或写入状态已改变，请重新打开历史记录', '保存期间正文又有修改，请重新检查差异后恢复');
    autosave.updateDraft(version.content, { immediate: true });
    editorRef.current?.setMarkdown(version.content);
    await autosave.saveNow(version.content);
    // 写入可以完成，但迟到的成功提示不能进入另一篇笔记或已卸载的页面。
    if (before.isCurrent()) onFileStatus('已恢复历史正文；恢复前的正文已保留在历史记录中');
  }

  async function saveVersionAs(version: NoteVersion) {
    const before = capture('当前状态无法另存此历史记录', version.noteId);
    await autosave.saveNow(before.markdown);
    before.assertCurrent('笔记或写入状态已改变，请重新打开历史记录', '保存期间正文又有修改，请重新检查差异后另存');
    await onSaveVersionAs!(version);
  }

  async function previewAnalysis(input: AnalysisScopeInput) {
    const message = '当前笔记无法预览分析范围。';
    const before = capture(message);
    if (input.spaceId !== note?.spaceId) throw new Error(message);
    await autosave.saveNow(before.markdown);
    before.assertCurrent('保存期间笔记或草稿已变化，请重新预览。');
    const preview = await onPreviewAnalysisScope!(input);
    before.assertCurrent('预览期间笔记或草稿已变化，请重新预览。');
    return preview;
  }

  async function createKnowledgeCandidate(annotation: Annotation) {
    const message = '已切换笔记或写入状态，请在当前笔记重新创建候选。';
    const before = capture(message, annotation.noteId);
    await autosave.saveNow(before.markdown);
    before.assertCurrent(message, '保存期间正文又有修改，请确认内容后重新创建候选。');
    await onCreateKnowledgeCandidate!(annotation);
  }

  async function extractWithAssistant() {
    const before = capture('当前笔记不可写，无法提炼知识点。');
    await autosave.saveNow(before.markdown);
    before.assertCurrent('保存期间笔记或草稿已变化，请确认内容后重试。');
    onExtractWithAssistant!(note!.id);
  }

  return {
    restoreVersion,
    saveVersionAs: onSaveVersionAs ? saveVersionAs : undefined,
    previewAnalysis: onPreviewAnalysisScope ? previewAnalysis : undefined,
    createKnowledgeCandidate: onCreateKnowledgeCandidate ? createKnowledgeCandidate : undefined,
    extractWithAssistant: onExtractWithAssistant ? extractWithAssistant : undefined
  };
}
