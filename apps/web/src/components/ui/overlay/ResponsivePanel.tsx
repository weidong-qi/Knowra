import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { FocusScope } from 'react-aria/FocusScope';
import { useModalOverlay } from 'react-aria/useModalOverlay';
import { cx } from '../classnames';
import styles from './Overlay.module.css';

const NestedOverlayContext = createContext<(() => () => void) | null>(null);

/** 只在浮层内容实际挂载时登记；父面板不能在缩屏时盖住已经打开的子浮层。 */
export function NestedOverlay({ children }: { children: ReactNode }) {
  const register = useContext(NestedOverlayContext);
  const marker = useRef<HTMLSpanElement>(null);
  // Select 的 collection 也会在离线 template 内渲染 children；只登记实际进入文档的浮层。
  useLayoutEffect(() => marker.current?.isConnected ? register?.() : undefined, [register]);
  return register ? <><span ref={marker} hidden aria-hidden="true" />{children}</> : children;
}

/** 同一棵检查器子树跨断点保留草稿和进行中的任务，只切换模态行为与布局。 */
export function ResponsivePanel({ children, title, modal, isOpen, onClose, className }: {
  children: ReactNode;
  title: string;
  modal: boolean;
  isOpen: boolean;
  onClose(): void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const wasInspectorOpen = useRef(false);
  const [nestedCount, setNestedCount] = useState(0);
  const register = useCallback(() => {
    setNestedCount(count => count + 1);
    return () => setNestedCount(count => count - 1);
  }, []);
  const visibleModal = modal && isOpen;
  const active = visibleModal && nestedCount === 0;
  const { modalProps, underlayProps } = useModalOverlay({ isDismissable: true }, {
    isOpen: active, point: null, setPoint: () => {}, close: onClose, open: () => {}, toggle: onClose,
    setOpen: open => { if (!open) onClose(); }
  }, ref);

  useLayoutEffect(() => {
    if (isOpen && (!wasInspectorOpen.current || (visibleModal && !wasOpen.current && !returnFocus.current)) && nestedCount === 0) {
      const focused = ref.current?.ownerDocument.activeElement;
      if (focused instanceof HTMLElement && !ref.current?.contains(focused)) returnFocus.current = focused;
    }
    if (active && !wasOpen.current && ref.current && !ref.current.contains(ref.current.ownerDocument.activeElement)) {
      ref.current.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]')?.focus({ preventScroll: true });
    }
    wasOpen.current = visibleModal;
    wasInspectorOpen.current = isOpen;
  }, [active, visibleModal, nestedCount, isOpen]);
  // 等 useModalOverlay 清除背景 inert 后再归还焦点。
  useEffect(() => {
    if (!isOpen && returnFocus.current?.isConnected) {
      returnFocus.current.focus({ preventScroll: true });
      returnFocus.current = null;
    }
  }, [isOpen]);

  return <NestedOverlayContext.Provider value={register}>
    <FocusScope contain={visibleModal}>
      <div {...(active ? underlayProps : {})} className={visibleModal ? styles.underlay : styles.inlinePanel}>
        <div {...(active ? modalProps : {})} ref={ref} role={visibleModal ? 'dialog' : undefined}
          aria-label={visibleModal ? title : undefined} aria-modal={visibleModal || undefined}
          className={visibleModal ? cx(styles.dialog, styles.panelSize, className) : styles.inlinePanel}>
          {children}
        </div>
      </div>
    </FocusScope>
  </NestedOverlayContext.Provider>;
}
