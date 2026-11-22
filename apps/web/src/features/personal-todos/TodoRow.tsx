import { useState, type ReactNode } from 'react';
import { progressOf, todayActionOf, type Todo, type TodoIndex } from '@study-accelerator/web-core';
import {
  BellIcon,
  CalendarIcon,
  ChevronRightIcon,
  ClockIcon,
  InboxIcon,
  MoreHorizontalIcon,
  StarIcon
} from '../../components/icons/knowra';
import {
  Badge,
  Button,
  DatePicker,
  IconButton,
  Menu,
  MenuItem,
  MenuPopover,
  MenuSeparator,
  MenuTrigger,
  PressableButton
} from '../../components/ui';
import { useTodoActions } from './TodoActions';
import { contextPath, dueLabel, dueTone, mainlineAccentColor, relativeDateLabel, topLevelOf } from './todoPresentation';
import styles from './PersonalTodos.module.css';

export interface TodoRowProps {
  todo: Todo;
  index: TodoIndex;
  selectedId: string | null;
  depth?: number;
  /** 平铺视图（今天、计划）显示所属主线与父任务。 */
  showContext?: boolean;
  /** 在「之前未完成」行内常驻「今天继续 / 改到明天」按钮，并在第二行标出原计划日期。 */
  showCarryoverActions?: boolean;
  expanded?: boolean;
  onToggleExpanded?(): void;
  /** 由调用方追加在行尾的附加内容，例如添加步骤入口。 */
  trailing?: ReactNode;
  onOpen?(todo: Todo): void;
}

export function TodoRow({
  todo,
  index,
  selectedId,
  depth = 0,
  showContext = false,
  showCarryoverActions = false,
  expanded,
  onToggleExpanded,
  trailing,
  onOpen
}: TodoRowProps) {
  const actions = useTodoActions();
  const { today } = actions;
  const children = index.children(todo.id);
  const progress = children.length ? progressOf(index, todo.id) : null;
  const archived = Boolean(todo.archivedAt);
  const done = todo.status === 'done';
  const tone = dueTone(todo, today);
  const context = showContext ? contextPath(index, todo) : [];
  const top = showContext ? topLevelOf(index, todo) : null;
  const topColor = top && top.kind === 'mainline' ? mainlineAccentColor(top.id) : null;
  const todayAction = todayActionOf(todo, today);
  const [menuOpen, setMenuOpen] = useState(false);
  const open = () => (onOpen ? onOpen(todo) : actions.select(todo.id));

  const hasSubline =
    showContext &&
    (context.length > 0 || todo.kind === 'sideline' || (showCarryoverActions && Boolean(todo.plannedDate)));

  return (
    <div
      className={styles.row}
      data-selected={selectedId === todo.id || undefined}
      data-status={todo.status}
      data-archived={archived || undefined}
      data-menu-open={menuOpen || undefined}
      data-carryover={showCarryoverActions || undefined}
      style={{ '--depth': depth } as React.CSSProperties}
      role="listitem"
    >
      {onToggleExpanded ? (
        <PressableButton
          className={styles.expander}
          aria-label={expanded ? `收起「${todo.title}」的步骤` : `展开「${todo.title}」的步骤`}
          aria-expanded={expanded}
          onPress={onToggleExpanded}
        >
          <ChevronRightIcon size={14} />
        </PressableButton>
      ) : depth > 0 ? (
        <span className={styles.expanderSpace} aria-hidden="true" />
      ) : null}

      <PressableButton
        className={styles.check}
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `重新打开「${todo.title}」` : `完成「${todo.title}」`}
        isDisabled={archived}
        data-paused={todo.status === 'paused' || undefined}
        onPress={() => actions.toggleDone(todo)}
      >
        <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden="true">
          <rect x="1.25" y="1.25" width="16.5" height="16.5" rx="5" />
          <path d="m5.8 9.7 2.4 2.4 5-5.2" />
        </svg>
      </PressableButton>

      <PressableButton className={styles.rowMain} onPress={open} aria-label={`打开「${todo.title}」详情`}>
        <span className={styles.rowTitle}>
          <span className={styles.rowTitleText}>{todo.title}</span>
          {todo.starred ? <StarIcon size={13} className={styles.starMark} aria-label="已加星标" /> : null}
        </span>
        {hasSubline ? (
          <span className={styles.rowContext}>
            {context.length > 0 ? (
              <span className={styles.rowContextItem}>
                <span
                  className={styles.contextDot}
                  style={topColor ? ({ '--dot-color': topColor } as React.CSSProperties) : undefined}
                  aria-hidden="true"
                />
                <span>{context.join(' › ')}</span>
              </span>
            ) : todo.kind === 'sideline' ? (
              <span className={styles.rowContextItem}>
                <InboxIcon size={12} className={styles.contextInbox} aria-hidden="true" />
                <span>独立支线</span>
              </span>
            ) : null}
            {showCarryoverActions && todo.plannedDate ? (
              <span className={styles.rowContextPlan}>
                {context.length > 0 || todo.kind === 'sideline' ? '· ' : ''}原计划
                {relativeDateLabel(todo.plannedDate, today)}
              </span>
            ) : null}
          </span>
        ) : null}
      </PressableButton>

      <span className={styles.rowMeta}>
        {progress ? (
          <span className={styles.progressChip} title={`直接下级完成 ${progress.done}/${progress.total}`}>
            <span className={styles.progressTrack}>
              <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </span>
            {progress.done}/{progress.total}
          </span>
        ) : null}
        {todo.reminder?.state === 'missed' && !done && !archived ? (
          <Badge tone="warning" hideDot title="提醒时间已过，应用当时未打开；请重新设置">
            <BellIcon size={11} />
            提醒已错过
          </Badge>
        ) : todo.reminder?.state === 'pending' && !done && !archived ? (
          <span className={styles.reminderMark} title="已设置提醒" aria-label="已设置提醒">
            <BellIcon size={13} />
          </span>
        ) : null}
        {todo.status === 'paused' ? (
          <Badge tone="neutral" hideDot title={todo.pauseReason ?? undefined}>
            {todo.pausedBy === 'parent' ? '随上级暂停' : todo.pauseReason ? `暂停 · ${todo.pauseReason}` : '已暂停'}
          </Badge>
        ) : null}
        {todo.plannedDate && !done && todo.plannedDate !== today && !showCarryoverActions ? (
          <span
            className={styles.planChip}
            data-earlier={todo.plannedDate < today || undefined}
            title={`计划日期：${todo.plannedDate}`}
          >
            <CalendarIcon size={12} />
            {relativeDateLabel(todo.plannedDate, today)}
          </span>
        ) : null}
        {tone ? (
          <Badge
            tone={tone === 'overdue' ? 'danger' : tone === 'today' ? 'warning' : 'neutral'}
            hideDot
            className={styles.dueBadge}
          >
            <ClockIcon size={11} />
            {dueLabel(todo, today)}
          </Badge>
        ) : null}
      </span>

      {showCarryoverActions && !archived && !done && todo.status === 'active' ? (
        <span className={styles.carryoverActions}>
          {todayAction !== 'alreadyToday' ? (
            <Button
              size="mini"
              shape="pill"
              variant="ghost"
              emphasis="soft"
              className={styles.desktopTodayAction}
              onPress={() => actions.addToToday(todo)}
              aria-label={todayAction === 'moveToToday' ? `把「${todo.title}」改到今天` : `把「${todo.title}」加入今天`}
            >
              {todo.plannedDate && todo.plannedDate < today ? '今天继续' : '今天做'}
            </Button>
          ) : null}
          <Button
            size="mini"
            shape="pill"
            variant="ghost"
            onPress={() => actions.moveToTomorrow(todo)}
            aria-label={`把「${todo.title}」改到明天`}
          >
            改到明天
          </Button>
        </span>
      ) : null}

      <span className={styles.rowActions}>
        {!showCarryoverActions && !archived && !done && todo.status === 'active' ? (
          todayAction !== 'alreadyToday' ? (
            <Button
              size="mini"
              shape="pill"
              variant="ghost"
              emphasis="soft"
              className={styles.desktopTodayAction}
              onPress={() => actions.addToToday(todo)}
              aria-label={todayAction === 'moveToToday' ? `把「${todo.title}」改到今天` : `把「${todo.title}」加入今天`}
            >
              {todayAction === 'moveToToday' ? '改到今天' : '加入今天'}
            </Button>
          ) : (
            <Button
              size="mini"
              shape="pill"
              variant="ghost"
              onPress={() => actions.moveToTomorrow(todo)}
              aria-label={`把「${todo.title}」改到明天`}
            >
              改到明天
            </Button>
          )
        ) : null}
        {!archived ? (
          <span className={styles.rowDate}>
            <DatePicker
              label={`「${todo.title}」的计划日期`}
              value={todo.plannedDate}
              today={today}
              onChange={plannedDate => void actions.update(todo, { plannedDate })}
              icon={<CalendarIcon size={14} />}
              iconOnly
              isDisabled={done}
            />
          </span>
        ) : null}
        <TodoMenu todo={todo} onOpenChange={setMenuOpen} />
        {trailing}
      </span>
    </div>
  );
}

export function TodoMenu({ todo, onOpenChange }: { todo: Todo; onOpenChange?(open: boolean): void }) {
  const actions = useTodoActions();
  const archived = Boolean(todo.archivedAt);
  const done = todo.status === 'done';
  return (
    <MenuTrigger onOpenChange={onOpenChange}>
      <IconButton size={24} aria-label={`「${todo.title}」更多操作`} title="更多操作">
        <MoreHorizontalIcon size={16} />
      </IconButton>
      <MenuPopover placement="bottom end">
        <Menu
          ariaLabel={`「${todo.title}」操作`}
          onAction={key => {
            if (key === 'open') actions.select(todo.id);
            if (key === 'star') void actions.update(todo, { starred: !todo.starred });
            if (key === 'pause') actions.pause(todo);
            if (key === 'resume') actions.resume(todo);
            if (key === 'clear-plan') actions.clearPlan(todo);
            if (key === 'up') actions.shift(todo, -1);
            if (key === 'down') actions.shift(todo, 1);
            if (key === 'move') actions.move(todo);
            if (key === 'promote') actions.promote(todo);
            if (key === 'archive') actions.archive(todo);
            if (key === 'delete') actions.remove(todo);
          }}
        >
          <MenuItem id="open">查看详情</MenuItem>
          {!archived ? (
            <>
              <MenuItem id="star">{todo.starred ? '取消星标' : '加星标'}</MenuItem>
              {todo.status === 'active' ? <MenuItem id="pause">暂停…</MenuItem> : null}
              {todo.status === 'paused' && todo.pausedBy === 'self' ? <MenuItem id="resume">恢复</MenuItem> : null}
              {todo.plannedDate && !done ? <MenuItem id="clear-plan">取消日期安排</MenuItem> : null}
              <MenuSeparator />
              <MenuItem id="up">上移</MenuItem>
              <MenuItem id="down">下移</MenuItem>
              {todo.kind !== 'mainline' ? <MenuItem id="move">移动到…</MenuItem> : null}
              {todo.kind === 'sideline' ? <MenuItem id="promote">升级为主线</MenuItem> : null}
              <MenuSeparator />
              {done && todo.parentId === null ? <MenuItem id="archive">归档…</MenuItem> : null}
              <MenuItem id="delete" isDanger>
                删除
              </MenuItem>
            </>
          ) : null}
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
}
