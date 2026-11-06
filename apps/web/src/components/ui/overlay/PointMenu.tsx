import { useMemo, useRef, type ReactNode } from 'react';
import { MenuPopover } from './Menu';
import { Popover } from './Popover';
import styles from './PointMenu.module.css';

const VIEWPORT_PADDING = 12;
const ANCHOR_SIZE = 1;

function readViewport() {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight
  };
}

export interface PointMenuProps {
  point: { x: number; y: number } | null;
  onOpenChange(open: boolean): void;
  /** 浮层定位容器的额外类名，用于调整层级或关闭入场动画。 */
  popoverClassName?: string;
  /** 可选工作区边界，避免菜单伸入应用底部导航。 */
  boundaryElement?: Element;
  maxHeight?: number;
  /** 菜单由内层 Menu 绘制；操作面板复用通用 Popover 的背景、边框与阴影。 */
  surface?: 'menu' | 'popover';
  /** 阅读区操作面板可保持正文指针可用，允许继续选择或双击查词。 */
  isNonModal?: boolean;
  children: ReactNode;
}

/** 为鼠标右键或键盘菜单键提供屏幕坐标锚点，菜单视觉和交互仍由共享 Menu 提供。
 * 此容器不是 MenuTrigger，不会注入菜单选择后的关闭回调。
 * 内部 Menu（含子菜单）须显式接 onClose，或由既有 onAction 清除 point。
 */
export function PointMenu({
  point,
  onOpenChange,
  popoverClassName,
  boundaryElement,
  maxHeight,
  surface = 'menu',
  isNonModal,
  children
}: PointMenuProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  // 只在新坐标打开时规范化锚点；打开后的定位/resize仍由 RAC 管理。
  const viewport = useMemo(readViewport, [point]);
  // RAC 在主轴翻转时仍贴着锚点；边缘坐标须先落入同一安全区。
  const clamp = (value: number, start: number, size: number) => {
    const inset = Math.min(VIEWPORT_PADDING, Math.max(0, (size - ANCHOR_SIZE) / 2));
    return Math.min(Math.max(value, start + inset), start + size - inset - ANCHOR_SIZE);
  };
  const left = clamp(point?.x ?? 0, viewport.left, viewport.width);
  const top = clamp(point?.y ?? 0, viewport.top, viewport.height);
  const Container = surface === 'popover' ? Popover : MenuPopover;
  return (
    <>
      <span ref={anchorRef} className={styles.anchor} aria-hidden="true" style={{ left, top }} />
      <Container
        triggerRef={anchorRef}
        isOpen={Boolean(point)}
        isNonModal={isNonModal}
        onOpenChange={onOpenChange}
        offset={0}
        placement="bottom start"
        boundaryElement={boundaryElement}
        maxHeight={maxHeight}
        containerPadding={VIEWPORT_PADDING}
        className={popoverClassName}
      >
        {children}
      </Container>
    </>
  );
}
