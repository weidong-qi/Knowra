import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
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
  revision,
  excludedIds = []
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  items: PdfAnnotation[];
  enabled: boolean;
  revision: number;
  excludedIds?: readonly string[];
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const overAnnotation = useRef(false);
  const overTooltip = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const moveFrame = useRef(0);
  const [size, setSize] = useState({ width: 300, height: 120 });
  const [hover, setHover] = useState<{ id: string; left: number; top: number } | null>(null);
  const item =
    enabled && !excludedIds.includes(hover?.id ?? '')
      ? items.find(value => value.id === hover?.id && value.comment?.trim())
      : undefined;
  const bounds = containerRef.current?.getBoundingClientRect();
  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip || !item) return;
    const measure = () => {
      const rect = tooltip.getBoundingClientRect();
      if (rect.width && rect.height)
        setSize(current =>
          current.width === rect.width && current.height === rect.height
            ? current
            : { width: rect.width, height: rect.height }
        );
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(tooltip);
    return () => observer?.disconnect();
  }, [item]);
  const left = Math.max(
    (bounds?.left ?? 0) + 12,
    Math.min((hover?.left ?? 0) + 12, Math.min(bounds?.right || window.innerWidth, window.innerWidth) - size.width - 12)
  );
  const top = Math.max(
    (bounds?.top ?? 0) + 12,
    Math.min(
      (hover?.top ?? 0) + 12,
      Math.min(bounds?.bottom || window.innerHeight, window.innerHeight) - size.height - 12
    )
  );
  const cancelClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);
  const clear = useCallback(() => {
    cancelClose();
    cancelAnimationFrame(moveFrame.current);
    overAnnotation.current = false;
    overTooltip.current = false;
    setHover(null);
  }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    if (overAnnotation.current || overTooltip.current || closeTimer.current !== undefined) return;
    closeTimer.current = window.setTimeout(clear, CLOSE_DELAY);
  }, [clear]);
  useEffect(
    () => () => {
      cancelClose();
      cancelAnimationFrame(moveFrame.current);
    },
    [cancelClose]
  );
  useEffect(() => {
    if (!item) clear();
  }, [item, clear]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) {
      clear();
      return;
    }
    const commentIds = new Set(items.filter(value => value.comment?.trim()).map(value => value.id));
    const commentAtPoint = (target: Element, x: number, y: number) =>
      pdfAnnotationAtPoint(target, x, y, id => commentIds.has(id));
    // 文字层完成绘制可能晚于首次悬停；移入预览框后也应保留批注。
    setHover(current => {
      if (!current) return null;
      if (!commentIds.has(current.id)) return null;
      if (overTooltip.current) return current;
      const target = document.elementFromPoint(current.left, current.top);
      return target && container.contains(target) && commentAtPoint(target, current.left, current.top) === current.id
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
      const id = commentAtPoint(event.target, event.clientX, event.clientY);
      if (!id) {
        leave();
        return;
      }
      cancelClose();
      overAnnotation.current = true;
      cancelAnimationFrame(moveFrame.current);
      moveFrame.current = requestAnimationFrame(() => setHover({ id, left: event.clientX, top: event.clientY }));
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
        style={{
          position: 'fixed',
          left,
          top,
          transform: 'none',
          maxWidth: Math.max(1, Math.min(300, (bounds?.width || window.innerWidth) - 24)),
          maxHeight: Math.max(1, Math.min(360, window.innerHeight * 0.6, (bounds?.height || window.innerHeight) - 24))
        }}
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
              {KIND_OPTIONS.find(option => option.id === item.kind)?.label} ·{' '}
              {item.type === 'note' ? item.title?.trim() || '便签' : '批注'}
            </strong>
            <p>{item.comment}</p>
          </>
        ) : null}
      </Tooltip>
    </TooltipTrigger>
  );
}
