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
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  StarIcon
} from '../../components/icons/knowra';
import {
  Badge,
  Button,
  EmptyArt,
  EmptyState,
  IconButton,
  PressableButton,
  SegmentedButton,
  SegmentedControl
} from '../../components/ui';
import { useTodoActions } from './TodoActions';
import { TodoMenu, TodoRow } from './TodoRow';
import { TodoTree } from './TodoTree';
import { QuickAdd } from './QuickAdd';
import {
  addDaysToDate,
  dueLabel,
  dueTone,
  formatDateLabel,
  mainlineAccentColor,
  mondayOfWeek,
  relativeDateLabel,
  weekDaysFrom
} from './todoPresentation';
import styles from './PersonalTodos.module.css';

interface PageProps {
  todos: Todo[];
  index: TodoIndex;
  selectedId: string | null;
}

function ProgressRing({
  done,
  total,
  size = 20,
  color
}: {
  done: number;
  total: number;
  size?: number;
  color?: string;
}) {
  const pct = total ? done / total : 0;
  const stroke = 2.4;
  const r = (size - stroke * 1.5) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={styles.progressRing} aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.16"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color ?? 'var(--ni-accent)'}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

function Group({
  title,
  count,
  children,
  actions,
  collapsible = true,
  defaultExpanded = true,
  tone,
  onExpandedChange,
  expanded: controlledExpanded
}: {
  title: string;
  count: number;
  children: ReactNode;
  actions?: ReactNode;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  tone?: 'alert';
  onExpandedChange?(expanded: boolean): void;
  expanded?: boolean;
}) {
  const [localExpanded, setExpanded] = useState(defaultExpanded);
  const expanded = controlledExpanded ?? localExpanded;
  const heading = (
    <>
      {collapsible ? <ChevronDownIcon size={14} /> : null}
      <strong>{title}</strong>
      <span className={styles.groupCount}>{count}</span>
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
  const openMainlines = useMemo(() => topLevelTodos(todos, 'mainline', 'open'), [todos]);
  const nothing = !view.today.length && !view.earlier.length && !view.doneToday.length && !view.dueAlerts.length;
  const quickAddNode = (
    <QuickAdd parentId={null} plannedDate={today} mainlines={openMainlines} placeholder="添加今天要做的事" />
  );

  return (
    <div className={styles.page}>
      {view.dueAlerts.length ? (
        <Group title="截止提醒" count={view.dueAlerts.length} collapsible={false} tone="alert">
          {view.dueAlerts.map(todo => (
            <TodoRow key={todo.id} todo={todo} index={index} selectedId={selectedId} showContext showCarryoverActions />
          ))}
        </Group>
      ) : null}

      {view.today.length ? (
        <Group title="今日安排" count={view.today.length} expanded={todayExpanded} onExpandedChange={setTodayExpanded}>
          {view.today.map(todo => (
            <TodoRow key={todo.id} todo={todo} index={index} selectedId={selectedId} showContext />
          ))}
        </Group>
      ) : null}

      {!view.today.length || todayExpanded ? (
        <div className={styles.standaloneQuickAdd} data-attached={view.today.length > 0 || undefined}>
          {quickAddNode}
        </div>
      ) : null}

      {view.earlier.length ? (
        <Group
          title="之前未完成"
          count={view.earlier.length}
          actions={
            <>
              <Button
                size="mini"
                shape="square"
                variant="ghost"
                onPress={() => view.earlier.forEach(todo => actions.addToToday(todo))}
              >
                全部今天继续
              </Button>
              <Button
                size="mini"
                shape="square"
                variant="ghost"
                onPress={() => view.earlier.forEach(todo => actions.clearPlan(todo))}
              >
                全部取消安排
              </Button>
            </>
          }
        >
          {view.earlier.map(todo => (
            <TodoRow key={todo.id} todo={todo} index={index} selectedId={selectedId} showContext showCarryoverActions />
          ))}
        </Group>
      ) : null}

      {view.doneToday.length ? (
        <Group title="今日已完成" count={view.doneToday.length} defaultExpanded={false}>
          {view.doneToday.map(todo => (
            <TodoRow key={todo.id} todo={todo} index={index} selectedId={selectedId} showContext />
          ))}
        </Group>
      ) : null}

      {nothing ? (
        <EmptyState
          className={styles.empty}
          icon={<EmptyArt className={styles.emptyArt} />}
          title="今天还没有安排"
          description="在上方直接添加，或在主线、支线里给事项点「加入今天」。只设截止日期不会自动进入今天。"
        />
      ) : null}
    </div>
  );
}

export function PlanPage({
  todos,
  index,
  selectedId,
  mode = 'list',
  weekOffset: controlledWeekOffset,
  onWeekOffsetChange,
  selectedDate: controlledSelectedDate,
  onSelectDate
}: PageProps & {
  mode?: 'list' | 'board';
  weekOffset?: number;
  onWeekOffsetChange?(next: number): void;
  selectedDate?: string | null;
  onSelectDate?(date: string | null): void;
}) {
  const actions = useTodoActions();
  const { today } = actions;
  const [uncontrolledWeekOffset, setUncontrolledWeekOffset] = useState(0);
  const weekOffset = controlledWeekOffset !== undefined ? controlledWeekOffset : uncontrolledWeekOffset;
  const setWeekOffset = (next: number) => {
    if (onWeekOffsetChange) onWeekOffsetChange(next);
    else setUncontrolledWeekOffset(next);
  };
  const [uncontrolledSelectedDate, setUncontrolledSelectedDate] = useState<string | null>(null);
  const selectedDate = controlledSelectedDate !== undefined ? controlledSelectedDate : uncontrolledSelectedDate;
  const setSelectedDate = (next: string | null | ((prev: string | null) => string | null)) => {
    const resolved = typeof next === 'function' ? next(selectedDate) : next;
    if (onSelectDate) onSelectDate(resolved);
    else setUncontrolledSelectedDate(resolved);
  };

  const thisMonday = useMemo(() => mondayOfWeek(today), [today]);
  const weekMonday = useMemo(() => addDaysToDate(thisMonday, weekOffset * 7), [thisMonday, weekOffset]);
  const days = useMemo(() => weekDaysFrom(weekMonday, today), [weekMonday, today]);

  const groups = useMemo(() => planView(todos, today), [todos, today]);
  const todayBase = useMemo(() => todayView(todos, today), [todos, today]);

  const allPlannedByDate = useMemo(() => {
    const map = new Map<string, Todo[]>();
    for (const todo of todayBase.today) {
      const list = map.get(today) ?? [];
      list.push(todo);
      map.set(today, list);
    }
    for (const group of groups) {
      map.set(group.date, group.todos);
    }
    return map;
  }, [groups, todayBase.today, today]);

  const visibleGroups = useMemo(() => {
    if (!selectedDate) return groups;
    if (selectedDate === today) return todayBase.today.length ? [{ date: today, todos: todayBase.today }] : [];
    return groups.filter(group => group.date === selectedDate);
  }, [groups, selectedDate, today, todayBase.today]);

  const boardDays = useMemo(() => days.filter(day => !day.isPast).slice(0, 4), [days]);

  const weekStrip = (
    <div className={styles.weekStripWrap}>
      <IconButton
        size={28}
        aria-label="上一周"
        title="上一周"
        isDisabled={weekOffset === 0}
        onPress={() => {
          setWeekOffset(Math.max(0, weekOffset - 1));
          setSelectedDate(null);
        }}
      >
        <ChevronLeftIcon size={15} />
      </IconButton>

      <div className={styles.weekGrid} role="group" aria-label="选择一周内的日期">
        {days.map(day => {
          const dayItems = allPlannedByDate.get(day.date) ?? [];
          const isSelected = selectedDate ? selectedDate === day.date : day.isToday;
          const dots = dayItems.slice(0, 3).map(item => {
            const chain = index.ancestors(item.id);
            const root = chain.length ? chain[chain.length - 1]! : item;
            return root.kind === 'mainline' ? mainlineAccentColor(root.id) : 'var(--ni-ink-3)';
          });
          return (
            <div key={day.date} className={styles.weekCell}>
              <PressableButton
                className={styles.dayPill}
                isDisabled={day.isPast}
                data-selected={isSelected || undefined}
                data-today={day.isToday || undefined}
                data-past={day.isPast || undefined}
                aria-pressed={selectedDate === day.date}
                aria-label={`${formatDateLabel(day.date, today)}，${dayItems.length} 项安排`}
                onPress={() => {
                  if (day.isPast) return;
                  setSelectedDate(prev => (prev === day.date ? null : day.date));
                }}
              >
                <span className={styles.dayWeek}>{day.week}</span>
                <span className={styles.dayNum}>{day.day}</span>
                <span className={styles.dayDots} aria-hidden="true">
                  {dots.map((color, idx) => (
                    <span
                      key={idx}
                      className={styles.dayDot}
                      style={{ background: isSelected ? 'currentColor' : color }}
                    />
                  ))}
                </span>
              </PressableButton>
            </div>
          );
        })}
      </div>

      <IconButton
        size={28}
        aria-label="下一周"
        title="下一周"
        onPress={() => {
          setWeekOffset(weekOffset + 1);
          setSelectedDate(null);
        }}
      >
        <ChevronRightIcon size={15} />
      </IconButton>
    </div>
  );

  if (mode === 'board') {
    return (
      <div className={styles.page}>
        {weekStrip}
        <div className={styles.planBoard}>
          {boardDays.map(day => {
            const items = allPlannedByDate.get(day.date) ?? [];
            return (
              <section key={day.date} className={styles.boardCol} aria-label={formatDateLabel(day.date, today)}>
                <header className={styles.boardColHead}>
                  <strong>
                    {relativeDateLabel(day.date, today) === formatDateLabel(day.date, today)
                      ? formatDateLabel(day.date, today)
                      : `${relativeDateLabel(day.date, today)} · ${day.day}日`}
                  </strong>
                  <span>{items.length}</span>
                </header>
                <div className={styles.boardColBody}>
                  {items.length ? (
                    items.map(todo => {
                      const chain = index.ancestors(todo.id);
                      const root = chain.length ? chain[chain.length - 1]! : null;
                      const dotColor = root && root.kind === 'mainline' ? mainlineAccentColor(root.id) : null;
                      return (
                        <PressableButton
                          key={todo.id}
                          className={styles.boardCard}
                          data-selected={selectedId === todo.id || undefined}
                          onPress={() => actions.select(todo.id)}
                        >
                          <span className={styles.boardCardTitle}>{todo.title}</span>
                          {chain.length ? (
                            <span className={styles.boardCardMeta}>
                              <span
                                className={styles.contextDot}
                                style={dotColor ? ({ '--dot-color': dotColor } as React.CSSProperties) : undefined}
                              />
                              <span>
                                {chain
                                  .map(n => n.title)
                                  .reverse()
                                  .join(' › ')}
                              </span>
                            </span>
                          ) : null}
                        </PressableButton>
                      );
                    })
                  ) : (
                    <p className={styles.boardEmpty}>暂无安排</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {weekStrip}
      {visibleGroups.length ? (
        visibleGroups.map(group => (
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
        ))
      ) : (
        <EmptyState
          className={styles.empty}
          icon={<CalendarIcon size={28} />}
          title={selectedDate ? `${relativeDateLabel(selectedDate, today)}还没有安排` : '之后还没有安排'}
          description={
            selectedDate
              ? '可以点击「显示全部计划」，或在待办详情里把事项安排到这一天。'
              : '给事项设置计划日期后，会按日期出现在这里。'
          }
        />
      )}
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
      <div role="list" className={styles.groupBody}>
        {list.items.map(todo => (
          <SidelineItem key={todo.id} todo={todo} index={index} selectedId={selectedId} />
        ))}
      </div>
      {list.filter === 'open' ? (
        <div className={styles.standaloneQuickAdd}>
          <QuickAdd parentId={null} kind="sideline" placeholder="随手记一件事" />
        </div>
      ) : null}
      {!list.items.length ? (
        <EmptyState
          className={styles.empty}
          icon={<EmptyArt className={styles.emptyArt} />}
          title={list.filter === 'open' ? '没有进行中的支线' : '这里还是空的'}
          description="支线用来接住零散的小事，也可以拆成步骤；需要长期规划时可以升级为主线。"
        />
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
      <div className={styles.mainlineGrid}>
        {list.items.map(todo => {
          const progress = progressOf(index, todo.id);
          const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
          const step = nextStep(index, todo.id);
          const tone = dueTone(todo, today);
          const color = mainlineAccentColor(todo.id);
          return (
            <div
              key={todo.id}
              className={styles.mainlineCardWrap}
              data-status={todo.archivedAt ? 'archived' : todo.status}
            >
              <PressableButton
                className={styles.mainlineCard}
                onPress={() => onOpenMainline(todo.id)}
                aria-label={`打开主线「${todo.title}」`}
              >
                <span className={styles.mainlineTop}>
                  <ProgressRing done={progress.done} total={progress.total} size={24} color={color} />
                  <strong>{todo.title}</strong>
                  {todo.starred ? <StarIcon size={13} className={styles.starMark} /> : null}
                </span>
                {todo.goal ? <span className={styles.mainlineGoal}>{todo.goal}</span> : null}
                <span className={styles.mainlineNext}>
                  {todo.status === 'paused' ? (
                    `已暂停${todo.pauseReason ? ` · ${todo.pauseReason}` : ''}`
                  ) : step.kind === 'item' ? (
                    <>
                      <span style={{ color }}>下一步：</span>
                      {step.todo.title}
                    </>
                  ) : step.kind === 'confirmParent' ? (
                    `确认完成：${step.todo.title}`
                  ) : todo.status === 'done' ? (
                    '已完成'
                  ) : progress.total ? (
                    '剩余步骤都已暂停'
                  ) : (
                    '还没有拆解任务'
                  )}
                </span>
                <span className={styles.mainlineFoot}>
                  <span className={styles.mainlineCount}>
                    进度 {progress.done}/{progress.total}（{pct}%）
                  </span>
                  {tone ? (
                    <Badge tone={tone === 'overdue' ? 'danger' : tone === 'today' ? 'warning' : 'neutral'} hideDot>
                      <ClockIcon size={11} />
                      {dueLabel(todo, today)}
                    </Badge>
                  ) : null}
                </span>
              </PressableButton>
              <div className={styles.mainlineCardMenu}>
                <TodoMenu todo={todo} />
              </div>
            </div>
          );
        })}
      </div>
      {list.filter === 'open' ? (
        <div className={styles.standaloneQuickAdd}>
          <QuickAdd parentId={null} kind="mainline" placeholder="新建主线：一个能判断是否达成的目标" />
        </div>
      ) : null}
      {!list.items.length ? (
        <EmptyState
          className={styles.empty}
          icon={<EmptyArt className={styles.emptyArt} />}
          title={list.filter === 'open' ? '还没有主线' : '这里还是空的'}
          description="主线承接有明确终点的目标，可以先记下目标，再边做边拆解。"
        />
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
  const color = mainlineAccentColor(mainline.id);
  const statusTone = mainline.archivedAt
    ? 'neutral'
    : mainline.status === 'done'
      ? 'success'
      : mainline.status === 'paused'
        ? 'warning'
        : 'accent';

  return (
    <div className={styles.doc}>
      <nav className={styles.docCrumb} aria-label="当前位置">
        <PressableButton className={styles.crumbLink} onPress={onBack}>
          主线
        </PressableButton>
        <ChevronRightIcon size={12} />
        <span>{mainline.title}</span>
      </nav>

      <div className={styles.docHero}>
        <div className={styles.docHeroMain}>
          <h1 className={styles.docTitle}>
            <span className={styles.docDot} style={{ background: color }} aria-hidden="true" />
            <PressableButton className={styles.docTitleButton} onPress={() => actions.select(mainline.id)}>
              {mainline.title}
            </PressableButton>
          </h1>
          <div className={styles.docMeta}>
            <Badge tone={statusTone}>
              {mainline.archivedAt
                ? '已归档'
                : mainline.status === 'done'
                  ? '已完成'
                  : mainline.status === 'paused'
                    ? '已暂停'
                    : '进行中'}
            </Badge>
            <span className={styles.metaText}>
              进展 {progress.done}/{progress.total}
            </span>
            {tone ? (
              <Badge tone={tone === 'overdue' ? 'danger' : tone === 'today' ? 'warning' : 'neutral'} hideDot>
                <ClockIcon size={11} />
                {dueLabel(mainline, today)}
              </Badge>
            ) : null}
            {mainline.starred ? <StarIcon size={13} className={styles.starMark} aria-label="已加星标" /> : null}
          </div>
          {mainline.goal ? <p className={styles.docGoal}>{mainline.goal}</p> : null}
        </div>
        <div className={styles.docHeroRing}>
          <ProgressRing done={progress.done} total={progress.total} size={28} color={color} />
          <span>
            {progress.done}/{progress.total}
          </span>
        </div>
      </div>

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
        <div className={styles.docTreeHead}>
          <h2>拆解步骤</h2>
          <span className={styles.groupCount}>{index.children(mainline.id).length}</span>
        </div>
        <TodoTree parent={mainline} index={index} selectedId={selectedId} addPlaceholder="添加任务" />
        {!index.children(mainline.id).length && mainline.archivedAt ? (
          <p className={styles.metaText}>这条主线没有拆解任务。</p>
        ) : null}
      </div>
    </div>
  );
}
