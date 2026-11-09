import { useEffect, useMemo } from 'react';
import { indexTodos, progressOf, topLevelTodos } from '@study-accelerator/web-core';
import { CalendarIcon, CheckIcon, InboxIcon, TargetIcon } from '../../components/icons/knowra';
import { ScopedAppearanceProvider, SideNavItem } from '../../components/ui';
import { useLocation, useNavigate } from '../../app/router';
import { notesIndexAppearanceProps } from '../notes/NotesIndexAppearance';
import { useNotesIndexAppearance } from '../notes/notesIndexAppearanceModel';
import { parseTodoRoute, todoRoutePath, useToday } from './TodosView';
import { pageCounts } from './todoPresentation';
import { sharedTodoStore, useTodoState, type TodoStore } from './todoStore';
import styles from './PersonalTodos.module.css';

/** 左侧上下文栏：四个入口与进行中的主线。 */
export function TodosContextSidebar({ store = sharedTodoStore() }: { store?: TodoStore }) {
  const appearance = useNotesIndexAppearance();
  const appearanceProps = notesIndexAppearanceProps(appearance);
  const location = useLocation();
  const navigate = useNavigate();
  const route = parseTodoRoute(location.pathname);
  const today = useToday();
  const status = useTodoState(store, state => state.status);
  const todos = useTodoState(store, state => state.todos);
  useEffect(() => {
    if (status === 'idle') void store.load();
  }, [status, store]);
  const index = useMemo(() => indexTodos(todos), [todos]);
  const counts = useMemo(() => pageCounts(todos, today), [todos, today]);
  const mainlines = topLevelTodos(todos, 'mainline', 'open');
  const entries = [
    { page: 'today' as const, label: '今天', Icon: CheckIcon, count: counts.today },
    { page: 'plan' as const, label: '计划', Icon: CalendarIcon, count: counts.plan },
    { page: 'mainlines' as const, label: '主线', Icon: TargetIcon, count: counts.mainlines },
    { page: 'sidelines' as const, label: '支线', Icon: InboxIcon, count: counts.sidelines }
  ];
  return (
    <ScopedAppearanceProvider value={appearanceProps}>
      <div {...appearanceProps} className={`${appearanceProps.className} ${styles.sidebar}`}>
        <header className={styles.sidebarHeader}>
          <span className={styles.sidebarTitle}>待办</span>
        </header>
        <nav className={styles.sidebarBody} aria-label="待办视图">
          <div className={styles.sidebarSection}>
            {entries.map(entry => (
              <SideNavItem
                key={entry.page}
                density="compact"
                icon={<entry.Icon size={18} />}
                label={entry.label}
                count={entry.count}
                aria-current={
                  route.page === entry.page || (entry.page === 'mainlines' && route.page === 'mainline')
                    ? 'page'
                    : undefined
                }
                onPress={() => navigate(todoRoutePath({ page: entry.page }))}
              />
            ))}
          </div>
          {mainlines.length ? (
            <div className={styles.sidebarSection}>
              <h2 className={styles.sidebarSectionTitle}>进行中的主线</h2>
              {mainlines.map(mainline => {
                const progress = progressOf(index, mainline.id);
                return (
                  <SideNavItem
                    key={mainline.id}
                    density="compact"
                    icon={
                      <span
                        className={styles.sidebarRing}
                        style={{ '--p': progress.total ? progress.done / progress.total : 0 } as React.CSSProperties}
                      />
                    }
                    label={mainline.title}
                    count={progress.total ? `${progress.done}/${progress.total}` : undefined}
                    aria-current={route.page === 'mainline' && route.id === mainline.id ? 'page' : undefined}
                    onPress={() => navigate(todoRoutePath({ page: 'mainline', id: mainline.id }))}
                  />
                );
              })}
            </div>
          ) : null}
        </nav>
      </div>
    </ScopedAppearanceProvider>
  );
}
