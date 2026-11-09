import type { Todo } from './types.js';

/** 未删除节点的只读索引；所有视图与命令都基于它遍历。 */
export interface TodoIndex {
  byId: ReadonlyMap<string, Todo>;
  children(parentId: string | null): Todo[];
  ancestors(id: string): Todo[];
  descendants(id: string): Todo[];
  depth(id: string): number;
  /** 包含自身的子树高度，叶子为 1。 */
  height(id: string): number;
}

export const byOrder = (left: Todo, right: Todo) =>
  left.order < right.order ? -1 : left.order > right.order ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

export function indexTodos(todos: readonly Todo[], { includeDeleted = false } = {}): TodoIndex {
  const live = includeDeleted ? [...todos] : todos.filter(todo => !todo.deletedAt);
  const byId = new Map(live.map(todo => [todo.id, todo]));
  const childMap = new Map<string | null, Todo[]>();
  for (const todo of live) {
    const list = childMap.get(todo.parentId) ?? [];
    list.push(todo);
    childMap.set(todo.parentId, list);
  }
  for (const list of childMap.values()) list.sort(byOrder);
  const children = (parentId: string | null) => [...(childMap.get(parentId) ?? [])];
  const ancestors = (id: string) => {
    const result: Todo[] = [];
    const seen = new Set<string>([id]);
    let current = byId.get(id)?.parentId ?? null;
    while (current !== null && !seen.has(current)) {
      const node = byId.get(current);
      if (!node) break;
      result.push(node);
      seen.add(current);
      current = node.parentId;
    }
    return result;
  };
  const descendants = (id: string) => {
    const result: Todo[] = [];
    const stack = children(id).reverse();
    const seen = new Set<string>([id]);
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      result.push(node);
      stack.push(...children(node.id).reverse());
    }
    return result;
  };
  const height = (id: string): number => {
    const kids = children(id);
    return 1 + (kids.length ? Math.max(...kids.map(kid => height(kid.id))) : 0);
  };
  return { byId, children, ancestors, descendants, depth: id => ancestors(id).length + 1, height };
}

export const rootOf = (index: TodoIndex, id: string): Todo | undefined => {
  const chain = index.ancestors(id);
  return chain.length ? chain[chain.length - 1] : index.byId.get(id);
};
