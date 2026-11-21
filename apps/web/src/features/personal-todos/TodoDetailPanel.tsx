import { useEffect, useState } from 'react';
import {
  TODO_MAX_DEPTH,
  dateWarnings,
  nextStep,
  progressOf,
  type Todo,
  type TodoIndex
} from '@study-accelerator/web-core';
import {
  BellIcon,
  CalendarIcon,
  ClockIcon,
  CloseIcon,
  NodesIcon,
  StarIcon,
  TargetIcon
} from '../../components/icons/knowra';
import {
  Badge,
  Button,
  Checkbox,
  DatePicker,
  GroupedList,
  GroupedRow,
  GroupedSubRow,
  IconButton,
  Switch,
  TextAreaField,
  TextField
} from '../../components/ui';
import { ResponsivePanel } from '../../components/ui/overlay/ResponsivePanel';
import { useTodoActions } from './TodoActions';
import { TodoMenu } from './TodoRow';
import { ReminderEditor, reminderLabel } from './ReminderEditor';
import {
  KIND_LABEL,
  addDaysToDate,
  contextPath,
  dueLabel,
  dueTone,
  formatDateLabel,
  statusLabel
} from './todoPresentation';
import styles from './PersonalTodos.module.css';

type ExpandableRowId = 'planned' | 'due' | 'reminder';

const WARNING_TEXT = {
  plannedAfterAncestorDue: '计划日期晚于上级的截止日期。',
  dueAfterAncestorDue: '截止日期晚于上级的截止日期。',
  reminderAfterDue: '提醒时间晚于截止日期。'
} as const;

function formatSlashDate(value: string | null) {
  return value ? value.replace(/-/g, '/') : '选择日期';
}

function formatShortIsoDate(iso: string, today: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return formatDateLabel(key, today);
}

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
  const parent = todo.parentId ? index.byId.get(todo.parentId) : undefined;
  const warnings = dateWarnings(index, todo);
  const children = index.children(todo.id);
  const progress = children.length ? progressOf(index, todo.id) : null;
  const step = todo.parentId === null && children.length ? nextStep(index, todo.id) : null;
  const canMove = !locked && todo.kind !== 'mainline';
  const canPromote = !locked && todo.kind === 'sideline' && todo.parentId === null;
  const canAddChild = !locked && !done && index.depth(todo.id) < TODO_MAX_DEPTH;
  const tone = dueTone(todo, today);
  const statusTone = archived ? 'neutral' : done ? 'success' : todo.status === 'paused' ? 'warning' : 'accent';
  const hasReminder = Boolean(todo.reminder && todo.reminder.state !== 'cancelled');
  const activeReminderText = reminderLabel(todo, today);
  const tomorrow = addDaysToDate(today, 1);

  const [childDraft, setChildDraft] = useState('');
  const [creatingChild, setCreatingChild] = useState(false);
  const [expandedRow, setExpandedRow] = useState<ExpandableRowId | null>(null);
  const [compact, setCompact] = useState(
    () => window.matchMedia?.('(max-width: 900px), (any-pointer: coarse)').matches ?? false
  );
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 900px), (any-pointer: coarse)');
    if (!query) return;
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    setExpandedRow(null);
    setChildDraft('');
  }, [todo.id]);

  const toggleExpand = (rowId: ExpandableRowId) => {
    setExpandedRow(prev => (prev === rowId ? null : rowId));
  };

  const submitChild = async () => {
    const trimmed = childDraft.trim();
    if (!trimmed || !canAddChild || creatingChild) return;
    setCreatingChild(true);
    try {
      const created = await actions.create({ parentId: todo.id, title: trimmed });
      if (created) setChildDraft(current => (current === childDraft ? '' : current));
    } finally {
      setCreatingChild(false);
    }
  };

  const createdLabel = formatShortIsoDate(todo.createdAt, today);
  const completedLabel = todo.completedAt ? formatShortIsoDate(todo.completedAt, today) : '';

  const panel = (
    <aside className={styles.peek} aria-label={`待办详情：${todo.title}`}>
      <div className={styles.peekTop}>
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

        {path.length ? <span className={styles.peekPath}>{path.join(' › ')}</span> : null}

        <div className={styles.peekTitleBlock}>
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
          <TextAreaField
            label="备注"
            presentation="composer"
            placeholder="备注：补充背景、思路或参考链接…"
            rows={2}
            isDisabled={locked}
            className={styles.peekNoteInline}
            {...note}
          />
        </div>

        {todo.status === 'paused' && todo.pauseReason ? (
          <p className={styles.peekPause}>暂停原因：{todo.pauseReason}</p>
        ) : null}
        {archived ? <p className={styles.peekPause}>已归档，只能查看。</p> : null}
      </div>

      <div className={styles.peekBody}>
        <GroupedList title="日期与时间">
          <GroupedRow
            icon={<CalendarIcon size={16} />}
            label="日期"
            description={todo.plannedDate ? formatDateLabel(todo.plannedDate, today) : undefined}
            onPress={!locked && !done && todo.plannedDate ? () => toggleExpand('planned') : undefined}
            expanded={expandedRow === 'planned'}
            control={
              <Switch
                className={styles.peekSwitchCompact}
                isDisabled={locked || done}
                isSelected={Boolean(todo.plannedDate)}
                onChange={enabled => {
                  const next = enabled ? (todo.plannedDate ?? today) : null;
                  void actions.update(todo, { plannedDate: next });
                  setExpandedRow(enabled ? 'planned' : null);
                }}
              >
                <span className={styles.peekSrOnly}>启用计划日期</span>
              </Switch>
            }
          />
          {!locked && !done && todo.plannedDate && expandedRow === 'planned' ? (
            <GroupedSubRow className={styles.peekSubRowSplit}>
              <div className={styles.peekQuickDates}>
                <Button
                  size="mini"
                  variant={todo.plannedDate === today ? 'default' : 'ghost'}
                  onPress={() => actions.addToToday(todo)}
                >
                  今天
                </Button>
                <Button
                  size="mini"
                  variant={todo.plannedDate === tomorrow ? 'default' : 'ghost'}
                  onPress={() => actions.moveToTomorrow(todo)}
                >
                  明天
                </Button>
              </div>
              <DatePicker
                label="计划日期"
                value={todo.plannedDate}
                today={today}
                onChange={plannedDate => void actions.update(todo, { plannedDate })}
              >
                {formatSlashDate(todo.plannedDate)}
              </DatePicker>
            </GroupedSubRow>
          ) : null}

          <GroupedRow
            icon={<ClockIcon size={16} />}
            label="截止"
            description={
              todo.dueDate ? `${formatDateLabel(todo.dueDate, today)} · ${dueLabel(todo, today)}` : undefined
            }
            descriptionTone={tone === 'overdue' ? 'danger' : tone === 'today' ? 'attention' : 'default'}
            onPress={!locked && todo.dueDate ? () => toggleExpand('due') : undefined}
            expanded={expandedRow === 'due'}
            control={
              <Switch
                className={styles.peekSwitchCompact}
                isDisabled={locked}
                isSelected={Boolean(todo.dueDate)}
                onChange={enabled => {
                  const next = enabled ? (todo.dueDate ?? today) : null;
                  void actions.update(todo, { dueDate: next });
                  setExpandedRow(enabled ? 'due' : null);
                }}
              >
                <span className={styles.peekSrOnly}>启用截止日期</span>
              </Switch>
            }
          />
          {!locked && todo.dueDate && expandedRow === 'due' ? (
            <GroupedSubRow>
              <DatePicker
                label="截止日期"
                value={todo.dueDate}
                today={today}
                tone={tone === 'overdue' ? 'danger' : tone === 'today' ? 'attention' : 'default'}
                onChange={dueDate => void actions.update(todo, { dueDate })}
              >
                {formatSlashDate(todo.dueDate)}
              </DatePicker>
            </GroupedSubRow>
          ) : null}

          <GroupedRow
            icon={<BellIcon size={16} />}
            label="提醒"
            description={activeReminderText ?? undefined}
            descriptionTone={todo.reminder?.state === 'missed' ? 'danger' : 'default'}
            onPress={!locked && !done ? () => toggleExpand('reminder') : undefined}
            expanded={expandedRow === 'reminder'}
            control={
              <Switch
                className={styles.peekSwitchCompact}
                isDisabled={locked || done}
                isSelected={hasReminder}
                onChange={enabled => {
                  if (!enabled) {
                    void actions.setReminder(todo, null);
                    if (expandedRow === 'reminder') setExpandedRow(null);
                  } else {
                    setExpandedRow('reminder');
                  }
                }}
              >
                <span className={styles.peekSrOnly}>启用提醒</span>
              </Switch>
            }
          />
          {!locked && !done && expandedRow === 'reminder' ? (
            <GroupedSubRow>
              <ReminderEditor
                key={`${todo.id}:${todo.revision}`}
                todo={todo}
                today={today}
                isDisabled={locked || done}
                onSave={reminder => actions.setReminder(todo, reminder)}
              />
            </GroupedSubRow>
          ) : null}
        </GroupedList>

        {warnings.length ? (
          <ul className={styles.warningList}>
            {warnings.map(warning => (
              <li key={warning}>{WARNING_TEXT[warning]}</li>
            ))}
          </ul>
        ) : null}

        {children.length > 0 || canAddChild ? (
          <GroupedList title="子步骤">
            {progress ? (
              <div className={styles.peekProgressCard}>
                <div className={styles.peekProgressRow}>
                  <span>直接下级进展</span>
                  <strong>
                    {progress.done}/{progress.total} 完成{progress.paused ? ` · ${progress.paused} 项暂停` : ''}
                  </strong>
                </div>
                <div className={styles.peekProgressTrack} aria-hidden="true">
                  <div
                    className={styles.peekProgressBar}
                    style={{
                      width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`
                    }}
                  />
                </div>
                {step && step.kind !== 'none' ? (
                  <div className={styles.peekNextStepRow}>
                    <span>下一步</span>
                    <strong>{step.kind === 'confirmParent' ? `确认完成：${step.todo.title}` : step.todo.title}</strong>
                  </div>
                ) : null}
              </div>
            ) : null}

            {children.length ? (
              <ul className={styles.peekChildList} aria-label="直接子步骤">
                {children.map(child => {
                  const childDone = child.status === 'done';
                  return (
                    <li key={child.id} className={styles.peekChildRow}>
                      <Checkbox
                        size="compact"
                        aria-label={`完成子步骤：${child.title}`}
                        isSelected={childDone}
                        isDisabled={locked || Boolean(child.archivedAt)}
                        onChange={() => actions.toggleDone(child)}
                      />
                      <button
                        type="button"
                        className={styles.peekChildTitle}
                        data-done={childDone || undefined}
                        onClick={() => actions.select(child.id)}
                      >
                        {child.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {canAddChild ? (
              <div className={styles.peekChildAdd}>
                <TextField
                  label="添加子步骤"
                  hideLabel
                  appearance="bare"
                  placeholder="+ 添加子步骤，回车创建"
                  maxLength={200}
                  value={childDraft}
                  onChange={setChildDraft}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void submitChild();
                    }
                  }}
                />
              </div>
            ) : null}
          </GroupedList>
        ) : null}

        <GroupedList title="组织">
          <GroupedRow
            icon={<NodesIcon size={16} />}
            label="所属上级"
            description={parent ? parent.title : '无（独立）'}
            onPress={canMove ? () => actions.move(todo) : undefined}
            control={
              canMove ? (
                <Button size="mini" variant="ghost" onPress={() => actions.move(todo)}>
                  移动
                </Button>
              ) : undefined
            }
          />
          {canPromote ? (
            <GroupedRow
              icon={<TargetIcon size={16} />}
              label="主线"
              description="升级为独立主线任务"
              control={
                <Button size="mini" variant="ghost" onPress={() => actions.promote(todo)}>
                  升格
                </Button>
              }
            />
          ) : null}
        </GroupedList>

        {todo.kind === 'mainline' ? (
          <GroupedList title="目标与完成标准">
            <div className={styles.peekGoalCard}>
              <TextAreaField
                label="目标与完成标准"
                presentation="composer"
                placeholder="这条主线做到什么程度算完成？可以边做边补充。"
                rows={3}
                isDisabled={locked}
                {...goal}
              />
            </div>
          </GroupedList>
        ) : null}

        {createdLabel ? (
          <p className={styles.peekMetaFooter}>
            创建于 {createdLabel}
            {completedLabel ? ` · 完成于 ${completedLabel}` : ''}
          </p>
        ) : null}
      </div>

      {!locked ? (
        <footer className={styles.peekFooter}>
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
          {done ? (
            <Button size="compact" onPress={() => actions.toggleDone(todo)}>
              重新打开
            </Button>
          ) : (
            <Button size="compact" variant="primary" onPress={() => actions.toggleDone(todo)}>
              标为完成
            </Button>
          )}
        </footer>
      ) : null}
    </aside>
  );

  return (
    <ResponsivePanel
      title={`待办详情：${todo.title}`}
      modal={compact}
      className={styles.peekDialog}
      isOpen
      onClose={onClose}
    >
      {panel}
    </ResponsivePanel>
  );
}
