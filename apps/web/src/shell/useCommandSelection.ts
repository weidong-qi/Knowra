import { useEffect, useRef, useState } from 'react';

export interface CommandSelectionContext { isCurrent(): boolean }
export type CommandSelectionResult = void | boolean | Promise<void | boolean>;

/** 选择的生命周期覆盖异步详情载入；关闭、输入变化或后续选择会立即取消旧请求。 */
export function useCommandSelection(scope: object, onComplete: () => void) {
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const request = useRef(0);
  const [state, setState] = useState<{ scope: object; pending: boolean; error: string | null } | null>(null);
  useEffect(() => () => { request.current++; }, []);

  function cancel() { request.current++; setState(null); }
  function select(onSelect: (context: CommandSelectionContext) => CommandSelectionResult) {
    const id = ++request.current;
    const context = { isCurrent: () => currentScope.current === scope && request.current === id };
    const finish = (accepted: void | boolean) => {
      if (!context.isCurrent()) return;
      setState(null);
      if (accepted !== false) onComplete();
    };
    const fail = (error: unknown) => {
      if (context.isCurrent()) setState({ scope, pending: false, error: error instanceof Error ? error.message : '打开笔记失败，请重试。' });
    };
    try {
      const result = onSelect(context);
      if (result instanceof Promise) {
        setState({ scope, pending: true, error: null });
        void result.then(finish).catch(fail);
      } else finish(result);
    } catch (error) { fail(error); }
  }
  return { select, cancel, pending: state?.scope === scope && state.pending,
    error: state?.scope === scope ? state.error : null };
}
