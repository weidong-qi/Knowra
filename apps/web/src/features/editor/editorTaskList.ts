import { schemaCtx } from '@milkdown/kit/core';
import { getNodeFromSchema } from '@milkdown/kit/prose';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $command, $prose } from '@milkdown/kit/utils';

export const turnIntoTaskListCommand = $command('V4TurnIntoTaskList', (ctx) => () => (state, dispatch) => {
  const schema = ctx.get(schemaCtx);
  const paragraphNodeType = getNodeFromSchema('paragraph', schema);
  const listItemNodeType = getNodeFromSchema('list_item', schema);
  const bulletListNodeType = getNodeFromSchema('bullet_list', schema);
  if (!paragraphNodeType || !listItemNodeType || !bulletListNodeType) return false;

  const { $from, $to } = state.selection;
  const from = $from.start($from.depth);
  const to = $to.end($to.depth);
  const paragraphContent = state.doc.slice(from, to).content;
  const taskListItem = listItemNodeType.create(
    { checked: false },
    [paragraphNodeType.create(null, paragraphContent)]
  );
  const taskList = bulletListNodeType.create(null, [taskListItem]);
  if (!dispatch) return true;

  dispatch(state.tr.replaceRangeWith(from, to, taskList).scrollIntoView());
  return true;
});

export const taskListClickBehavior = $prose(() => new Plugin({
  key: new PluginKey('V4_TASK_LIST_CLICK'),
  props: {
    handleDOMEvents: {
      mousedown(view, event) {
        const item = findTaskListItem(event.target);
        if (!item) return false;

        const clickX = event.clientX - item.getBoundingClientRect().left;
        const checkboxZone = Number.parseFloat(getComputedStyle(item).paddingLeft);
        if (!Number.isFinite(checkboxZone) || clickX < 0 || clickX > checkboxZone) return false;

        event.preventDefault();
        const domPosition = view.posAtDOM(item, 0);
        const resolvedPosition = view.state.doc.resolve(domPosition);
        let depth = resolvedPosition.depth;
        while (depth > 0 && resolvedPosition.node(depth).type.name !== 'list_item') depth -= 1;
        if (depth <= 0) return true;

        const node = resolvedPosition.node(depth);
        view.dispatch(view.state.tr.setNodeMarkup(
          resolvedPosition.before(depth),
          undefined,
          { ...node.attrs, checked: node.attrs.checked !== true }
        ));
        return true;
      }
    }
  }
}));

function findTaskListItem(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const item = target.closest('li[data-item-type="task"]');
  return item instanceof HTMLElement ? item : null;
}
