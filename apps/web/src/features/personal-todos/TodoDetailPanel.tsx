import { useEffect, useState } from 'react';
import { dateWarnings, nextStep, progressOf, type Todo, type TodoIndex } from '@study-accelerator/web-core';
import { CalendarIcon, ClockIcon, CloseIcon, StarIcon } from '../../components/icons/knowra';
import { Badge, Button, DatePicker, IconButton, TextAreaField, TextField } from '../../components/ui';
import { useTodoActions } from './TodoActions';
import { TodoMenu } from './TodoRow';
import { ReminderEditor } from './ReminderEditor';
import { KIND_LABEL, contextPath, dueLabel, dueTone, statusLabel } from './todoPresentation';
import styles from './PersonalTodos.module.css';

const WARNING_TEXT = {
  plannedAfterAncestorDue: '计划日期晚于上级的截止日期。',
  dueAfterAncestorDue: '截止日期晚于上级的截止日期。',
  reminderAfterDue: '提醒时间晚于截止日期。'
} as const;

/** 失焦或回车时才保存，避免每次按键都产生一次同步修订。 */
function useDraft(value: string, onCommit: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return {
    value: draft,
    onChange: setDraft,
    onBlur: () => {
      if (draft !== value) onCommit(draft);
    }
  };
}

export function TodoDetailPanel({
  todo,
  index,
  onClose,
  onOpenMainline
}: {
  todo: Todo;
  index: TodoIndex;
  onClose(): void;
  onOpenMainline?(id: string): void;
}) {
  const actions = useTodoActions();
  const { today } = actions;
  const archived = Boolean(todo.archivedAt);
  const done = todo.status === 'done';
  const locked = archived;
  const title = useDraft(todo.title, next => {
    if (next.trim()) void actions.update(todo, { title: next });
  });
  const note = useDraft(todo.note, next => void actions.update(todo, { note: next }));
  const goal = useDraft(todo.goal, next => void actions.update(todo, { goal: next }));
  const path = contextPath(index, todo);
  const warnings = dateWarnings(index, todo);
  const children = index.children(todo.id);
  const progress = children.length ? progressOf(index, todo.id) : null;
  const step = todo.parentId === null && children.length ? nextStep(index, todo.id) : null;
  const tone = dueTone(todo, today);
  const statusTone = archived ? 'neutral' : done ? 'success' : todo.status === 'paused' ? 'warning' : 'accent';

  return (
    <aside className={styles.peek} aria-label={`待办详情：${todo.title}`}>
      <header className={styles.peekHeader}>
        <Badge tone="neutral" hideDot>
          {KIND_LABEL[todo.kind]}
        </Badge>
        <Badge tone={statusTone}>{statusLabel(todo)}</Badge>
        <span className={styles.peekHeaderActions}>
          {!locked ? (
            <IconButton
              size={24}
              aria-label={todo.starred ? '取消星标' : '加星标'}
              title={todo.starred ? '取消星标' : '加星标'}
              aria-pressed={todo.starred}
              onPress={() => void actions.update(todo, { starred: !todo.starred })}
            >
              <StarIcon size={15} className={todo.starred ? styles.starMark : undefined} />
            </IconButton>
          ) : null}
          <TodoMenu todo={todo} />
          <IconButton size={24} aria-label="关闭详情" title="关闭" onPress={onClose}>
            <CloseIcon size={16} />
          </IconButton>
        </span>
      </header>

      <div className={styles.peekBody}>
        <section className={styles.peekHeading}>
          {path.length ? <span className={styles.peekPath}>{path.join(' › ')}</span> : null}
          {locked ? (
            <h3 className={styles.peekTitleStatic}>{todo.title}</h3>
          ) : (
            <TextField
              label="名称"
              hideLabel
              appearance="bare"
              className={styles.peekTitleField}
              maxLength={200}
              {...title}
              onKeyDown={event => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
              }}
            />
          )}
          {todo.status === 'paused' && todo.pauseReason ? (
            <p className={styles.peekPause}>暂停原因：{todo.pauseReason}</p>
          ) : null}
          {archived ? <p className={styles.peekPause}>已归档，只能查看。</p> : null}
        </section>

        <section className={styles.peekSection}>
          <div className={styles.peekChips}>
            <div className={styles.peekChip}>
              <DatePicker
                label="计划日期"
                value={todo.plannedDate}
                today={today}
                placeholder="安排日期"
                icon={<CalendarIcon size={13} />}
                isDisabled={locked || done}
                onChange={plannedDate => void actions.update(todo, { plannedDate })}
              />
            </div>
            <div className={styles.peekChip}>
              <DatePicker
                label="截止日期"
                value={todo.dueDate}
                today={today}
                placeholder="设置截止"
                icon={<ClockIcon size={13} />}
                isDisabled={locked}
                tone={tone === 'overdue' ? 'danger' : tone === 'today' ? 'attention' : 'default'}
                onChange={dueDate => void actions.update(todo, { dueDate })}
              >
                {todo.dueDate ? `${todo.dueDate.slice(5).replace('-', '月')}日 · ${dueLabel(todo, today)}` : undefined}
              </DatePicker>
            </div>
            <div className={styles.peekChip}>
              <ReminderEditor
                key={`${todo.id}:${todo.revision}`}
                todo={todo}
                today={today}
                isDisabled={locked || done}
                onSave={reminder => actions.setReminder(todo, reminder)}
              />
            </div>
          </div>

          {progress ? (
            <div className={styles.peekProgressRow}>
              <span>直接下级进展</span>
              <strong>
                {progress.done}/{progress.total} 完成{progress.paused ? ` · ${progress.paused} 项暂停` : ''}
              </strong>
            </div>
          ) : null}

          {warnings.length ? (
            <ul className={styles.warningList}>
              {warnings.map(warning => (
                <li key={warning}>{WARNING_TEXT[warning]}</li>
              ))}
            </ul>
          ) : null}
        </section>

        {step && step.kind !== 'none' ? (
          <section className={styles.peekSection}>
            <h4>下一步</h4>
            <p className={styles.nextStepText}>
              {step.kind === 'confirmParent' ? `确认完成：${step.todo.title}` : step.todo.title}
            </p>
          </section>
        ) : null}

        {todo.kind === 'mainline' ? (
          <section className={styles.peekSection}>
            <TextAreaField
              label="目标与完成标准"
              placeholder="这条主线做到什么程度算完成？可以边做边补充。"
              rows={3}
              isDisabled={locked}
              className={styles.fullField}
              {...goal}
            />
          </section>
        ) : null}

        <section className={styles.peekSection}>
          <TextAreaField
            label="备注"
            placeholder="补充背景、思路或参考链接…"
            rows={5}
            isDisabled={locked}
            className={styles.fullField}
            {...note}
          />
        </section>
      </div>

      {!locked ? (
        <footer className={styles.peekFooter}>
          {done ? (
            <Button size="compact" onPress={() => actions.toggleDone(todo)}>
              重新打开
            </Button>
          ) : (
            <Button size="compact" variant="primary" onPress={() => actions.toggleDone(todo)}>
              标为完成
            </Button>
          )}
          {todo.status === 'active' ? (
            <Button size="compact" variant="ghost" onPress={() => actions.pause(todo)}>
              暂停
            </Button>
          ) : null}
          {todo.status === 'paused' && todo.pausedBy === 'self' ? (
            <Button size="compact" variant="ghost" onPress={() => actions.resume(todo)}>
              恢复
            </Button>
          ) : null}
          {todo.kind === 'mainline' && onOpenMainline ? (
            <Button size="compact" variant="ghost" onPress={() => onOpenMainline(todo.id)}>
              打开主线
            </Button>
          ) : null}
          {done && todo.parentId === null ? (
            <Button size="compact" variant="ghost" onPress={() => actions.archive(todo)}>
              归档…
            </Button>
          ) : null}
        </footer>
      ) : null}
    </aside>
  );
}
