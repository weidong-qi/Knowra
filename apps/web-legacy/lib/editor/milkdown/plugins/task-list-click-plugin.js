import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { closestFromEventTarget } from '../../../dom/event-target.js';

export const taskListClickBehavior = $prose(() => new Plugin({
  key: new PluginKey('STUDY_TASK_LIST_CLICK'),
  props: {
    handleDOMEvents: {
      mousedown(view, event) {
        const li = closestFromEventTarget(event.target, 'li[data-item-type="task"]');
        if (!(li instanceof HTMLElement)) {
          return false;
        }

        const liRect = li.getBoundingClientRect();
        const clickX = event.clientX - liRect.left;
        const checkboxZone = parseFloat(getComputedStyle(li).paddingLeft) || (1.8 * 16);
        if (clickX < 0 || clickX > checkboxZone) {
          return false;
        }

        event.preventDefault();

        const domPos = view.posAtDOM(li, 0);
        if (typeof domPos !== 'number') {
          return true;
        }

        const resolvedPos = view.state.doc.resolve(domPos);
        let depth = Math.min(resolvedPos.depth, 20);
        while (depth > 0 && resolvedPos.node(depth).type.name !== 'list_item') {
          depth -= 1;
        }
        if (depth <= 0) {
          return true;
        }

        const listItemNode = resolvedPos.node(depth);
        const currentChecked = listItemNode.attrs.checked;
        const newChecked = currentChecked === true ? false : true;

        view.dispatch(view.state.tr.setNodeMarkup(
          resolvedPos.before(depth),
          undefined,
          { ...listItemNode.attrs, checked: newChecked }
        ));
        return true;
      }
    }
  }
}));
