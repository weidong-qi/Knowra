import { useLayoutEffect, useRef, type RefObject } from 'react';
import { ApiRequestError, type Annotation, type CreateAnnotationInput, type Note, type UpdateAnnotationAnchorInput, type ContentAnchor } from '@study-accelerator/web-core';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import type { EditorCommandTarget } from './editorCommands';
import { buildCreateAnnotationInput, buildUpdateAnnotationAnchorInput, canContinueListAnnotation, type AnnotationSelection } from './annotationPayloads';

interface EditorAnnotationWritesOptions {
  note: Note | null;
  canEditContent: boolean;
  editorRef: RefObject<EditorCommandTarget | null>;
  autosave: { saveNow(markdown?: string): Promise<void>; getLatestMarkdown(): string };
  onListAnnotations(noteId: string): Promise<Annotation[]>;
  onCreateAnnotation(input: CreateAnnotationInput): Promise<Annotation>;
  onUpdateAnnotationAnchor(annotationId: string, input: UpdateAnnotationAnchorInput): Promise<Annotation>;
  onCreateAnnotationExclusion?(annotationId: string, input: { expectedRevision: number; noteContentHash: string; anchor: ContentAnchor }): Promise<{ annotation: Annotation }>;
  onCreated(annotation: Annotation): void;
  onUpdated(annotation: Annotation, focus: boolean): void;
  onFileStatus(message: string): void;
}

// 只负责依赖正文选区的标注写入；读取/展示与非选区元数据动作仍由调用者组合。
export function useEditorAnnotationWrites({
  note, canEditContent, editorRef, autosave, onListAnnotations, onCreateAnnotation,
  onUpdateAnnotationAnchor, onCreateAnnotationExclusion, onCreated, onUpdated, onFileStatus
}: EditorAnnotationWritesOptions) {
  const annotationCreateInputsRef = useRef(new Map<string, { markdown: string; selection: AnnotationSelection; input: CreateAnnotationInput }>());
  const annotationCreatePendingRef = useRef(false);
  const annotationWriteStateRef = useRef({ noteId: note?.id, editable: canEditContent });
  if (annotationWriteStateRef.current.noteId !== note?.id || annotationWriteStateRef.current.editable !== canEditContent) {
    annotationWriteStateRef.current = { noteId: note?.id, editable: canEditContent };
  }
  const annotationMountedRef = useRef(true);
  useLayoutEffect(() => {
    annotationMountedRef.current = true;
    return () => { annotationMountedRef.current = false; };
  }, []);

  const createCurrentAnnotation = async (scopeType: 'selection' | 'blocks' | 'section' | 'list' = 'selection', importance: 'normal' | 'important' | 'core' = 'normal') => {
    if (!note || !canEditContent) throw new Error('阅读模式下无法创建标注');
    if (annotationCreatePendingRef.current) return;
    const context = annotationWriteStateRef.current;
    const editor = editorRef.current;
    let selection = editor?.getAnnotationSelection(scopeType);
    if (!selection) throw new Error(scopeType === 'list' ? '请先将光标放在非空的普通列表项内' : scopeType === 'section' ? '请先将光标放在标题章节内' : '请先在正文中选中要标记的内容');
    let markdown = editorRef.current?.getMarkdown() ?? autosave.getLatestMarkdown();
    let selectionSignature = JSON.stringify(selection);
    const assertCurrent = () => {
      if (!annotationMountedRef.current || annotationWriteStateRef.current !== context || editorRef.current !== editor
        || editor?.getMarkdown() !== markdown || JSON.stringify(editor.getAnnotationSelection(scopeType, { restoreSelection: false })) !== selectionSignature) {
        throw new Error('正文、选区或编辑状态已变化，请重新选择章节或内容');
      }
    };
    const initialSignature = JSON.stringify([note.id, calculateContentHash(markdown), scopeType, selection.anchor, importance]);
    const unresolved = [...annotationCreateInputsRef.current.entries()].find(([signature, request]) =>
      signature === initialSignature || request.input.noteId === note.id && request.input.importance === importance
        && canContinueListAnnotation(request.markdown, markdown, request.selection, selection ?? null));
    annotationCreatePendingRef.current = true;
    try {
      // 最多跟进三轮原列表项内的继续输入，避免持续打字时无限等待。
      for (let attempt = 0; ; attempt++) {
        assertCurrent();
        await autosave.saveNow(markdown);
        if (!annotationMountedRef.current || annotationWriteStateRef.current !== context || editorRef.current !== editor) {
          throw new Error('正文、选区或编辑状态已变化，请重新选择章节或内容');
        }
        const latestMarkdown = editor!.getMarkdown();
        if (latestMarkdown === markdown) { assertCurrent(); break; }
        const latestSelection = editor!.getAnnotationSelection(scopeType, { restoreSelection: false });
        if (attempt >= 2 || !canContinueListAnnotation(markdown, latestMarkdown, selection, latestSelection)) {
          throw new Error('正文、选区或编辑状态已变化，请重新选择章节或内容');
        }
        markdown = latestMarkdown;
        selection = latestSelection;
        selectionSignature = JSON.stringify(selection);
      }
      const signature = JSON.stringify([note.id, calculateContentHash(markdown), scopeType, selection.anchor, importance]);
      // 未确认的请求须保持原 payload/key，服务端会先恢复幂等结果，再校验正文版本。
      const requestKey = unresolved?.[0] ?? signature;
      const request = unresolved?.[1] ?? { markdown, selection, input: await buildCreateAnnotationInput(note, markdown, selection, importance) };
      assertCurrent();
      annotationCreateInputsRef.current.set(requestKey, request);
      let created: Annotation;
      try { created = await onCreateAnnotation(request.input); }
      catch (error) {
        // 该明确冲突在服务端幂等查询之后抛出，证明旧请求未创建，下一次显式操作可用最新正文。
        if (error instanceof ApiRequestError && error.code === 'ANNOTATION_CONTENT_CONFLICT') annotationCreateInputsRef.current.delete(requestKey);
        throw error;
      }
      annotationCreateInputsRef.current.delete(requestKey);
      if (!annotationMountedRef.current || annotationWriteStateRef.current !== context) return;
      onCreated(created);
      onFileStatus('已标为重点');
    } finally { annotationCreatePendingRef.current = false; }
  };
  const prepareAnnotationWrite = async (annotation: Annotation, scope: 'selection' | 'blocks' | 'section' | 'list') => {
    const context = annotationWriteStateRef.current;
    const editor = editorRef.current;
    if (!annotationMountedRef.current || !context.editable || context.noteId !== annotation.noteId || !editor) throw new Error('笔记或编辑状态已变化，请重新选择');
    const selection = editor.getAnnotationSelection(scope);
    if (!selection) throw new Error('请先在正文中选择对应内容');
    const markdown = editor.getMarkdown();
    const signature = JSON.stringify(selection);
    const assertCurrent = () => {
      if (!annotationMountedRef.current || annotationWriteStateRef.current !== context || editorRef.current !== editor
        || editor.getMarkdown() !== markdown || JSON.stringify(editor.getAnnotationSelection(scope, { restoreSelection: false })) !== signature) {
        throw new Error('正文、选区或编辑状态已变化，请重新选择');
      }
    };
    await autosave.saveNow(markdown);
    assertCurrent();
    const items = await onListAnnotations(annotation.noteId);
    assertCurrent();
    const latest = items.find(item => item.id === annotation.id && item.noteId === annotation.noteId);
    if (!latest || latest.deletedAt || latest.lifecycleStatus && latest.lifecycleStatus !== 'active') throw new Error('标注状态已变化，请刷新后重试');
    return { markdown, selection, revision: latest.revision ?? 1, assertCurrent,
      isCurrentNote: () => annotationMountedRef.current && annotationWriteStateRef.current === context };
  };
  const reanchorAnnotation = async (annotation: Annotation) => {
    const prepared = await prepareAnnotationWrite(annotation, annotation.scopeType ?? 'selection');
    const input = await buildUpdateAnnotationAnchorInput(prepared.markdown, prepared.selection, prepared.revision);
    prepared.assertCurrent();
    const updated = await onUpdateAnnotationAnchor(
      annotation.id,
      input
    );
    if (prepared.isCurrentNote()) { onUpdated(updated, true); }
  };
  const excludeCurrentBlock = async (annotation: Annotation) => {
    if (!onCreateAnnotationExclusion) throw new Error('当前环境不支持局部排除');
    const prepared = await prepareAnnotationWrite(annotation, 'blocks');
    prepared.assertCurrent();
    const result = await onCreateAnnotationExclusion(annotation.id, {
      expectedRevision: prepared.revision,
      noteContentHash: calculateContentHash(prepared.markdown),
      anchor: prepared.selection.anchor
    });
    if (prepared.isCurrentNote()) { onUpdated(result.annotation, false); onFileStatus('已从所属重点中排除当前内容块'); }
  };

  return { createCurrentAnnotation, reanchorAnnotation, excludeCurrentBlock };
}
