import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { indexTodos, type Todo, type TodoCommand, type TodoEditableFields } from '@study-accelerator/web-core';
import { randomId } from '../../browser/randomId';
import { Button, Dialog, DialogBody, DialogFooter, Select, TextField } from '../../components/ui';
import type { TodoStore } from './todoStore';
import styles from './PersonalTodos.module.css';

type DialogState =
  | { kind: 'completeAll'; todo: Todo; open: number }
  | { kind: 'delete'; todo: Todo; descendants: number }
  | { kind: 'archive'; todo: Todo; descendants: number }
  | { kind: 'pause'; todo: Todo }
  | { kind: 'move'; todo: Todo }
  | null;

export interface TodoActions {
  today: string;
  create(input: {
    parentId: string | null;
    title: string;
    kind?: 'mainline' | 'sideline';
    plannedDate?: string | null;
    afterId?: string | null;
  }): Promise<Todo | undefined>;
  update(todo: Todo, patch: Partial<TodoEditableFields>): Promise<void>;
  toggleDone(todo: Todo): void;
  addToToday(todo: Todo): void;
  clearPlan(todo: Todo): void;
  pause(todo: Todo): void;
  resume(todo: Todo): void;
  remove(todo: Todo): void;
  archive(todo: Todo): void;
  promote(todo: Todo): void;
  move(todo: Todo): void;
  /** 同级上移或下移一位（首版不做拖拽排序）。 */
  shift(todo: Todo, delta: -1 | 1): void;
  select(id: string | null): void;
}

const ActionsContext = createContext<TodoActions | null>(null);

export function useTodoActions() {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error('useTodoActions 需要在 TodoActionsProvider 内使用');
  return actions;
}

const ignore = () => undefined;

export function TodoActionsProvider({
  store,
  todos,
  today,
  onSelect,
  children
}: {
  store: TodoStore;
  todos: Todo[];
  today: string;
  onSelect(id: string | null): void;
  children: ReactNode;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const index = useMemo(() => indexTodos(todos), [todos]);
  const run = (command: TodoCommand, undo?: Parameters<TodoStore['execute']>[1]) =>
    store.execute(command, undo).catch(ignore);
  const revisionAfter = (changed: Todo[], id: string) => changed.find(todo => todo.id === id)?.revision ?? 0;

  const complete = (todo: Todo, includeChildren: boolean) =>
    run(
      { type: 'complete', id: todo.id, expectedRevision: todo.revision, includeChildren },
      {
        undo: {
          message: `已完成「${todo.title}」`,
          command: changed => ({ type: 'reopen', id: todo.id, expectedRevision: revisionAfter(changed, todo.id) })
        }
      }
    );

  const actions: TodoActions = {
    today,
    async create({ parentId, title, kind, plannedDate = null, afterId }) {
      const id = randomId();
      const changed = await store
        .execute({
          type: 'create',
          id,
          parentId,
          title,
          kind,
          plannedDate,
          ...(afterId !== undefined ? { afterId } : {})
        })
        .catch(ignore);
      return changed?.find(todo => todo.id === id);
    },
    async update(todo, patch) {
      await run({ type: 'update', id: todo.id, expectedRevision: todo.revision, patch });
    },
    toggleDone(todo) {
      if (todo.status === 'done') {
        void run({ type: 'reopen', id: todo.id, expectedRevision: todo.revision });
        return;
      }
      const open = index.descendants(todo.id).filter(node => node.status !== 'done').length;
      if (open) setDialog({ kind: 'completeAll', todo, open });
      else void complete(todo, false);
    },
    addToToday(todo) {
      void run({ type: 'update', id: todo.id, expectedRevision: todo.revision, patch: { plannedDate: today } });
    },
    clearPlan(todo) {
      void run({ type: 'update', id: todo.id, expectedRevision: todo.revision, patch: { plannedDate: null } });
    },
    pause: todo => setDialog({ kind: 'pause', todo }),
    resume(todo) {
      void run({ type: 'resume', id: todo.id, expectedRevision: todo.revision });
    },
    remove(todo) {
      const descendants = index.descendants(todo.id).length;
      if (descendants || todo.parentId === null) setDialog({ kind: 'delete', todo, descendants });
      else void removeNow(todo);
    },
    archive(todo) {
      setDialog({ kind: 'archive', todo, descendants: index.descendants(todo.id).length });
    },
    promote(todo) {
      void run({ type: 'promote', id: todo.id, expectedRevision: todo.revision });
    },
    move: todo => setDialog({ kind: 'move', todo }),
    shift(todo, delta) {
      const siblings = index.children(todo.parentId);
      const position = siblings.findIndex(node => node.id === todo.id);
      const target = position + delta;
      if (position < 0 || target < 0 || target >= siblings.length) return;
      const without = siblings.filter(node => node.id !== todo.id);
      const afterId = target === 0 ? null : without[target - 1]!.id;
      void run({ type: 'move', id: todo.id, expectedRevision: todo.revision, parentId: todo.parentId, afterId });
    },
    select: onSelect
  };

  function removeNow(todo: Todo) {
    onSelect(null);
    return run(
      { type: 'delete', id: todo.id, expectedRevision: todo.revision },
      { undo: { message: `已删除「${todo.title}」`, command: () => ({ type: 'restore', id: todo.id }) } }
    );
  }

  return (
    <ActionsContext.Provider value={actions}>
      {children}
      <TodoDialogs
        dialog={dialog}
        todos={todos}
        onClose={() => setDialog(null)}
        onCompleteAll={todo => void complete(todo, true)}
        onDelete={todo => void removeNow(todo)}
        onArchive={todo => {
          onSelect(null);
          void run({ type: 'archive', id: todo.id, expectedRevision: todo.revision });
        }}
        onPause={(todo, reason) => void run({ type: 'pause', id: todo.id, expectedRevision: todo.revision, reason })}
        onMove={(todo, parentId) => void run({ type: 'move', id: todo.id, expectedRevision: todo.revision, parentId })}
      />
    </ActionsContext.Provider>
  );
}

function TodoDialogs({
  dialog,
  todos,
  onClose,
  onCompleteAll,
  onDelete,
  onArchive,
  onPause,
  onMove
}: {
  dialog: DialogState;
  todos: Todo[];
  onClose(): void;
  onCompleteAll(todo: Todo): void;
  onDelete(todo: Todo): void;
  onArchive(todo: Todo): void;
  onPause(todo: Todo, reason: string | null): void;
  onMove(todo: Todo, parentId: string | null): void;
}) {
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState<string>('');
  const open = dialog !== null;
  const close = () => {
    setReason('');
    setTarget('');
    onClose();
  };
  const confirm = (action: () => void) => {
    action();
    close();
  };
  if (!dialog) return null;
  const { todo } = dialog;
  if (dialog.kind === 'completeAll')
    return (
      <Dialog title="还有未完成的步骤" isOpen={open} onOpenChange={next => !next && close()}>
        <DialogBody>
          <p className={styles.dialogText}>
            「{todo.title}」下还有 {dialog.open} 项未完成。可以全部标为完成，或返回整理（不需要的步骤可先删除）。
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onPress={close}>
            返回整理
          </Button>
          <Button variant="primary" onPress={() => confirm(() => onCompleteAll(todo))}>
            全部标为完成
          </Button>
        </DialogFooter>
      </Dialog>
    );
  if (dialog.kind === 'delete')
    return (
      <Dialog title={`删除「${todo.title}」`} isOpen={open} onOpenChange={next => !next && close()}>
        <DialogBody>
          <p className={styles.dialogText}>
            {dialog.descendants
              ? `会连同它下面的 ${dialog.descendants} 项一起删除。删除后 10 秒内可以撤销。`
              : '删除后 10 秒内可以撤销。'}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onPress={close}>
            取消
          </Button>
          <Button variant="danger" onPress={() => confirm(() => onDelete(todo))}>
            删除
          </Button>
        </DialogFooter>
      </Dialog>
    );
  if (dialog.kind === 'archive')
    return (
      <Dialog title={`归档「${todo.title}」`} isOpen={open} onOpenChange={next => !next && close()}>
        <DialogBody>
          <p className={styles.dialogText}>
            {dialog.descendants ? `会连同全部 ${dialog.descendants} 项下级及原有结构一起封存。` : '这条记录会被封存。'}
            归档后只能查看，不能修改、重新打开或删除，也不能取消归档。
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onPress={close}>
            取消
          </Button>
          <Button variant="danger" onPress={() => confirm(() => onArchive(todo))}>
            确认归档
          </Button>
        </DialogFooter>
      </Dialog>
    );
  if (dialog.kind === 'pause')
    return (
      <Dialog title={`暂停「${todo.title}」`} isOpen={open} onOpenChange={next => !next && close()}>
        <DialogBody>
          <TextField
            label="暂停原因（可选）"
            placeholder="例如：等数据、这段时间先忙其他事"
            value={reason}
            onChange={setReason}
            maxLength={200}
            autoFocus
          />
          <p className={styles.dialogHint}>未完成的下级会一起暂停，暂停期间不会提醒；日期保留不变。</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onPress={close}>
            取消
          </Button>
          <Button variant="primary" onPress={() => confirm(() => onPause(todo, reason.trim() || null))}>
            暂停
          </Button>
        </DialogFooter>
      </Dialog>
    );
  const index = indexTodos(todos);
  const blocked = new Set([todo.id, ...index.descendants(todo.id).map(node => node.id)]);
  const options = [
    ...(todo.parentId !== null ? [{ id: '__sideline', label: '作为独立支线' }] : []),
    ...todos
      .filter(node => !node.deletedAt && !node.archivedAt && node.parentId === null && node.kind === 'mainline')
      .filter(node => !blocked.has(node.id) && node.id !== todo.parentId)
      .map(node => ({ id: node.id, label: `主线：${node.title}` }))
  ];
  return (
    <Dialog title={`移动「${todo.title}」`} isOpen={open} onOpenChange={next => !next && close()}>
      <DialogBody>
        {options.length ? (
          <Select
            label="移到"
            options={options}
            selectedKey={target || null}
            onSelectionChange={key => setTarget(String(key))}
          />
        ) : (
          <p className={styles.dialogText}>还没有可以移入的主线。</p>
        )}
        <p className={styles.dialogHint}>连同全部步骤整体移动，原位置不会保留副本；移入主线后放在末尾。</p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onPress={close}>
          取消
        </Button>
        <Button
          variant="primary"
          isDisabled={!target}
          onPress={() => confirm(() => onMove(todo, target === '__sideline' ? null : target))}
        >
          移动
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
