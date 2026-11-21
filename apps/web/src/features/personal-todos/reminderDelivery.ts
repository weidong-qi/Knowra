import { REMINDER_GRACE_MS, type Todo } from '@study-accelerator/web-core';

// v1 在显示前就写入，无法作为已经显示的凭据。各条 v2 回执单独写入，避免窗口间覆盖。
const SHOWN_PREFIX = 'knowra:todo-reminders:shown:v2:';
const CLAIM_PREFIX = 'knowra:todo-reminders:claim:';
const LEASE_MS = 120_000;

export const reminderKey = (todo: Todo) => `${todo.id}@${todo.reminder!.dueAt}`;

export function createReminderReceipts() {
  const shownHere = new Map<string, number>();

  function remember(key: string, time: number) {
    shownHere.set(key, time);
    try {
      localStorage.setItem(SHOWN_PREFIX + key, String(time));
    } catch {
      // 写满或不可用时，当前窗口仍保留已显示的事实。
    }
  }

  function has(key: string) {
    try {
      const stored = localStorage.getItem(SHOWN_PREFIX + key);
      if (stored !== null && Number(stored) > 0) {
        shownHere.set(key, Number(stored));
        return true;
      }
      const local = shownHere.get(key);
      if (local !== undefined) remember(key, local);
    } catch {
      // 仍可使用当前窗口已知的回执。
    }
    return shownHere.has(key);
  }

  // 只清理已经离开宽限期且服务端不再待投递的回执。未确认的回写仍可重试。
  function prune(todos: Todo[], now: number) {
    const pending = new Set(todos.filter(todo => todo.reminder?.state === 'pending').map(reminderKey));
    const expired = (key: string, time: number) => time < now - REMINDER_GRACE_MS && !pending.has(key);
    for (const [key, time] of shownHere) {
      if (expired(key, time)) shownHere.delete(key);
    }
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const name = localStorage.key(i);
        if (
          name?.startsWith(SHOWN_PREFIX) &&
          expired(name.slice(SHOWN_PREFIX.length), Number(localStorage.getItem(name)))
        ) {
          localStorage.removeItem(name);
        }
      }
    } catch {
      // 清理失败不影响投递。
    }
  }

  return { has, remember, prune };
}

/** 每个到期事项独立占用；窗口关闭会释放 Web Lock，下一次轮询即可接手。 */
export async function withReminderClaim<T>(
  key: string,
  signal: AbortSignal,
  run: () => Promise<T>
): Promise<T | undefined> {
  const name = CLAIM_PREFIX + key;
  try {
    if (navigator.locks) {
      return await navigator.locks.request(name, { ifAvailable: true }, lock => (lock ? run() : undefined));
    }
  } catch (error) {
    // 某些浏览器会暴露 locks 接口，但拒绝当前来源使用。
    if (!(error instanceof DOMException && error.name === 'SecurityError')) throw error;
  }
  if (signal.aborted) return;

  // HTTP 局域网预览等环境没有 Web Locks。临时租约独立于回执，关闭窗口后可过期接手。
  const token = Math.random().toString(36);
  const lease = () => `${Date.now() + LEASE_MS}:${token}`;
  let value = lease();
  try {
    const previous = localStorage.getItem(name);
    if (previous && parseInt(previous, 10) > Date.now()) return;
    localStorage.setItem(name, value);
    if (localStorage.getItem(name) !== value) return;
  } catch {
    return run();
  }
  const renew = window.setInterval(() => {
    try {
      if (localStorage.getItem(name) === value) {
        const next = lease();
        localStorage.setItem(name, next);
        value = next;
      }
    } catch {
      // 存储暂时不可写时保留原租约。
    }
  }, LEASE_MS / 3);
  const stopRenewal = () => window.clearInterval(renew);
  signal.addEventListener('abort', stopRenewal, { once: true });
  try {
    return await run();
  } finally {
    stopRenewal();
    signal.removeEventListener('abort', stopRenewal);
    try {
      if (localStorage.getItem(name) === value) localStorage.removeItem(name);
    } catch {
      // 无法释放的租约会到期。
    }
  }
}
