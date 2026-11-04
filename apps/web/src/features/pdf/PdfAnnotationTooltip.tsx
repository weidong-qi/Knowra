import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { Tooltip, TooltipTrigger } from '../../components/ui';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import { pdfAnnotationAtPoint } from './pdfOverlay';
import styles from './PdfReader.module.css';

/** 在文字层上命中已绘制的标注，只预览批注，不占用文字选择的鼠标事件。 */
export function PdfAnnotationTooltip({
  containerRef,
  items,
  enabled,
  revision
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  items: PdfAnnotation[];
  enabled: boolean;
  revision: number;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState<{ id: string; left: number; top: number } | null>(null);
  const item = enabled ? items.find(value => value.id === hover?.id && value.comment.trim()) : undefined;
  useEffect(() => {
    const container = containerRef.current;
    setHover(null);
    if (!container || !enabled) return;
    const clear = () => setHover(null);
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.buttons || !(event.target instanceof Element)) {
        clear();
        return;
      }
      const id = pdfAnnotationAtPoint(event.target, event.clientX, event.clientY);
      if (!id || !items.some(value => value.id === id && value.comment.trim())) {
        clear();
        return;
      }
      setHover({ id, left: event.clientX, top: event.clientY });
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear();
    };
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerleave', clear);
    container.addEventListener('pointerdown', clear);
    container.addEventListener('scroll', clear);
    container.addEventListener('keydown', keydown);
    return () => {
      container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerleave', clear);
      container.removeEventListener('pointerdown', clear);
      container.removeEventListener('scroll', clear);
      container.removeEventListener('keydown', keydown);
    };
  }, [containerRef, items, enabled, revision]);
  return (
    <TooltipTrigger
      isOpen={Boolean(item)}
      onOpenChange={open => {
        if (!open) setHover(null);
      }}
    >
      <span
        ref={anchorRef}
        aria-hidden="true"
        className={styles.commentAnchor}
        style={{ left: hover?.left ?? 0, top: hover?.top ?? 0 }}
      />
      <Tooltip
        triggerRef={anchorRef}
        placement="bottom start"
        offset={12}
        containerPadding={12}
        className={`${styles.annotationTone} ${styles.commentTooltip}`}
        data-kind={item?.kind}
      >
        {item ? (
          <>
            <strong>
              <span className={styles.commentDot} aria-hidden="true" />
              {KIND_OPTIONS.find(option => option.id === item.kind)?.label} · 批注
            </strong>
            <p>{item.comment}</p>
          </>
        ) : null}
      </Tooltip>
    </TooltipTrigger>
  );
}
