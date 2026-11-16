import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { commentConnector, visibleAnnotationRects } from './pdfAnnotationGeometry';
import { pdfAnnotationsAtPoint } from './pdfOverlay';
import styles from './PdfReader.module.css';

export function PdfCommentConnector({
  id,
  containerRef,
  editorRef,
  initialPointer,
  revision
}: {
  id: string;
  containerRef: RefObject<HTMLDivElement | null>;
  editorRef: RefObject<HTMLDivElement | null>;
  initialPointer?: { x: number; y: number };
  revision?: number;
}) {
  const pointer = useRef<{ x: number; y: number; target?: Element | null } | null>(initialPointer ?? null);
  const [line, setLine] = useState<ReturnType<typeof commentConnector>>(null);
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 0, height: 0 });
  useLayoutEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const container = containerRef.current,
        editor = editorRef.current,
        current = pointer.current;
      if (!container || !editor || !current) {
        setLine(null);
        return;
      }
      const target = document.elementFromPoint?.(current.x, current.y) ?? current.target;
      const hovering =
        target &&
        (editor.contains(target) ||
          (container.contains(target) && pdfAnnotationsAtPoint(target, current.x, current.y).includes(id)));
      const rect = container.getBoundingClientRect();
      setBounds(value =>
        value.left === rect.left && value.top === rect.top && value.width === rect.width && value.height === rect.height
          ? value
          : { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      );
      const next = hovering
        ? commentConnector(visibleAnnotationRects(container, id), editor.getBoundingClientRect(), rect)
        : null;
      setLine(value => (JSON.stringify(value) === JSON.stringify(next) ? value : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const move = (event: PointerEvent) => {
      pointer.current = {
        x: event.clientX,
        y: event.clientY,
        target: event.target instanceof Element ? event.target : null
      };
      schedule();
    };
    const clear = () => {
      pointer.current = null;
      setLine(null);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (containerRef.current) observer?.observe(containerRef.current);
    if (editorRef.current) observer?.observe(editorRef.current);
    const editor = editorRef.current;
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    if (editor) mutation?.observe(editor, { attributes: true, attributeFilter: ['style'] });
    document.addEventListener('pointermove', move, true);
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('blur', clear);
    document.addEventListener('pointerleave', clear);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      mutation?.disconnect();
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('blur', clear);
      document.removeEventListener('pointerleave', clear);
    };
  }, [containerRef, editorRef, id, revision]);
  return line
    ? createPortal(
        <svg
          className={styles.commentConnector}
          aria-hidden="true"
          data-pdf-comment-connector={id}
          width={bounds.width}
          height={bounds.height}
          style={{ left: bounds.left, top: bounds.top }}
        >
          <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
        </svg>,
        document.body
      )
    : null;
}
