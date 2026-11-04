import { NodeSelection, type Command, type EditorState } from '@milkdown/kit/prose/state';
import { closeHistory } from '@milkdown/kit/prose/history';

const marker = /(?:^| )\{knowra-image-ratio=(\d+(?:\.\d+)?)\}$/;
const legacyRatio = /^\d+(?:\.\d+)?$/;
export function normalizeImageRatio(value: number): number {
  return Number.isFinite(value) ? Math.max(0.1, Math.min(4, value)) : 1;
}
/** 旧版以数字 alt 存比例；普通 Markdown 保留 alt/title，用保留的 title 尾标记记录比例。 */
export function readImageSize(attrs: { alt?: string | null; title?: string | null }) {
  const title = attrs.title ?? '';
  const match = title.match(marker);
  const legacy = !match && legacyRatio.test(attrs.alt ?? '') && Number(attrs.alt) > 0;
  return { title: match ? title.slice(0, match.index) : title,
    ratio: normalizeImageRatio(match ? Number(match[1]) : legacy ? Number(attrs.alt) : 1), legacy };
}
export function imageRatioAttrs(attrs: Record<string, unknown>, value: number): Record<string, unknown> {
  const current = readImageSize(attrs);
  const ratio = normalizeImageRatio(value).toFixed(2);
  if (current.legacy) return { ...attrs, alt: ratio };
  const title = Number(ratio) === 1 ? current.title : `${current.title ? `${current.title} ` : ''}{knowra-image-ratio=${ratio}}`;
  return { ...attrs, title: title || null };
}
export function fittedImageSize(naturalWidth: number, availableWidth: number, ratio: number) {
  const baseline = Math.min(naturalWidth, availableWidth);
  return { baseline, width: Math.min(availableWidth, baseline * normalizeImageRatio(ratio)) };
}
export function selectedImage(state: EditorState) {
  const selection = state.selection;
  return selection instanceof NodeSelection && selection.node.type.name === 'image'
    ? { pos: selection.from, node: selection.node, ...readImageSize(selection.node.attrs) } : null;
}
export function setImageRatio(ratio: number): Command {
  return (state, dispatch) => {
    const image = selectedImage(state);
    if (!image) return false;
    const attrs = imageRatioAttrs(image.node.attrs, ratio);
    if (dispatch && JSON.stringify(attrs) !== JSON.stringify(image.node.attrs)) {
      const transaction = state.tr.setNodeMarkup(image.pos, undefined, attrs);
      transaction.setSelection(NodeSelection.create(transaction.doc, image.pos));
      dispatch(closeHistory(transaction));
    }
    return true;
  };
}
