// V4-04 Dialog
//
// 1. 焦点陷阱 / Esc 关闭 / 背景 inert / 关闭后焦点归还，全部交给 React Aria 的 ModalOverlay。
// 2. 业务代码通过 `<DialogClose>` 关闭 Dialog，或使用受控 `isOpen / onOpenChange`。
// 3. Dialog 内部通过 React Context 把 `close()` 暴露给 footer / body 内的按钮。

import { createContext, forwardRef, useContext, useMemo, type MouseEvent, type ReactNode } from 'react';
import {
  Dialog as RADialog,
  DialogTrigger as RADialogTrigger,
  Heading as RAHeading,
  Modal as RAModal,
  ModalOverlay as RAModalOverlay,
  type DialogProps as RADialogProps,
  type DialogTriggerProps as RADialogTriggerProps
} from 'react-aria-components';
import { Button } from '../button/Button';
import { SkeletonPulse } from '../status/SkeletonPulse';
import { DialogCloseIcon } from '../../icons/knowra';
import { cx } from '../classnames';
import type { ButtonVariant } from '../tokens';
import styles from './Overlay.module.css';
import { NestedOverlay } from './ResponsivePanel';
import { useScopedAppearance } from './ScopedAppearance';

interface DialogCloseContextValue {
  close(): void;
}

const DialogCloseContext = createContext<DialogCloseContextValue | null>(null);

/** 在 Dialog 子树内调用以取得 close()；在子树外使用会抛错。 */
export function useDialogClose(): DialogCloseContextValue {
  const ctx = useContext(DialogCloseContext);
  if (!ctx) {
    throw new Error('useDialogClose must be called inside <Dialog>.');
  }
  return ctx;
}

export interface DialogProps extends Omit<RADialogProps, 'className' | 'children'> {
  /** 必须：弹窗标题，给 screen reader 与视觉都使用。 */
  title: string;
  /** Dialog 容器内的内容（包含 body / footer）。 */
  children: ReactNode;
  className?: string;
  /** 是否在打开时禁用关闭（例如正在提交中）。 */
  isDismissable?: boolean;
  /** 提交中遮罩，会覆盖 body 内容。 */
  isPending?: boolean;
  /** 描述（同时给 aria-describedby）。 */
  description?: string;
  size?: 'sm' | 'md';
  /** 独立滚动面板，自带可见标题与关闭按钮。 */
  presentation?: 'dialog' | 'panel';
  /** 受控打开状态；与 DialogTrigger 不可同时使用。 */
  isOpen?: boolean;
  /** 受控状态变更回调（关闭、背景点击、Esc）。 */
  onOpenChange?: (open: boolean) => void;
}

export const Dialog = forwardRef<HTMLDivElement, DialogProps>(function Dialog(
  { title, children, className, isDismissable = true, isPending, description, isOpen, onOpenChange, size = 'sm', presentation = 'dialog', ...rest },
  ref
) {
  const sizeClass = presentation === 'panel' ? styles.panelSize : size === 'md' ? styles.sizeMd : styles.sizeSm;
  return (
    <ModalShell
      isDismissable={Boolean(isDismissable)}
      isPending={Boolean(isPending)}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      sizeClass={sizeClass}
    >
      <RADialog
        ref={ref}
        className={cx(styles.overlay, className)}
        aria-label={title}
        {...rest}
      >
        {({ close }) => (
          <NestedOverlay><DialogCloseContext.Provider value={{ close }}>
            {presentation !== 'panel' ? <header className={styles.header}>
              <RAHeading slot="title" className={styles.title}>{title}</RAHeading>
              {isDismissable ? (
                <DialogClose aria-label="关闭对话框" />
              ) : null}
            </header> : null}
            {description ? (
              <p className={styles.description}>{description}</p>
            ) : null}
            {children}
            {isPending ? (
              <div className={styles.busyOverlay} role="status" aria-label="提交中" aria-busy="true">
                <div className={styles.busyContent}>
                  <span className={styles.busyLabel} aria-hidden="true">正在处理…</span>
                  <SkeletonPulse className={styles.busySkeleton} />
                </div>
              </div>
            ) : null}
          </DialogCloseContext.Provider></NestedOverlay>
        )}
      </RADialog>
    </ModalShell>
  );
});

function ModalShell({
  isDismissable,
  isPending,
  isOpen,
  onOpenChange,
  sizeClass,
  children
}: {
  isDismissable: boolean;
  isPending: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  sizeClass: string;
  children: ReactNode;
}) {
  const appearance = useScopedAppearance();
  return (
    <RAModalOverlay
      {...appearance}
      isDismissable={Boolean(isDismissable) && !isPending}
      isKeyboardDismissDisabled={!isDismissable || isPending}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className={cx(styles.underlay, styles.overlay, appearance?.className)}
    >
      <RAModal className={cx(styles.dialog, sizeClass)}>{children}</RAModal>
    </RAModalOverlay>
  );
}

export type DialogTriggerProps = Omit<RADialogTriggerProps, 'children'> & {
  children: [ReactNode, ReactNode];
};

export function DialogTrigger({ children, ...rest }: DialogTriggerProps) {
  return <RADialogTrigger {...rest}>{children}</RADialogTrigger>;
}

export const DialogBody = forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(
  function DialogBody({ children, className }, ref) {
    return (
      <div ref={ref} className={cx(styles.body, className)}>
        {children}
      </div>
    );
  }
);

export const DialogFooter = forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(
  function DialogFooter({ children, className }, ref) {
    return (
      <div ref={ref} className={cx(styles.footer, className)}>
        {children}
      </div>
    );
  }
);

export interface DialogCloseProps {
  /** 视觉变体；与 Button 对齐 */
  variant?: ButtonVariant;
  /** 提交/保存中状态 */
  isPending?: boolean;
  /** 关闭后回调；典型用法：onClose={() => setOpen(false)} */
  onClose?: () => void;
  /** 显式传入 children 时渲染为业务按钮（保留外观并暴露 close 动作）。 */
  children?: ReactNode;
  className?: string;
  /** 任何附加的 ARIA 属性，仅图标形态（无 children）生效。 */
  'aria-label'?: string;
}

/** Dialog 子树内的可访问关闭按钮：
 * - 不传 `children` 时渲染为右上角 "×" 图标按钮（必须配 aria-label）；
 * - 传 `children` 时渲染为业务按钮，视觉复用 Button，关闭动作通过 React Context。 */
export const DialogClose = forwardRef<HTMLButtonElement, DialogCloseProps>(function DialogClose(
  { onClose, children, className, variant = 'default', isPending, ...rest },
  ref
) {
  const ctx = useContext(DialogCloseContext);
  if (!ctx) {
    throw new Error('<DialogClose> must be rendered inside <Dialog>.');
  }
  const handlePress = useMemo(
    () => () => {
      ctx.close();
      onClose?.();
    },
    [ctx, onClose]
  );

  if (children) {
    const ariaLabel = rest['aria-label'];
    return (
      <Button
        ref={ref}
        variant={variant}
        isPending={isPending}
        onPress={handlePress}
        className={className}
        aria-label={ariaLabel}
      >
        {children}
      </Button>
    );
  }

  const ariaLabel = rest['aria-label'] ?? '关闭对话框';
  return (
    <button
      ref={ref}
      type="button"
      className={cx(styles.close, className)}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        handlePress();
      }}
      aria-label={ariaLabel}
    >
      <DialogCloseIcon size={14} />
    </button>
  );
});
