import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PressableButton } from '../../components/ui/button';
import { Menu, MenuPopover, MenuTrigger } from '../../components/ui/overlay';

type MenuMode = 'closed' | 'hover' | 'pinned';
const HOVER_CLOSE_DELAY = 140;

/** 悬停临时打开，真实按压固定；浮层关闭原因不再由 hover 布尔量猜测。 */
export function EditorToolbarMenu({ label, children, disabled = false }: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<MenuMode>('closed');
  const modeRef = useRef<MenuMode>('closed');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pointerIntent = useRef<MenuMode | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const cancel = () => window.clearTimeout(timer.current);
  const transition = (next: MenuMode) => {
    cancel();
    modeRef.current = next;
    setMode(next);
  };
  const activatePointer = () => { if (!disabled) transition(pointerIntent.current ?? 'pinned'); };
  const scheduleClose = () => {
    cancel();
    if (modeRef.current !== 'hover') return;
    timer.current = window.setTimeout(() => {
      if (modeRef.current === 'hover') transition('closed');
    }, HOVER_CLOSE_DELAY);
  };
  useEffect(() => cancel, []);
  useEffect(() => {
    if (mode === 'closed') return;
    // 非模态浮层不接管页面指针；显式关闭外部按压，触发器与 portal 均属于本菜单。
    const onOutside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) transition('closed');
    };
    document.addEventListener('pointerdown', onOutside, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
    };
  }, [mode]);

  return <MenuTrigger isOpen={mode !== 'closed'} onOpenChange={next => transition(next ? 'pinned' : 'closed')}>
    <PressableButton ref={triggerRef} isDisabled={disabled}
      onKeyDown={event => { if (event.key === 'Escape') transition('closed'); }}
      onBlur={event => {
        // hover 后点击已打开的按钮时，焦点可能仍在触发器；Tab 离开也应关闭。
        // 菜单自身的 Escape、blur、子浮层焦点和归还由 React Aria 处理。
        if (event.relatedTarget instanceof Node && !popoverRef.current?.contains(event.relatedTarget)) transition('closed');
      }}
      onPointerDownCapture={event => {
        if (event.button === 0) pointerIntent.current = modeRef.current === 'pinned' ? 'closed' : 'pinned';
      }}
      onPointerCancel={() => { pointerIntent.current = null; }}
      onPressStart={event => {
        // RAC 可能先执行 open()；提前记录的按压意图不依赖该回调是否触发。
        if (event.pointerType !== 'touch' && event.pointerType !== 'keyboard') activatePointer();
      }}
      onPress={event => {
        if (event.pointerType !== 'keyboard') activatePointer();
        pointerIntent.current = null;
      }}
      onHoverStart={() => {
        cancel();
        if (!disabled && modeRef.current === 'closed') transition('hover');
      }}
      onHoverEnd={scheduleClose}>{label}</PressableButton>
    <MenuPopover ref={popoverRef} isNonModal shouldCloseOnInteractOutside={element => !triggerRef.current?.contains(element)}>
      <div onPointerEnter={cancel} onPointerLeave={scheduleClose}><Menu ariaLabel={`${label}菜单`}>{children}</Menu></div>
    </MenuPopover>
  </MenuTrigger>;
}
