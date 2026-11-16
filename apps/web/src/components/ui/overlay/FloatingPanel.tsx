import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type RefObject
} from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../button';
import { CloseIcon } from '../../icons/knowra';
import { cx } from '../classnames';
import { useScopedAppearance } from './ScopedAppearance';
import { clampFloatingPoint, type FloatingBounds, type FloatingPoint } from './floatingPanelGeometry';
import styles from './FloatingPanel.module.css';

export interface FloatingPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  point: FloatingPoint;
  boundaryRef?: RefObject<HTMLElement | null>;
  /** 递增时才聚焦内容；普通显示不改变当前焦点。 */
  focusRequest?: number;
  headerActions?: ReactNode;
  onPositionChange(point: FloatingPoint): void;
  onClose(): void;
}

/** 常驻非模态输入窗口：不遮挡背景、不锁焦点、不因失焦或滚动关闭。 */
export const FloatingPanel = forwardRef<HTMLDivElement, FloatingPanelProps>(function FloatingPanel(
  {
    title,
    point,
    boundaryRef,
    focusRequest = 0,
    headerActions,
    onPositionChange,
    onClose,
    children,
    className,
    style,
    ...rest
  },
  forwardedRef
) {
  const appearance = useScopedAppearance();
  const ref = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current!);
  const origin = useRef<Element | null>(document.activeElement);
  const drag = useRef<{ pointerId: number; x: number; y: number; point: FloatingPoint; handle: HTMLElement } | null>(
    null
  );
  const controls = useRef({ point, onPositionChange });
  controls.current = { point, onPositionChange };
  const readBounds = useCallback((): FloatingBounds => {
    const rect = boundaryRef?.current?.getBoundingClientRect();
    return rect?.width && rect.height
      ? rect
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }, [boundaryRef]);
  const [bounds, setBounds] = useState(readBounds);
  const [size, setSize] = useState({ width: 320, height: 220 });
  useLayoutEffect(() => {
    const update = () => {
      const next = readBounds();
      setBounds(current =>
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : { left: next.left, top: next.top, width: next.width, height: next.height }
      );
      const rect = ref.current?.getBoundingClientRect();
      if (rect?.width && rect.height)
        setSize(current =>
          current.width === rect.width && current.height === rect.height
            ? current
            : { width: rect.width, height: rect.height }
        );
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (ref.current) observer?.observe(ref.current);
    if (boundaryRef?.current) observer?.observe(boundaryRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [boundaryRef, readBounds]);
  const position = clampFloatingPoint(point, size, bounds);
  useLayoutEffect(() => {
    if (position.x !== point.x || position.y !== point.y) onPositionChange({ x: position.x, y: position.y });
  }, [point.x, point.y, position.x, position.y, onPositionChange]);
  useEffect(() => {
    if (!focusRequest) return;
    if (!ref.current?.contains(document.activeElement)) origin.current = document.activeElement;
    const input =
      ref.current?.querySelector<HTMLElement>('textarea, input') ??
      ref.current?.querySelector<HTMLElement>('[tabindex="0"]');
    input?.focus({ preventScroll: true });
  }, [focusRequest]);
  const cancelDrag = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    controls.current.onPositionChange(current.point);
    if (current.handle.hasPointerCapture?.(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
  }, []);
  useEffect(() => {
    const panel = ref.current;
    window.addEventListener('blur', cancelDrag);
    return () => {
      window.removeEventListener('blur', cancelDrag);
      drag.current = null;
      if (
        (panel?.contains(document.activeElement) || document.activeElement === document.body) &&
        origin.current instanceof HTMLElement &&
        origin.current.isConnected
      )
        origin.current.focus({ preventScroll: true });
    };
  }, [cancelDrag]);
  return createPortal(
    <div
      {...appearance}
      {...rest}
      ref={ref}
      role="dialog"
      aria-modal="false"
      className={cx(styles.panel, appearance?.className, className)}
      style={{
        ...style,
        position: 'fixed',
        left: bounds.left + position.x,
        top: bounds.top + position.y,
        maxWidth: Math.max(1, bounds.width - 24),
        maxHeight: Math.max(1, bounds.height - 24)
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (drag.current) cancelDrag();
          else onClose();
        }
      }}
    >
      <div
        className={styles.header}
        onPointerDown={event => {
          if (event.button !== 0 || (event.target as Element).closest('button, input, textarea, a')) return;
          event.preventDefault();
          event.stopPropagation();
          drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            point: controls.current.point,
            handle: event.currentTarget
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={event => {
          const current = drag.current;
          if (current?.pointerId === event.pointerId)
            onPositionChange(
              clampFloatingPoint(
                { x: current.point.x + event.clientX - current.x, y: current.point.y + event.clientY - current.y },
                size,
                bounds
              )
            );
        }}
        onPointerUp={event => {
          if (drag.current?.pointerId !== event.pointerId) return;
          drag.current = null;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
      >
        <div
          className={styles.handle}
          role="group"
          tabIndex={0}
          aria-label="移动批注窗口"
          onKeyDown={event => {
            const deltas: Record<string, number[]> = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1]
            };
            const delta = deltas[event.key];
            if (!delta) return;
            event.preventDefault();
            event.stopPropagation();
            const step = event.shiftKey ? 1 : 10;
            onPositionChange(
              clampFloatingPoint({ x: point.x + delta[0] * step, y: point.y + delta[1] * step }, size, bounds)
            );
          }}
        >
          {title}
        </div>
        {headerActions}
        <IconButton size={24} aria-label="关闭批注输入框" title="关闭批注输入框" onPress={onClose}>
          <CloseIcon size={14} />
        </IconButton>
      </div>
      <div className={styles.content}>{children}</div>
    </div>,
    document.body
  );
});
