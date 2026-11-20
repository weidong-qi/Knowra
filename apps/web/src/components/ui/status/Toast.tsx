// 全站统一右上角通知栏（Toast）：温润毛玻璃卡片风格，支持命令式调用与局部声明式归并。

import { forwardRef, useEffect, useId, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react';
import { BellIcon, CloseIcon, StatusDotIcon } from '../../icons/knowra';
import { Button, IconButton } from '../button';
import { cx } from '../classnames';
import type { StatusTone } from '../tokens';
import { ToastSwarmCheck } from './ToastSwarmCheck';
import styles from './Status.module.css';

export interface ToastAction {
  label: string;
  variant?: 'default' | 'primary' | 'ghost';
  onPress(): void;
}

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone?: StatusTone;
  icon?: ReactNode;
  actions?: ToastAction[];
  onDismiss?(): void;
  role?: 'status' | 'alert';
  /** 仅命令式 toast.show 生效：毫秒数，0 表示不自动关闭；默认 4500。 */
  duration?: number;
}

type Listener = () => void;

const MAX_IMPERATIVE_TOASTS = 5;

let viewportCount = 0;
let imperativeSeq = 0;
let imperativeList: ToastItem[] = [];
const regionMap = new Map<string, ToastItem[]>();
const timers = new Map<string, number>();

const viewportListeners = new Set<Listener>();
const presenceListeners = new Set<Listener>();

let cachedAll: ToastItem[] = [];

function rebuildCache() {
  const merged: ToastItem[] = [];
  for (const items of regionMap.values()) {
    for (const item of items) merged.push(item);
  }
  for (const item of imperativeList) merged.push(item);
  cachedAll = merged;
}

function emitViewport() {
  rebuildCache();
  for (const listener of viewportListeners) listener();
}

function emitPresence() {
  for (const listener of presenceListeners) listener();
}

function clearTimer(id: string) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function dismissImperative(id: string) {
  clearTimer(id);
  const next = imperativeList.filter(item => item.id !== id);
  if (next.length === imperativeList.length) return;
  imperativeList = next;
  emitViewport();
}

function showImperative(options: Omit<ToastItem, 'id'> & { id?: string }): string {
  const id = options.id ?? `toast_${++imperativeSeq}`;
  const duration = options.duration ?? 4500;
  clearTimer(id);
  const entry: ToastItem = {
    ...options,
    id,
    onDismiss: () => {
      options.onDismiss?.();
      dismissImperative(id);
    }
  };
  imperativeList = [entry, ...imperativeList.filter(item => item.id !== id)].slice(0, MAX_IMPERATIVE_TOASTS);
  emitViewport();
  if (duration > 0 && typeof window !== 'undefined') {
    timers.set(
      id,
      window.setTimeout(() => dismissImperative(id), duration)
    );
  }
  return id;
}

/** 命令式全局通知入口：用于操作反馈、复制提示、错误通知等全站统一右上角弹出。 */
export const toast = {
  show: showImperative,
  success: (title: string, options?: Omit<ToastItem, 'id' | 'title' | 'tone'> & { id?: string }) =>
    showImperative({ ...options, title, tone: 'success' }),
  info: (title: string, options?: Omit<ToastItem, 'id' | 'title' | 'tone'> & { id?: string }) =>
    showImperative({ ...options, title, tone: 'accent' }),
  warning: (title: string, options?: Omit<ToastItem, 'id' | 'title' | 'tone'> & { id?: string }) =>
    showImperative({ ...options, title, tone: 'warning' }),
  error: (title: string, options?: Omit<ToastItem, 'id' | 'title' | 'tone'> & { id?: string }) =>
    showImperative({ duration: 0, role: 'alert', ...options, title, tone: 'danger' }),
  dismiss: dismissImperative,
  clear: () => {
    for (const id of timers.keys()) clearTimer(id);
    imperativeList = [];
    emitViewport();
  }
};

const toneClass: Record<StatusTone, string> = {
  neutral: styles.toastNeutral,
  accent: styles.toastAccent,
  success: styles.toastSuccess,
  warning: styles.toastWarning,
  danger: styles.toastDanger
};

function DefaultToastIcon({ tone }: { tone: StatusTone }) {
  if (tone === 'success') return <ToastSwarmCheck size={22} />;
  if (tone === 'warning') return <BellIcon size={12} />;
  if (tone === 'danger') {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        aria-hidden="true"
      >
        <path d="M8 4.2v4.3" strokeLinecap="round" />
        <circle cx="8" cy="11.6" r="0.95" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return <StatusDotIcon size={10} />;
}

export interface ToastCardProps extends ToastItem {
  className?: string;
}

/** 温润毛玻璃通知卡：左侧状态圆标 + 标题/说明 + 右侧轻量操作与关闭按钮。 */
export const ToastCard = forwardRef<HTMLDivElement, ToastCardProps>(function ToastCard(
  { title, description, tone = 'neutral', icon, actions, onDismiss, role = 'status', className },
  ref
) {
  const singleLine = !description;
  return (
    <div
      ref={ref}
      role={role}
      data-single={singleLine || undefined}
      className={cx(styles.toastCard, toneClass[tone], className)}
    >
      <span className={styles.toastIcon} aria-hidden="true">
        {icon ?? <DefaultToastIcon tone={tone} />}
      </span>
      <div className={styles.toastBody}>
        <strong className={styles.toastTitle}>{title}</strong>
        {description ? <p className={styles.toastDescription}>{description}</p> : null}
      </div>
      {(actions && actions.length > 0) || onDismiss ? (
        <div className={styles.toastActions}>
          {actions?.map(action => (
            <Button
              key={action.label}
              size="mini"
              shape="square"
              variant={action.variant ?? 'ghost'}
              className={action.variant === 'primary' ? undefined : styles.toastActionBtn}
              onPress={action.onPress}
            >
              {action.label}
            </Button>
          ))}
          {onDismiss ? (
            <>
              {actions && actions.length > 0 ? <span className={styles.toastActionDivider} aria-hidden="true" /> : null}
              <IconButton
                size={24}
                className={styles.toastCloseBtn}
                aria-label="关闭通知"
                title="关闭"
                onPress={onDismiss}
              >
                <CloseIcon size={13} />
              </IconButton>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export function ToastStack({
  children,
  ariaLabel = '通知',
  className
}: {
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={cx(styles.toastViewport, className)} role="region" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

/** 全站唯一右上角通知视口，挂载在应用外壳顶层。 */
export function ToastViewport({ className }: { className?: string }) {
  useLayoutEffect(() => {
    viewportCount += 1;
    emitPresence();
    return () => {
      viewportCount = Math.max(0, viewportCount - 1);
      emitPresence();
    };
  }, []);

  const items = useSyncExternalStore(
    listener => {
      viewportListeners.add(listener);
      return () => viewportListeners.delete(listener);
    },
    () => cachedAll
  );

  if (!items.length) return null;
  return (
    <ToastStack className={className}>
      {items.map(item => (
        <ToastCard key={item.id} {...item} />
      ))}
    </ToastStack>
  );
}

function useHasToastViewport() {
  return useSyncExternalStore(
    listener => {
      presenceListeners.add(listener);
      return () => presenceListeners.delete(listener);
    },
    () => viewportCount > 0
  );
}

/**
 * 局部状态通知桥接组件：
 * - 若全局已挂载 ToastViewport，则自动并入全站右上角统一队列避免重叠；
 * - 若在独立单元测试等无外壳环境渲染，则直接就地渲染统一规范的 ToastStack。
 */
export function ToastRegion({
  items,
  ariaLabel = '通知',
  className
}: {
  items: ToastItem[];
  ariaLabel?: string;
  className?: string;
}) {
  const regionId = useId();
  const hasViewport = useHasToastViewport();

  useEffect(() => {
    if (!hasViewport) {
      if (regionMap.delete(regionId)) emitViewport();
      return;
    }
    if (items.length) regionMap.set(regionId, items);
    else regionMap.delete(regionId);
    emitViewport();
  }, [hasViewport, items, regionId]);

  useEffect(
    () => () => {
      if (regionMap.delete(regionId)) emitViewport();
    },
    [regionId]
  );

  if (hasViewport || !items.length) return null;
  return (
    <ToastStack ariaLabel={ariaLabel} className={className}>
      {items.map(item => (
        <ToastCard key={item.id} {...item} />
      ))}
    </ToastStack>
  );
}
