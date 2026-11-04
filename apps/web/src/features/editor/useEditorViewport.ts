import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  captureEditorScrollPosition, getEditorScrollTop,
  readEditorScrollPositions, writeEditorScrollPositions
} from './editorScrollPosition';

// 每次进入笔记都有独立会话；同 ID 的 A → B → A 也不能复用旧恢复任务。
function createViewportSession(noteId: string | undefined) {
  return {
    noteId, active: false, pending: false, attempt: null as { promise: Promise<void> } | null,
    frames: new Map<number, () => void>()
  };
}

export function useEditorViewport(noteId: string | undefined) {
  const documentStageRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLElement>(null);
  const toolbarAnchorRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [scrollPositions] = useState(readEditorScrollPositions);
  const [toolbarPinned, setToolbarPinned] = useState(false);
  const [documentEdge, setDocumentEdge] = useState<number | null>(null);
  const session = useMemo(() => createViewportSession(noteId), [noteId]);

  const saveCurrentScrollPosition = useCallback(() => {
    const stage = documentStageRef.current;
    // 加载期的 0 或中间高度不是用户新的阅读位置。
    if (!session.active || !stage || session.pending) return;
    captureEditorScrollPosition(scrollPositions, session.noteId, stage.scrollTop);
    writeEditorScrollPositions(scrollPositions);
  }, [session, scrollPositions]);

  const restoreCurrentScrollPosition = useCallback(async () => {
    const stage = documentStageRef.current;
    if (!stage || !session.active || !session.pending) return;
    if (session.attempt) return session.attempt.promise;
    const attempt = { promise: Promise.resolve() };
    session.attempt = attempt;
    const isCurrent = () => session.active && session.pending && session.attempt === attempt
      && documentStageRef.current === stage;
    const nextFrame = () => new Promise<void>(resolve => {
      const id = window.requestAnimationFrame(() => { session.frames.delete(id); resolve(); });
      session.frames.set(id, resolve);
    });
    attempt.promise = (async () => {
      try {
        await nextFrame();
        if (!isCurrent()) return;
        await nextFrame();
        if (!isCurrent()) return;
        const scrollTop = getEditorScrollTop(scrollPositions, session.noteId);
        for (let frame = 0; frame < 30 && stage.scrollHeight - stage.clientHeight < scrollTop; frame += 1) {
          await nextFrame();
          if (!isCurrent()) return;
        }
        // 异步正文/图片尚未撑开，留给 ResizeObserver 重试。
        if (stage.scrollHeight - stage.clientHeight < scrollTop) return;
        for (let frame = 0; frame < (scrollTop > 0 ? 30 : 1); frame += 1) {
          stage.scrollTop = scrollTop;
          await nextFrame();
          if (!isCurrent()) return;
        }
        stage.scrollTop = scrollTop;
        session.pending = false;
      } finally {
        if (session.attempt === attempt) session.attempt = null;
      }
    })();
    return attempt.promise;
  }, [session, scrollPositions]);

  useLayoutEffect(() => {
    session.active = true;
    session.pending = Boolean(noteId);
    const stage = documentStageRef.current;
    if (stage) stage.scrollTop = 0;
    return () => {
      session.active = false;
      session.pending = false;
      // 取消并唤醒等待者，使旧 onReady 可以结束，但不能再读写新视口。
      session.attempt = null;
      for (const [id, resolve] of session.frames) {
        window.cancelAnimationFrame(id);
        resolve();
      }
      session.frames.clear();
      writeEditorScrollPositions(scrollPositions);
    };
  }, [noteId, session, scrollPositions]);

  useEffect(() => {
    const stage = documentStageRef.current;
    const toolbarAnchor = toolbarAnchorRef.current;
    const toolbar = toolbarRef.current;
    if (!stage || !toolbarAnchor || !toolbar) return;
    const syncPinned = () => {
      if (!session.pending) captureEditorScrollPosition(scrollPositions, noteId, stage.scrollTop);
      const marginTop = Number.parseFloat(window.getComputedStyle(toolbar).marginTop) || 0;
      const pinned = toolbarAnchor.getBoundingClientRect().top + marginTop <= stage.getBoundingClientRect().top + 1;
      setToolbarPinned(current => current === pinned ? current : pinned);
    };
    const syncDocumentEdge = () => {
      stage.style.setProperty('--editor-toolbar-height', `${Math.ceil(toolbar.getBoundingClientRect().height) + 8}px`);
      const paper = toolbar.closest('article');
      if (paper) {
        const edge = Math.max(0, (stage.clientWidth - paper.offsetWidth) / 2);
        setDocumentEdge(current => current === edge ? current : edge);
      }
    };
    const syncLayout = () => { syncPinned(); syncDocumentEdge(); };
    const cancelPendingRestore = () => { session.pending = false; };
    const layoutObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncDocumentEdge);
    const contentObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      void restoreCurrentScrollPosition();
    });
    layoutObserver?.observe(stage);
    layoutObserver?.observe(toolbar);
    if (paperRef.current) contentObserver?.observe(paperRef.current);
    stage.addEventListener('scroll', syncPinned, { passive: true });
    stage.addEventListener('pointerdown', cancelPendingRestore, { capture: true });
    stage.addEventListener('wheel', cancelPendingRestore, { capture: true, passive: true });
    stage.addEventListener('touchstart', cancelPendingRestore, { capture: true, passive: true });
    stage.addEventListener('keydown', cancelPendingRestore, { capture: true });
    window.addEventListener('resize', syncLayout);
    syncLayout();
    return () => {
      layoutObserver?.disconnect();
      stage.style.removeProperty('--editor-toolbar-height');
      contentObserver?.disconnect();
      stage.removeEventListener('scroll', syncPinned);
      stage.removeEventListener('pointerdown', cancelPendingRestore, { capture: true });
      stage.removeEventListener('wheel', cancelPendingRestore, { capture: true });
      stage.removeEventListener('touchstart', cancelPendingRestore, { capture: true });
      stage.removeEventListener('keydown', cancelPendingRestore, { capture: true });
      window.removeEventListener('resize', syncLayout);
    };
  }, [noteId, session, scrollPositions, restoreCurrentScrollPosition]);

  return {
    documentStageRef, paperRef, toolbarAnchorRef, toolbarRef, toolbarPinned, documentEdge,
    saveCurrentScrollPosition, restoreCurrentScrollPosition
  };
}
