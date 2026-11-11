import { useEffect, useRef, useState } from 'react';
import { remindersMissed, remindersToDeliver, type Todo } from '@study-accelerator/web-core';
import { BellIcon } from '../../components/icons/knowra';
import { Button } from '../../components/ui';
import { useNavigate } from '../../app/router';
import { sharedTodoStore, type TodoStore } from './todoStore';
import styles from './PersonalTodos.module.css';

const DELIVERED_KEY = 'knowra:todo-reminders:delivered:v1';
const CHECK_MS = 30_000;
const REFRESH_MS = 5 * 60_000;

const reminderKey = (todo: Todo) => `${todo.id}@${todo.reminder?.dueAt ?? ''}`;

/** 本设备已投递过的提醒；多个窗口共享，避免同一设备重复弹出。读写失败时退回内存。 */
function deliveredLog() {
  let memory = new Set<string>();
  const read = () => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(DELIVERED_KEY) ?? '[]') as unknown;
      if (Array.isArray(parsed)) memory = new Set(parsed.filter((item): item is string => typeof item === 'string'));
    } catch {
      /* 存储不可用时只用内存记录。 */
    }
    return memory;
  };
  return {
    has: (key: string) => read().has(key),
    add(key: string) {
      const next = [...read(), key].slice(-200);
      memory = new Set(next);
      try {
        window.localStorage.setItem(DELIVERED_KEY, JSON.stringify(next));
      } catch {
        /* 同上。 */
      }
    }
  };
}

/** 本次检查需要投递和标为错过的提醒（纯函数，便于测试）。 */
export function planReminders(todos: Todo[], now: string, delivered: { has(key: string): boolean }) {
  return {
    deliver: remindersToDeliver(todos, now).filter(todo => !delivered.has(reminderKey(todo))),
    missed: remindersMissed(todos, now)
  };
}

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
  const [cards, setCards] = useState<Todo[]>([]);
  const busy = useRef(new Set<string>());
  const log = useRef(deliveredLog());
  // 回调放进 ref：父组件重渲染时不重建定时器。
  const deps = useRef({ notify, now });
  deps.current = { notify, now };
  useEffect(() => {
    let active = true;
    const check = async () => {
      const state = store.getState();
      if (state.status === 'idle') await store.load();
      if (!active || store.getState().status !== 'ready') return;
      const plan = planReminders(store.getState().todos, deps.current.now(), log.current);
      for (const todo of plan.missed) {
        const key = reminderKey(todo);
        if (busy.current.has(key)) continue;
        busy.current.add(key);
        await store
          .execute({ type: 'ackReminder', id: todo.id, dueAt: todo.reminder!.dueAt, outcome: 'missed' })
          .catch(() => undefined);
        busy.current.delete(key);
      }
      for (const todo of plan.deliver) {
        const key = reminderKey(todo);
        if (busy.current.has(key)) continue;
        busy.current.add(key);
        log.current.add(key);
        const shown = await deps.current.notify(todo);
        if (!shown && active) setCards(list => [...list.filter(item => item.id !== todo.id), todo]);
        await store
          .execute({ type: 'ackReminder', id: todo.id, dueAt: todo.reminder!.dueAt, outcome: 'fired' })
          .catch(() => undefined);
        busy.current.delete(key);
      }
    };
    void check();
    const checkTimer = window.setInterval(() => void check(), CHECK_MS);
    // 其他设备的修改经同步到达本机资料库后，定期重新读取。
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void store.load();
    }, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(checkTimer);
      window.clearInterval(refreshTimer);
    };
  }, [store]);
  if (!cards.length) return null;
  const dismiss = (id: string) => setCards(list => list.filter(item => item.id !== id));
  return (
    <div className={styles.reminderStack} role="region" aria-label="待办提醒">
      {cards.map(todo => (
        <div key={todo.id} className={styles.reminderCard} role="alert">
          <BellIcon size={16} />
          <strong>{todo.title}</strong>
          <span />
          <p>待办提醒</p>
          <div className={styles.reminderCardActions}>
            <Button size="mini" variant="ghost" onPress={() => dismiss(todo.id)}>
              知道了
            </Button>
            <Button
              size="mini"
              variant="primary"
              onPress={() => {
                dismiss(todo.id);
                navigate('/learning');
              }}
            >
              查看
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
