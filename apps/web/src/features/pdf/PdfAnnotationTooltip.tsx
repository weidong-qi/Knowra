import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { Tooltip, TooltipTrigger } from '../../components/ui';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import { pdfAnnotationAtPoint } from './pdfOverlay';
import styles from './PdfReader.module.css';

const CLOSE_DELAY = 300;

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
  const tooltipRef = useRef<HTMLDivElement>(null);
  const overAnnotation = useRef(false);
  const overTooltip = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const [hover, setHover] = useState<{ id: string; left: number; top: number } | null>(null);
  const item = enabled ? items.find(value => value.id === hover?.id && value.comment.trim()) : undefined;
  const cancelClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);
  const clear = useCallback(() => {
    cancelClose();
    overAnnotation.current = false;
    overTooltip.current = false;
    setHover(null);
  }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    if (overAnnotation.current || overTooltip.current || closeTimer.current !== undefined) return;
    closeTimer.current = window.setTimeout(clear, CLOSE_DELAY);
  }, [clear]);
  useEffect(() => cancelClose, [cancelClose]);
  useEffect(() => {
    if (!item) clear();
  }, [item, clear]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) {
      clear();
      return;
    }
    // 文字层完成绘制可能晚于首次悬停；移入预览框后也应保留批注。
    setHover(current => {
      if (!current) return null;
      if (!items.some(value => value.id === current.id && value.comment.trim())) return null;
      if (overTooltip.current) return current;
      const target = document.elementFromPoint(current.left, current.top);
      return target &&
        container.contains(target) &&
        pdfAnnotationAtPoint(target, current.left, current.top) === current.id
        ? current
        : null;
    });
    const leave = () => {
      overAnnotation.current = false;
      scheduleClose();
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.buttons || !(event.target instanceof Element)) {
        clear();
        return;
      }
      const id = pdfAnnotationAtPoint(event.target, event.clientX, event.clientY);
      if (!id || !items.some(value => value.id === id && value.comment.trim())) {
        leave();
        return;
      }
      cancelClose();
      overAnnotation.current = true;
      setHover({ id, left: event.clientX, top: event.clientY });
    };
    const pointerdown = (event: PointerEvent) => {
      // 预览框通过 portal 渲染；拖动滚动条或选择批注文字时仍应保持打开。
      if (!(event.target instanceof Node) || !tooltipRef.current?.contains(event.target)) clear();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear();
    };
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerleave', leave);
    container.addEventListener('scroll', clear);
    document.addEventListener('pointerdown', pointerdown, true);
    document.addEventListener('keydown', keydown, true);
    return () => {
      container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerleave', leave);
      container.removeEventListener('scroll', clear);
      document.removeEventListener('pointerdown', pointerdown, true);
      document.removeEventListener('keydown', keydown, true);
    };
  }, [containerRef, items, enabled, revision, cancelClose, clear, scheduleClose]);
  return (
    <TooltipTrigger
      isOpen={Boolean(item)}
      onOpenChange={open => {
        if (!open) scheduleClose();
      }}
    >
      <span
        ref={anchorRef}
        aria-hidden="true"
        className={styles.commentAnchor}
        style={{ left: hover?.left ?? 0, top: hover?.top ?? 0 }}
      />
      <Tooltip
        ref={tooltipRef}
        triggerRef={anchorRef}
        placement="bottom start"
        offset={12}
        containerPadding={12}
        className={`${styles.annotationTone} ${styles.commentTooltip}`}
        data-kind={item?.kind}
        onPointerEnter={() => {
          overTooltip.current = true;
          cancelClose();
        }}
        onPointerLeave={() => {
          overTooltip.current = false;
          scheduleClose();
        }}
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
