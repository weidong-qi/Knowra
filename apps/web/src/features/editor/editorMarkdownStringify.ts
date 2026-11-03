import { remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';

/**
 * 笔记 Markdown 写出规则：`==高亮==` 与 `[[内部链接]]` 的定界符。
 * 编辑器与无界面编辑器（重点迁移）共用，保证两边写出的正文一致。
 */
export function configureNoteMarkdownStringify(ctx: Ctx) {
  ctx.update(remarkStringifyOptionsCtx, (options) => {
    type MarkdownHandler = NonNullable<typeof options.handlers>['text'];
    const delimited = (open: string, close = open): MarkdownHandler => (
      node, _parent, state, info
    ) => {
      const exit = state.enter('emphasis');
      const tracker = state.createTracker(info);
      let value = tracker.move(open);
      value += tracker.move(state.containerPhrasing(node, {
        before: value,
        after: close,
        ...tracker.current()
      }));
      value += tracker.move(close);
      exit();
      return value;
    };
    return {
      ...options,
      handlers: {
        ...options.handlers,
        highlight: delimited('=='),
        internalLink: delimited('[[', ']]')
      }
    };
  });
}
