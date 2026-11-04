import { useEffect, useRef, useState, type RefObject, type PointerEvent } from 'react';
import type { EditorView } from '@milkdown/kit/prose/view';
import { Button } from '../../components/ui';
import { IMAGE_CONTEXT_EVENT } from './editorImageBehavior';
import { fittedImageSize, readImageSize, selectedImage, setImageRatio } from './editorImageModel';
import styles from './EditorImageControls.module.css';

export function EditorImageControls({ hostRef, getView }: { hostRef: RefObject<HTMLDivElement | null>; getView(): EditorView | null }) {
  const [position, setPosition] = useState<{ x: number; y: number; gripX: number; gripY: number; ratio: number } | null>(null);
  const cancelDrag = useRef<(() => void) | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const view = getView();
      const selected = view && !view.isDestroyed && view.editable ? selectedImage(view.state) : null;
      const image = view && selected ? view.nodeDOM(selected.pos) : null;
      if (!(image instanceof HTMLImageElement)) { setPosition(null); return; }
      const rect = image.getBoundingClientRect();
      const stage = view!.dom.closest('[data-editor-scroll-root]');
      const stageRect = stage?.getBoundingClientRect();
      const format = stage?.querySelector('[aria-label="笔记格式工具栏"]')?.getBoundingClientRect();
      const top = Math.max(stageRect?.top ?? 0, format?.bottom ?? 0) + 8;
      const bottom = Math.min(stageRect?.bottom ?? window.innerHeight, window.innerHeight);
      if (rect.bottom < top || rect.top > bottom) { setPosition(null); return; }
      const next = { x: Math.max(8, Math.min(rect.left, window.innerWidth - 330)), y: Math.max(top, Math.min(rect.top - 40, bottom - 40)),
        gripX: Math.max(8, Math.min(rect.right - 24, window.innerWidth - 32)), gripY: Math.min(rect.bottom - 24, bottom - 32), ratio: selected!.ratio };
      setPosition(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    for (const name of [IMAGE_CONTEXT_EVENT, 'pointerup', 'keyup']) host.addEventListener(name, update);
    document.addEventListener('selectionchange', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    update();
    return () => {
      cancelDrag.current?.();
      for (const name of [IMAGE_CONTEXT_EVENT, 'pointerup', 'keyup']) host.removeEventListener(name, update);
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [hostRef, getView]);

  function resize(ratio: number) {
    const view = getView();
    if (!view || view.isDestroyed || !view.editable) return;
    setImageRatio(ratio)(view.state, view.dispatch);
    const originalFocus = document.activeElement;
    requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (focused && focused !== originalFocus && focused !== document.body && !view.dom.contains(focused) && !focused.closest('[data-image-controls]')) return;
      if (getView() === view && !view.isDestroyed && view.editable) view.focus();
    });
  }

  function startDrag(event: PointerEvent) {
    if (event.button !== 0) return;
    const view = getView();
    const selected = view && selectedImage(view.state);
    const image = view && selected && view.nodeDOM(selected.pos);
    if (!view || view.isDestroyed || !view.editable || !(image instanceof HTMLImageElement) || !image.naturalWidth) return;
    event.preventDefault();
    cancelDrag.current?.();
    const original = view.state;
    const originalWidth = image.style.width;
    const rect = image.getBoundingClientRect();
    const available = image.parentElement?.clientWidth || view.dom.clientWidth;
    const { baseline } = fittedImageSize(image.naturalWidth, available, 1);
    const x = event.clientX; const y = event.clientY; const pointer = event.pointerId;
    let width = rect.width;
    image.dataset.resizePreview = 'true';
    const valid = () => getView() === view && !view.isDestroyed && view.editable && image.isConnected
      && view.state.doc.eq(original.doc) && view.state.selection.eq(original.selection);
    const cleanup = () => {
      delete image.dataset.resizePreview;
      image.style.width = originalWidth;
      if (!view.isDestroyed && view.nodeDOM(selected!.pos) === image) {
        const current = view.state.doc.nodeAt(selected!.pos);
        const currentAvailable = image.parentElement?.clientWidth || view.dom.clientWidth;
        if (current?.type.name === 'image') image.style.width = `${fittedImageSize(image.naturalWidth, currentAvailable, readImageSize(current.attrs).ratio).width}px`;
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
      cancelDrag.current = null;
    };
    const cancel = () => cleanup();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup(); };
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (!valid()) return cleanup();
      const dx = e.clientX - x; const dy = (e.clientY - y) * rect.width / rect.height;
      width = Math.max(baseline * 0.1, Math.min(available, baseline * 4, rect.width + (Math.abs(dx) > Math.abs(dy) ? dx : dy)));
      image.style.width = `${width}px`;
    };
    const finish = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointer) return;
      const commit = valid(); cleanup();
      if (commit) resize(width / baseline);
    };
    cancelDrag.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key);
  }
  if (!position) return null;
  return <>
    <div className={styles.toolbar} style={{ left: position.x, top: position.y }} role="toolbar" aria-label="图片尺寸工具栏" data-image-controls data-pdf-exclude>
      {([['小图', 0.4], ['中图', 0.66], ['大图', 0.82], ['适应宽度', 1]] as const).map(([label, ratio]) =>
        <Button key={label} size="compact" variant="ghost" onPress={() => resize(ratio)}>{label}</Button>)}
    </div>
    <Button className={styles.grip} style={{ left: position.gripX, top: position.gripY }} size="mini" variant="ghost" aria-label="拖动缩放图片"
      data-image-controls data-pdf-exclude onPointerDown={startDrag}>↘</Button>
  </>;
}
