import { commonmark, hardbreakClearMarkPlugin, hardbreakSchema } from '@milkdown/kit/preset/commonmark';
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state';
import { AddMarkStep, Mapping, ReplaceStep } from '@milkdown/kit/prose/transform';
import { $prose } from '@milkdown/kit/utils';

// 替代 commonmark 自带的 hardbreakClearMarkPlugin：原插件以 undefined attrs 重建 hardbreak，
// 会把软换行的 isInline 重置为 false，加粗等格式后软换行被永久序列化成硬换行 `\`；
// 且原插件只检查首个事务的首个 step。这里遍历全部事务与 step，并保留节点 attrs。
export const hardbreakClearMarkPreservingAttrs = $prose((ctx) => new Plugin({
  key: new PluginKey('KNOWRA_HARDBREAK_MARKS'),
  appendTransaction: (transactions, _oldState, newState) => {
    const hardbreakType = hardbreakSchema.type(ctx);
    const ranges: Array<{ from: number; to: number }> = [];
    transactions.forEach((transaction, index) => {
      const isHardbreakInsert = Boolean(transaction.getMeta('hardbreak'));
      transaction.steps.forEach((step, stepIndex) => {
        let from: number;
        let to: number;
        if (isHardbreakInsert && step instanceof ReplaceStep) {
          from = step.from;
          to = step.from + 1;
        } else if (step instanceof AddMarkStep) {
          ({ from, to } = step);
        } else {
          return;
        }
        // step 坐标属于该 step 之后的文档，需映射到最终文档。
        const mapping = new Mapping(transaction.mapping.maps.slice(stepIndex + 1));
        for (const later of transactions.slice(index + 1)) mapping.appendMapping(later.mapping);
        ranges.push({ from: mapping.map(from, -1), to: mapping.map(to, 1) });
      });
    });
    if (!ranges.length) return null;

    const size = newState.doc.content.size;
    let tr: Transaction | null = null;
    for (const range of ranges) {
      const from = Math.max(0, Math.min(range.from, size));
      const to = Math.max(from, Math.min(range.to, size));
      newState.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type !== hardbreakType || !node.marks.length) return;
        tr = (tr ?? newState.tr).setNodeMarkup(pos, hardbreakType, node.attrs, []);
      });
    }
    return tr;
  }
}));

/** commonmark 预设，以保留 hardbreak attrs 的版本替换 hardbreakClearMarkPlugin。 */
export const commonmarkPreset = [
  ...commonmark.filter((plugin) => plugin !== hardbreakClearMarkPlugin),
  hardbreakClearMarkPreservingAttrs
];
