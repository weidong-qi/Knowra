import { useState } from 'react';
import type { Todo, TodoIndex } from '@study-accelerator/web-core';
import { PressableButton } from '../../components/ui';
import { TodoRow } from './TodoRow';
import { QuickAdd } from './QuickAdd';
import styles from './PersonalTodos.module.css';

/** 按用户排序递归展示的任务树；每层末尾可直接添加步骤。 */
export function TodoTree({
  parent,
  index,
  selectedId,
  depth = 0,
  allowAdd = true,
  addPlaceholder = '添加步骤'
}: {
  parent: Todo;
  index: TodoIndex;
  selectedId: string | null;
  depth?: number;
  allowAdd?: boolean;
  addPlaceholder?: string;
}) {
  const children = index.children(parent.id);
  const canAdd = allowAdd && !parent.archivedAt && depth < 4;
  return (
    <div role="list" className={styles.tree}>
      {children.map(child => (
        <TreeNode key={child.id} todo={child} index={index} selectedId={selectedId} depth={depth} />
      ))}
      {canAdd ? <QuickAdd parentId={parent.id} depth={depth} placeholder={addPlaceholder} compact /> : null}
    </div>
  );
}

function TreeNode({
  todo,
  index,
  selectedId,
  depth
}: {
  todo: Todo;
  index: TodoIndex;
  selectedId: string | null;
  depth: number;
}) {
  const hasChildren = index.children(todo.id).length > 0;
  // 已完成的分支默认收起，避免挤占推进中的步骤。
  const [expanded, setExpanded] = useState(todo.status !== 'done');
  const [adding, setAdding] = useState(false);
  return (
    <>
      <TodoRow
        todo={todo}
        index={index}
        selectedId={selectedId}
        depth={depth}
        expanded={hasChildren || adding ? expanded : undefined}
        onToggleExpanded={hasChildren || adding ? () => setExpanded(value => !value) : undefined}
        trailing={
          !hasChildren && !adding && !todo.archivedAt && depth < 3 && todo.status !== 'done' ? (
            <PressableButton
              className={styles.addChildButton}
              aria-label={`给「${todo.title}」添加步骤`}
              onPress={() => {
                setAdding(true);
                setExpanded(true);
              }}
            >
              ＋步骤
            </PressableButton>
          ) : null
        }
      />
      {(hasChildren || adding) && expanded ? (
        <TodoTree parent={todo} index={index} selectedId={selectedId} depth={depth + 1} />
      ) : null}
    </>
  );
}
