import { useMemo, useState, type ReactNode } from 'react';
import {
  nextStep,
  planView,
  progressOf,
  todayView,
  topLevelTodos,
  type Todo,
  type TodoIndex,
  type TodoListFilter
} from '@study-accelerator/web-core';
import { ChevronDownIcon, ChevronRightIcon, ClockIcon, StarIcon } from '../../components/icons/knowra';
import { Button, EmptyArt, PressableButton, SegmentedButton, SegmentedControl } from '../../components/ui';
import { useTodoActions } from './TodoActions';
import { TodoRow } from './TodoRow';
import { TodoTree } from './TodoTree';
import { QuickAdd } from './QuickAdd';
import { dueLabel, dueTone, formatDateLabel, relativeDateLabel } from './todoPresentation';
import styles from './PersonalTodos.module.css';

interface PageProps {
  todos: Todo[];
  index: TodoIndex;
  selectedId: string | null;
}

function Group({
  title,
  count,
  children,
  actions,
  collapsible = true,
  defaultExpanded = true,
  tone,
  onExpandedChange
}: {
  title: string;
  count: number;
  children: ReactNode;
  actions?: ReactNode;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  tone?: 'alert';
  onExpandedChange?(expanded: boolean): void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const heading = (
    <>
      {collapsible ? <ChevronDownIcon size={14} /> : null}
      <strong>{title}</strong>
      <span>{count}</span>
    </>
  );
  return (
    <section className={styles.group} data-tone={tone}>
      <div className={styles.groupHeading}>
        {collapsible ? (
          <PressableButton
            className={styles.groupToggle}
            aria-expanded={expanded}
            onPress={() => {
              onExpandedChange?.(!expanded);
              setExpanded(!expanded);
            }}
          >
            {heading}
          </PressableButton>
        ) : (
          <div className={styles.groupToggle}>{heading}</div>
        )}
        {actions ? <span className={styles.groupActions}>{actions}</span> : null}
      </div>
      {expanded ? (
        <div role="list" className={styles.groupBody}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.empty} role="status">
      <EmptyArt className={styles.emptyArt} />
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

export function TodayPage({ todos, index, selectedId }: PageProps) {
  const actions = useTodoActions();
  const { today } = actions;
  const [todayExpanded, setTodayExpanded] = useState(true);
  const view = useMemo(() => {
    const base = todayView(todos, today);
    // 今日安排里的截止信息已在行内显示，提醒区只补充不在今日安排中的事项，避免同一事项出现两次。
    const scheduled = new Set(todayExpanded ? base.today.map(todo => todo.id) : []);
    return { ...base, dueAlerts: base.dueAlerts.filter(todo => !scheduled.has(todo.id)) };
  }, [todos, today, todayExpanded]);
  const nothing = !view.today.length && !view.earlier.length && !view.doneToday.length && !view.dueAlerts.length;
  return (
    <div className={styles.page}>
      <QuickAdd parentId={null} plannedDate={today} placeholder="添加今天要做的事（作为支线）" />
      {view.dueAlerts.length ? (
        <Group title="截止提醒" count={view.dueAlerts.length} collapsible={false} tone="alert">
          {view.dueAlerts.map(todo => (
            <TodoRow key={todo.id} todo={todo} index={index} selectedId={selectedId} showContext />
          ))}
        </Group>
      ) : null}
      {view.today.length ? (
        <Group title="今日安排" count={view.today.length} onExpandedChange={setTodayExpanded}>
          {view.today.map(todo => (
            <TodoRow key={todo.id} todo={todo} index={index} selectedId={selectedId} showContext />
          ))}
        </Group>
      ) : null}
      {view.earlier.length ? (
        <Group
          title="之前未完成"
          count={view.earlier.length}
          actions={
            <>
              <Button
                size="mini"
                variant="ghost"
                onPress={() => view.earlier.forEach(todo => actions.addToToday(todo))}
              >
                全部今天继续
              </Button>
              <Button size="mini" variant="ghost" onPress={() => view.earlier.forEach(todo => actions.clearPlan(todo))}>
                全部取消安排
              </Button>
            </>
          }
        >
          {view.earlier.map(todo => (
            <TodoRow key={todo.id} todo={todo} index={index} selectedId={selectedId} showContext />
          ))}
        </Group>
      ) : null}
      {view.doneToday.length ? (
        <Group title="今日已完成" count={view.doneToday.length}>
          {view.doneToday.map(todo => (
            <TodoRow key={todo.id} todo={todo} index={index} selectedId={selectedId} showContext />
          ))}
        </Group>
      ) : null}
      {nothing ? (
        <Empty title="今天还没有安排">
          在上方直接添加，或在主线、支线里给事项点「加入今天」。只设截止日期不会自动进入今天。
        </Empty>
      ) : null}
    </div>
  );
}

export function PlanPage({ todos, index, selectedId }: PageProps) {
  const { today } = useTodoActions();
  const groups = useMemo(() => planView(todos, today), [todos, today]);
  if (!groups.length)
    return (
      <div className={styles.page}>
        <Empty title="之后还没有安排">给事项设置计划日期后，会按日期出现在这里。</Empty>
      </div>
    );
  return (
    <div className={styles.page}>
      {groups.map(group => (
        <Group
          key={group.date}
          title={
            relativeDateLabel(group.date, today) === formatDateLabel(group.date, today)
              ? formatDateLabel(group.date, today)
              : `${relativeDateLabel(group.date, today)} · ${formatDateLabel(group.date, today)}`
          }
          count={group.todos.length}
        >
          {group.todos.map(todo => (
            <TodoRow key={todo.id} todo={todo} index={index} selectedId={selectedId} showContext />
          ))}
        </Group>
      ))}
    </div>
  );
}

const FILTERS: { id: TodoListFilter; label: string }[] = [
  { id: 'open', label: '进行中' },
  { id: 'paused', label: '已暂停' },
  { id: 'done', label: '已完成' },
  { id: 'archived', label: '已归档' }
];

export function ListFilters({
  filter,
  starredOnly,
  counts,
  onFilter,
  onStarred
}: {
  filter: TodoListFilter;
  starredOnly: boolean;
  counts: Record<TodoListFilter, number>;
  onFilter(filter: TodoListFilter): void;
  onStarred(value: boolean): void;
}) {
  return (
    <div className={styles.filters}>
      <SegmentedControl density="compact" aria-label="按状态筛选">
        {FILTERS.map(item => (
          <SegmentedButton
            key={item.id}
            aria-pressed={filter === item.id}
            count={counts[item.id]}
            onPress={() => onFilter(item.id)}
          >
            {item.label}
          </SegmentedButton>
        ))}
      </SegmentedControl>
      <SegmentedControl density="compact" aria-label="星标筛选">
        <SegmentedButton aria-pressed={starredOnly} onPress={() => onStarred(!starredOnly)}>
          <StarIcon size={13} /> 星标
        </SegmentedButton>
      </SegmentedControl>
    </div>
  );
}

function useListFilter(todos: Todo[], kind: 'mainline' | 'sideline') {
  const [filter, setFilter] = useState<TodoListFilter>('open');
  const [starredOnly, setStarredOnly] = useState(false);
  const counts = Object.fromEntries(
    FILTERS.map(item => [item.id, topLevelTodos(todos, kind, item.id, { starredOnly }).length])
  ) as Record<TodoListFilter, number>;
  return {
    items: topLevelTodos(todos, kind, filter, { starredOnly }),
    filters: (
      <ListFilters
        filter={filter}
        starredOnly={starredOnly}
        counts={counts}
        onFilter={setFilter}
        onStarred={setStarredOnly}
      />
    ),
    filter
  };
}

export function SidelinesPage({ todos, index, selectedId }: PageProps) {
  const list = useListFilter(todos, 'sideline');
  return (
    <div className={styles.page}>
      {list.filters}
      {list.filter === 'open' ? <QuickAdd parentId={null} kind="sideline" placeholder="随手记一件事" /> : null}
      <div role="list" className={styles.groupBody}>
        {list.items.map(todo => (
          <SidelineItem key={todo.id} todo={todo} index={index} selectedId={selectedId} />
        ))}
      </div>
      {!list.items.length ? (
        <Empty title={list.filter === 'open' ? '没有进行中的支线' : '这里还是空的'}>
          支线用来接住零散的小事，也可以拆成步骤；需要长期规划时可以升级为主线。
        </Empty>
      ) : null}
    </div>
  );
}

function SidelineItem({ todo, index, selectedId }: { todo: Todo; index: TodoIndex; selectedId: string | null }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <TodoRow
        todo={todo}
        index={index}
        selectedId={selectedId}
        expanded={expanded}
        onToggleExpanded={() => setExpanded(value => !value)}
      />
      {expanded ? (
        <TodoTree parent={todo} index={index} selectedId={selectedId} depth={1} allowAdd={!todo.archivedAt} />
      ) : null}
    </>
  );
}

export function MainlinesPage({ todos, index, onOpenMainline }: PageProps & { onOpenMainline(id: string): void }) {
  const list = useListFilter(todos, 'mainline');
  const { today } = useTodoActions();
  return (
    <div className={styles.page}>
      {list.filters}
      {list.filter === 'open' ? (
        <QuickAdd parentId={null} kind="mainline" placeholder="新建主线：一个能判断是否达成的目标" />
      ) : null}
      <div className={styles.mainlineGrid}>
        {list.items.map(todo => {
          const progress = progressOf(index, todo.id);
          const step = nextStep(index, todo.id);
          const tone = dueTone(todo, today);
          return (
            <PressableButton
              key={todo.id}
              className={styles.mainlineCard}
              data-status={todo.archivedAt ? 'archived' : todo.status}
              onPress={() => onOpenMainline(todo.id)}
              aria-label={`打开主线「${todo.title}」`}
            >
              <span className={styles.mainlineTop}>
                <strong>{todo.title}</strong>
                {todo.starred ? <StarIcon size={13} className={styles.starMark} /> : null}
              </span>
              {todo.goal ? <span className={styles.mainlineGoal}>{todo.goal}</span> : null}
              <span className={styles.mainlineNext}>
                {todo.status === 'paused'
                  ? `已暂停${todo.pauseReason ? ` · ${todo.pauseReason}` : ''}`
                  : step.kind === 'item'
                    ? `下一步：${step.todo.title}`
                    : step.kind === 'confirmParent'
                      ? `确认完成：${step.todo.title}`
                      : todo.status === 'done'
                        ? '已完成'
                        : progress.total
                          ? '剩余步骤都已暂停'
                          : '还没有拆解任务'}
              </span>
              <span className={styles.mainlineFoot}>
                <span className={styles.progressTrack} data-wide>
                  <span style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }} />
                </span>
                <span className={styles.mainlineCount}>
                  {progress.done}/{progress.total}
                </span>
                {tone ? (
                  <span className={styles.dueChip} data-tone={tone}>
                    <ClockIcon size={12} />
                    {dueLabel(todo, today)}
                  </span>
                ) : null}
              </span>
            </PressableButton>
          );
        })}
      </div>
      {!list.items.length ? (
        <Empty title={list.filter === 'open' ? '还没有主线' : '这里还是空的'}>
          主线承接有明确终点的目标，可以先记下目标，再边做边拆解。
        </Empty>
      ) : null}
    </div>
  );
}

export function MainlinePage({
  mainline,
  index,
  selectedId,
  onBack
}: {
  mainline: Todo;
  index: TodoIndex;
  selectedId: string | null;
  onBack(): void;
}) {
  const actions = useTodoActions();
  const { today } = actions;
  const progress = progressOf(index, mainline.id);
  const step = nextStep(index, mainline.id);
  const tone = dueTone(mainline, today);
  return (
    <div className={styles.doc}>
      <nav className={styles.docCrumb} aria-label="当前位置">
        <PressableButton className={styles.crumbLink} onPress={onBack}>
          主线
        </PressableButton>
        <ChevronRightIcon size={12} />
        <span>{mainline.title}</span>
      </nav>
      <h1 className={styles.docTitle}>
        <PressableButton className={styles.docTitleButton} onPress={() => actions.select(mainline.id)}>
          {mainline.title}
        </PressableButton>
      </h1>
      <div className={styles.docMeta}>
        <span className={styles.metaPill} data-status={mainline.archivedAt ? 'archived' : mainline.status}>
          {mainline.archivedAt
            ? '已归档'
            : mainline.status === 'done'
              ? '已完成'
              : mainline.status === 'paused'
                ? '已暂停'
                : '进行中'}
        </span>
        <span className={styles.metaText}>
          进展 {progress.done}/{progress.total}
        </span>
        {tone ? (
          <span className={styles.dueChip} data-tone={tone}>
            <ClockIcon size={12} />
            {dueLabel(mainline, today)}
          </span>
        ) : null}
        {mainline.starred ? <StarIcon size={13} className={styles.starMark} aria-label="已加星标" /> : null}
      </div>
      {mainline.goal ? <p className={styles.docGoal}>{mainline.goal}</p> : null}
      {step.kind !== 'none' && !mainline.archivedAt ? (
        <div className={styles.nextCard}>
          <span className={styles.nextLabel}>{step.kind === 'confirmParent' ? '可以收尾了' : '下一步'}</span>
          <strong>{step.kind === 'confirmParent' ? `确认完成：${step.todo.title}` : step.todo.title}</strong>
          {step.kind === 'item' && step.todo.plannedDate ? (
            <span className={styles.metaText}>计划 {relativeDateLabel(step.todo.plannedDate, today)}</span>
          ) : null}
          <span className={styles.nextActions}>
            {step.kind === 'item' && step.todo.plannedDate !== today ? (
              <Button size="compact" variant="ghost" onPress={() => actions.addToToday(step.todo)}>
                {step.todo.plannedDate && step.todo.plannedDate > today ? '改到今天' : '加入今天'}
              </Button>
            ) : null}
            <Button size="compact" variant="primary" onPress={() => actions.toggleDone(step.todo)}>
              {step.kind === 'confirmParent' ? '确认完成' : '完成'}
            </Button>
          </span>
        </div>
      ) : null}
      <div className={styles.docTree}>
        <TodoTree parent={mainline} index={index} selectedId={selectedId} addPlaceholder="添加任务" />
        {!index.children(mainline.id).length && mainline.archivedAt ? (
          <p className={styles.metaText}>这条主线没有拆解任务。</p>
        ) : null}
      </div>
    </div>
  );
}
