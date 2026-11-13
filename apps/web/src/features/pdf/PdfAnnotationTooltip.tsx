import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { Tooltip, TooltipTrigger } from '../../components/ui';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import { pdfAnnotationAtPoint } from './pdfOverlay';
import styles from './PdfReader.module.css';

const CLOSE_DELAY = 300;

type HoverAnchor = { id: string; left: number; top: number; width: number; height: number };

/** 同页多行标注共用一个锚点，不随鼠标在文字内移动。下划线同时包含整行命中区域。 */
function annotationAnchor(target: Element, id: string): HoverAnchor | null {
  const marks = target.closest('.page')?.querySelectorAll<SVGElement>('[data-pdf-annotation-id]');
  const boxes = [...(marks ?? [])]
    .filter(mark => mark.dataset.pdfAnnotationId === id)
    .map(mark => mark.getBoundingClientRect())
    .filter(box => box.right > box.left && box.bottom > box.top);
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map(box => box.left)),
    top = Math.min(...boxes.map(box => box.top));
  return {
    id,
    left,
    top,
    width: Math.max(...boxes.map(box => box.right)) - left,
    height: Math.max(...boxes.map(box => box.bottom)) - top
  };
}

function retainAnchor(current: HoverAnchor | null, next: HoverAnchor | null) {
  return current && next && Object.entries(next).every(([key, value]) => current[key as keyof HoverAnchor] === value)
    ? current
    : next;
}

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
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [hover, setHover] = useState<HoverAnchor | null>(null);
  const item = enabled ? items.find(value => value.id === hover?.id && value.comment.trim()) : undefined;
  const cancelClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);
  const clear = useCallback(() => {
    cancelClose();
    overAnnotation.current = false;
    overTooltip.current = false;
    lastPointer.current = null;
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
      const point = lastPointer.current;
      if (!point) return null;
      const target = document.elementFromPoint(point.x, point.y);
      return target && container.contains(target) && pdfAnnotationAtPoint(target, point.x, point.y) === current.id
        ? retainAnchor(current, annotationAnchor(target, current.id))
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
      lastPointer.current = { x: event.clientX, y: event.clientY };
      const id = pdfAnnotationAtPoint(event.target, event.clientX, event.clientY);
      if (!id || !items.some(value => value.id === id && value.comment.trim())) {
        leave();
        return;
      }
      cancelClose();
      overAnnotation.current = true;
      const anchor = annotationAnchor(event.target, id);
      setHover(current => retainAnchor(current, anchor));
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
        style={{
          left: hover?.left ?? 0,
          top: hover?.top ?? 0,
          width: hover?.width ?? 1,
          height: hover?.height ?? 1
        }}
      />
      <Tooltip
        ref={tooltipRef}
        triggerRef={anchorRef}
        placement="top start"
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
