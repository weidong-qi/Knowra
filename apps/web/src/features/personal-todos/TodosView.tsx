import { useEffect, useMemo, useState } from 'react';
import { indexTodos, localDateOf } from '@study-accelerator/web-core';
import { CalendarIcon, CheckIcon, InboxIcon, TargetIcon } from '../../components/icons/knowra';
import { Button, LoadingState, ScopedAppearanceProvider, SegmentedButton, SegmentedControl } from '../../components/ui';
import { WorkspacePanel } from '../../components/workspace/WorkspacePanel';
import { useNavigate } from '../../app/router';
import { notesIndexAppearanceProps } from '../notes/NotesIndexAppearance';
import { useNotesIndexAppearance } from '../notes/notesIndexAppearanceModel';
import { TodoActionsProvider } from './TodoActions';
import { TodoDetailPanel } from './TodoDetailPanel';
import { MainlinePage, MainlinesPage, PlanPage, SidelinesPage, TodayPage } from './TodoPages';
import { formatDateLabel, pageCounts } from './todoPresentation';
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
  const index = useMemo(() => indexTodos(todos), [todos]);
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
  return (
    <ScopedAppearanceProvider value={theme}>
      <WorkspacePanel {...theme} className={`${theme.className} ${styles.panel}`} aria-label="待办">
        <TodoActionsProvider store={store} todos={todos} today={today} onSelect={setSelectedId}>
          <header className={styles.header}>
            <span className={styles.heading}>
              <Icon size={16} />
              <strong>{mainline ? mainline.title : title}</strong>
              <span>{visibleCount}</span>
            </span>
            <span className={styles.headerNote}>{formatDateLabel(today, today)}</span>
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
                  <PlanPage todos={todos} index={index} selectedId={selectedId} />
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
                    <Button size="mini" variant="ghost" onPress={() => navigate(todoRoutePath({ page: 'mainlines' }))}>
                      返回主线
                    </Button>
                  </div>
                )
              ) : null}
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
          {undo ? (
            <div className={styles.undoBar} role="status">
              <span>{undo.message}</span>
              {undo.command ? (
                <Button size="mini" variant="ghost" className={styles.undoButton} onPress={() => void store.runUndo()}>
                  撤销
                </Button>
              ) : null}
            </div>
          ) : null}
        </TodoActionsProvider>
      </WorkspacePanel>
    </ScopedAppearanceProvider>
  );
}
