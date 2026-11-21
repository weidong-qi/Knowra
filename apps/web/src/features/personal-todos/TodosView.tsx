import { useEffect, useMemo, useState } from 'react';
import { indexTodos, localDateOf, todayView } from '@study-accelerator/web-core';
import { CalendarIcon, CheckIcon, InboxIcon, TargetIcon } from '../../components/icons/knowra';
import {
  Button,
  LoadingState,
  ScopedAppearanceProvider,
  SegmentedButton,
  SegmentedControl,
  ToastRegion,
  type ToastItem
} from '../../components/ui';
import { WorkspacePanel } from '../../components/workspace/WorkspacePanel';
import { useNavigate } from '../../app/router';
import { notesIndexAppearanceProps } from '../notes/NotesIndexAppearance';
import { useNotesIndexAppearance } from '../notes/notesIndexAppearanceModel';
import { TodoActionsProvider } from './TodoActions';
import { TodoDetailPanel } from './TodoDetailPanel';
import { MainlinePage, MainlinesPage, PlanPage, SidelinesPage, TodayPage } from './TodoPages';
import { addDaysToDate, formatDateLabel, mondayOfWeek, pageCounts, weekDaysFrom } from './todoPresentation';
import { sharedTodoStore, useTodoState, type TodoStore } from './todoStore';
import styles from './PersonalTodos.module.css';

export type TodoRoute =
  | { page: 'today' }
  | { page: 'plan' }
  | { page: 'mainlines' }
  | { page: 'mainline'; id: string }
  | { page: 'sidelines' };

export function parseTodoRoute(pathname: string): TodoRoute {
  const [, , section, id] = pathname.split('?')[0]!.split('/');
  if (section === 'plan') return { page: 'plan' };
  if (section === 'sidelines') return { page: 'sidelines' };
  if (section === 'mainlines') return id ? { page: 'mainline', id: decodeURIComponent(id) } : { page: 'mainlines' };
  return { page: 'today' };
}

export const todoRoutePath = (route: TodoRoute) =>
  route.page === 'today'
    ? '/learning'
    : route.page === 'mainline'
      ? `/learning/mainlines/${encodeURIComponent(route.id)}`
      : `/learning/${route.page}`;

/** 设备本地「今天」；跨过零点时自动切换。 */
export function useToday() {
  const [today, setToday] = useState(() => localDateOf(new Date()));
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDateOf(new Date())), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return today;
}

const TITLES: Record<TodoRoute['page'], { title: string; Icon: typeof CalendarIcon }> = {
  today: { title: '今天', Icon: CheckIcon },
  plan: { title: '计划', Icon: CalendarIcon },
  mainlines: { title: '主线', Icon: TargetIcon },
  mainline: { title: '主线', Icon: TargetIcon },
  sidelines: { title: '支线', Icon: InboxIcon }
};

export function TodosView({ pathname, store = sharedTodoStore() }: { pathname: string; store?: TodoStore }) {
  const appearance = useNotesIndexAppearance();
  const theme = notesIndexAppearanceProps(appearance);
  const navigate = useNavigate();
  const route = parseTodoRoute(pathname);
  const today = useToday();
  const status = useTodoState(store, state => state.status);
  const todos = useTodoState(store, state => state.todos);
  const error = useTodoState(store, state => state.error);
  const unavailable = useTodoState(store, state => state.unavailable);
  const undo = useTodoState(store, state => state.undo);
  const notice = useTodoState(store, state => state.notice);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planMode, setPlanMode] = useState<'list' | 'board'>('list');
  const [planWeekOffset, setPlanWeekOffset] = useState(0);
  const [planSelectedDate, setPlanSelectedDate] = useState<string | null>(null);
  const index = useMemo(() => indexTodos(todos), [todos]);
  const planRangeTitle = useMemo(() => {
    const monday = addDaysToDate(mondayOfWeek(today), planWeekOffset * 7);
    const days = weekDaysFrom(monday, today);
    const firstMonth = days[0]!.month;
    const lastMonth = days[6]!.month;
    const year = days[0]!.date.slice(0, 4);
    return firstMonth === lastMonth ? `${year}年 ${firstMonth}月` : `${year}年 ${firstMonth}–${lastMonth}月`;
  }, [today, planWeekOffset]);
  useEffect(() => {
    if (status === 'idle') void store.load();
  }, [status, store]);
  // 切换页面时关闭详情，避免详情指向当前页面看不到的事项。
  useEffect(() => setSelectedId(null), [route.page]);
  const selected = selectedId ? (index.byId.get(selectedId) ?? null) : null;
  const mainline = route.page === 'mainline' ? index.byId.get(route.id) : undefined;
  const { title, Icon } = TITLES[route.page];
  const openMainline = (id: string) => navigate(todoRoutePath({ page: 'mainline', id }));
  const counts = useMemo(() => pageCounts(todos, today), [todos, today]);
  const visibleCount =
    route.page === 'mainline' ? (mainline ? index.descendants(mainline.id).length : 0) : counts[route.page];

  const todayStats = useMemo(() => {
    const view = todayView(todos, today);
    const done = view.doneToday.length;
    const total = view.today.length + done;
    return { done, total, pct: total ? done / total : 0 };
  }, [todos, today]);

  const undoItems = useMemo<ToastItem[]>(
    () =>
      undo
        ? [
            {
              id: `todo-undo:${undo.id}`,
              title: undo.message,
              pinned: Boolean(undo.command),
              tone: 'success',
              role: 'status',
              actions: undo.command
                ? [
                    {
                      label: '撤销',
                      variant: 'ghost',
                      onPress: () => void store.runUndo()
                    }
                  ]
                : undefined,
              onDismiss: store.dismissUndo
            }
          ]
        : [],
    [store, undo]
  );

  return (
    <ScopedAppearanceProvider value={theme}>
      <WorkspacePanel {...theme} className={`${theme.className} ${styles.panel}`} aria-label="待办">
        <TodoActionsProvider store={store} todos={todos} today={today} onSelect={setSelectedId}>
          <header className={styles.header}>
            <span className={styles.heading}>
              <Icon size={17} />
              <strong>{mainline ? mainline.title : title}</strong>
              <span>{visibleCount}</span>
              {route.page === 'plan' ? <em className={styles.headerMonth}>{planRangeTitle}</em> : null}
              {route.page === 'plan' && planSelectedDate ? (
                <Button size="chip" variant="ghost" onPress={() => setPlanSelectedDate(null)}>
                  显示全部
                </Button>
              ) : null}
            </span>
            <div className={styles.headerRight}>
              {route.page === 'today' && todayStats.total > 0 ? (
                <div className={styles.headerProgress} title={`今日完成 ${todayStats.done}/${todayStats.total}`}>
                  <span
                    className={styles.sidebarRing}
                    style={{ '--p': todayStats.pct } as React.CSSProperties}
                    aria-hidden="true"
                  />
                  <span>今日完成</span>
                  <strong>
                    {todayStats.done}/{todayStats.total}
                  </strong>
                </div>
              ) : null}
              {route.page === 'plan' ? (
                <>
                  <Button
                    size="compact"
                    variant="ghost"
                    isDisabled={planWeekOffset === 0 && !planSelectedDate}
                    onPress={() => {
                      setPlanWeekOffset(0);
                      setPlanSelectedDate(null);
                    }}
                  >
                    本周
                  </Button>
                  <SegmentedControl density="compact" aria-label="计划视图模式">
                    <SegmentedButton aria-pressed={planMode === 'list'} onPress={() => setPlanMode('list')}>
                      时间线
                    </SegmentedButton>
                    <SegmentedButton aria-pressed={planMode === 'board'} onPress={() => setPlanMode('board')}>
                      多日看板
                    </SegmentedButton>
                  </SegmentedControl>
                </>
              ) : null}
              {route.page === 'mainline' && mainline ? (
                <Button
                  size="compact"
                  variant="default"
                  onPress={() => setSelectedId(prev => (prev === mainline.id ? null : mainline.id))}
                >
                  编辑主线属性
                </Button>
              ) : null}
              {route.page !== 'plan' ? (
                <span className={styles.headerNote}>{formatDateLabel(today, today)}</span>
              ) : null}
            </div>
          </header>

          <SegmentedControl variant="underline" density="compact" className={styles.mobileTabs} aria-label="待办视图">
            {(['today', 'plan', 'mainlines', 'sidelines'] as const).map(page => (
              <SegmentedButton
                key={page}
                aria-pressed={route.page === page || (page === 'mainlines' && route.page === 'mainline')}
                onPress={() => navigate(todoRoutePath({ page }))}
              >
                {TITLES[page].title}
              </SegmentedButton>
            ))}
          </SegmentedControl>

          {notice ? (
            <div className={styles.notice} role="alert">
              <span>{notice}</span>
              <Button size="mini" variant="ghost" onPress={store.clearNotice}>
                知道了
              </Button>
            </div>
          ) : null}

          <div className={styles.wrap}>
            <div className={styles.content} data-has-peek={selected ? true : undefined}>
              <div className={styles.stage}>
                {status === 'loading' || status === 'idle' ? <LoadingState label="正在读取待办…" /> : null}
                {status === 'error' ? (
                  <div className={styles.loadError} role="alert">
                    <span>{unavailable ? '当前存储暂不支持个人待办，请升级服务端后再试。' : error}</span>
                    {!unavailable ? (
                      <Button size="mini" variant="ghost" onPress={() => void store.load()}>
                        重试
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {status === 'ready' ? (
                  route.page === 'today' ? (
                    <TodayPage todos={todos} index={index} selectedId={selectedId} />
                  ) : route.page === 'plan' ? (
                    <PlanPage
                      todos={todos}
                      index={index}
                      selectedId={selectedId}
                      mode={planMode}
                      weekOffset={planWeekOffset}
                      onWeekOffsetChange={setPlanWeekOffset}
                      selectedDate={planSelectedDate}
                      onSelectDate={setPlanSelectedDate}
                    />
                  ) : route.page === 'sidelines' ? (
                    <SidelinesPage todos={todos} index={index} selectedId={selectedId} />
                  ) : route.page === 'mainlines' ? (
                    <MainlinesPage todos={todos} index={index} selectedId={selectedId} onOpenMainline={openMainline} />
                  ) : mainline && mainline.parentId === null ? (
                    <MainlinePage
                      mainline={mainline}
                      index={index}
                      selectedId={selectedId}
                      onBack={() => navigate(todoRoutePath({ page: 'mainlines' }))}
                    />
                  ) : (
                    <div className={styles.loadError} role="alert">
                      <span>这条主线不存在或已删除。</span>
                      <Button
                        size="mini"
                        variant="ghost"
                        onPress={() => navigate(todoRoutePath({ page: 'mainlines' }))}
                      >
                        返回主线
                      </Button>
                    </div>
                  )
                ) : null}
              </div>
            </div>
            {selected ? (
              <TodoDetailPanel
                key={selected.id}
                todo={selected}
                index={index}
                onClose={() => setSelectedId(null)}
                onOpenMainline={route.page === 'mainline' ? undefined : openMainline}
              />
            ) : null}
          </div>

          <ToastRegion items={undoItems} ariaLabel="操作撤销提示" />
        </TodoActionsProvider>
      </WorkspacePanel>
    </ScopedAppearanceProvider>
  );
}
