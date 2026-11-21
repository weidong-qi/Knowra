import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { remindersMissed, remindersToDeliver, type Todo } from '@study-accelerator/web-core';
import { ToastRegion, type ToastItem } from '../../components/ui';
import { useNavigate } from '../../app/router';
import { sharedTodoStore, type TodoStore } from './todoStore';
import { reminderKey, withReminderClaim } from './reminderDelivery';

const CHECK_MS = 30_000;
const REFRESH_MS = 5 * 60_000;

async function systemNotify(todo: Todo) {
  if (typeof window.knowraDesktop?.notify !== 'function') return false;
  try {
    return await window.knowraDesktop.notify({ title: '待办提醒', body: todo.title.slice(0, 200) });
  } catch {
    return false;
  }
}

/**
 * 全局提醒：应用打开期间定时检查。Mac 应用交给系统通知，网页或系统通知不可用时在应用内弹卡片。
 * 投递后回写「已提醒」并随同步传到其他设备；应用关闭期间到期的提醒在下次打开时标为错过，不补发。
 */
export function TodoReminderRunner({
  store = sharedTodoStore(),
  notify = systemNotify,
  now = () => new Date().toISOString()
}: {
  store?: TodoStore;
  notify?(todo: Todo): Promise<boolean>;
  now?(): string;
}) {
  const navigate = useNavigate();
  const [cards, setCards] = useState<{ todo: Todo; onShown(): void }[]>([]);
  const inFlight = useRef(new Set<string>());
  // 回调放进 ref：父组件重渲染时不重建定时器。
  const deps = useRef({ notify, now });
  deps.current = { notify, now };
  useEffect(() => {
    const lifetime = new AbortController();
    const waitingForCard = new Map<string, (shown: boolean) => void>();
    const showCard = (todo: Todo) =>
      new Promise<boolean>(resolve => {
        waitingForCard.get(todo.id)?.(false);
        waitingForCard.set(todo.id, resolve);
        const onShown = () => {
          if (waitingForCard.get(todo.id) === resolve) {
            waitingForCard.delete(todo.id);
            resolve(true);
          }
        };
        setCards(list => [...list.filter(card => card.todo.id !== todo.id), { todo, onShown }]);
      });
    const handleReminder = async (todo: Todo, planned: 'fired' | 'missed') => {
      const key = reminderKey(todo);
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      try {
        const outcome = await withReminderClaim(
          key,
          lifetime.signal,
          async (): Promise<'fired' | 'missed' | undefined> => {
            if (lifetime.signal.aborted) return;
            if (store.reminderReceipts.has(key)) return 'fired';
            if (planned === 'missed') return 'missed';
            const systemShown = await deps.current.notify(todo).catch(() => false);
            const shown = systemShown || (!lifetime.signal.aborted && (await showCard(todo)));
            if (!shown) return;
            store.reminderReceipts.remember(key, Date.now());
            return 'fired';
          }
        );
        if (outcome) {
          await store
            .execute({ type: 'ackReminder', id: todo.id, dueAt: todo.reminder!.dueAt, outcome })
            .catch(() => undefined);
        }
      } finally {
        inFlight.current.delete(key);
      }
    };
    const check = async () => {
      const state = store.getState();
      if (state.status === 'idle' || state.status === 'loading') await store.load();
      if (lifetime.signal.aborted || store.getState().status !== 'ready') return;
      const { todos } = store.getState();
      const now = deps.current.now();
      for (const todo of remindersToDeliver(todos, now)) void handleReminder(todo, 'fired');
      for (const todo of remindersMissed(todos, now)) void handleReminder(todo, 'missed');
    };
    void check();
    const checkTimer = window.setInterval(() => void check(), CHECK_MS);
    // 其他设备的修改经同步到达本机资料库后，定期重新读取。
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void store.load();
    }, REFRESH_MS);
    return () => {
      lifetime.abort();
      for (const resolve of waitingForCard.values()) resolve(false);
      waitingForCard.clear();
      window.clearInterval(checkTimer);
      window.clearInterval(refreshTimer);
    };
  }, [store]);
  const dismiss = useCallback((id: string) => setCards(list => list.filter(card => card.todo.id !== id)), []);
  const items = useMemo<ToastItem[]>(
    () =>
      cards.map(({ todo, onShown }) => ({
        onShown,
        id: `todo-reminder:${todo.id}`,
        title: todo.title,
        description: '待办提醒',
        tone: 'warning',
        role: 'alert',
        actions: [
          {
            label: '知道了',
            variant: 'ghost',
            onPress: () => dismiss(todo.id)
          },
          {
            label: '查看',
            variant: 'primary',
            onPress: () => {
              dismiss(todo.id);
              navigate('/learning');
            }
          }
        ]
      })),
    [cards, dismiss, navigate]
  );
  return <ToastRegion items={items} ariaLabel="待办提醒" />;
}
