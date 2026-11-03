import { describe, expect, it } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { history, undo, redo } from '@milkdown/kit/prose/history';
import { fittedImageSize, imageRatioAttrs, readImageSize, setImageRatio } from './editorImageModel';

describe('图片比例与兼容格式', () => {
  it('旧数字 alt 继续保存比例且原标题不变', () => {
    const attrs = { src: '/api/attachments/a/content', alt: '0.66', title: '旧图说明' };
    expect(readImageSize(attrs)).toEqual({ ratio: 0.66, title: '旧图说明', legacy: true });
    expect(imageRatioAttrs(attrs, 0.4)).toEqual({ ...attrs, alt: '0.40' });
  });
  it('普通说明/title/src 原样保留，重复调整只更新一个比例标记，适应宽度清除标记', () => {
    const attrs = { src: '/api/attachments/a/content', alt: '这是说明', title: '标题 "特殊字符"' };
    const small = imageRatioAttrs(attrs, 0.4);
    const medium = imageRatioAttrs(small, 0.66);
    expect(readImageSize(medium)).toEqual({ ratio: 0.66, title: attrs.title, legacy: false });
    expect(medium.alt).toBe(attrs.alt); expect(medium.src).toBe(attrs.src);
    expect(imageRatioAttrs(medium, 1)).toEqual(attrs);
  });
  it('长图与小图等比缩放且不越过可用宽度，无效比例有界', () => {
    expect(fittedImageSize(800, 500, 0.4)).toEqual({ baseline: 500, width: 200 });
    expect(fittedImageSize(100, 500, 1)).toEqual({ baseline: 100, width: 100 });
    expect(fittedImageSize(800, 500, 4).width).toBe(500);
    expect(fittedImageSize(800, 500, NaN).width).toBe(500);
    expect(fittedImageSize(800, 500, -1).width).toBe(50);
  });
});

it('连续比例操作分别撤销重做并保留邻近正文；非图片选区不写入', () => {
  const schema = new Schema({ nodes: {
    doc: { content: 'paragraph+' }, paragraph: { content: 'inline*' }, text: { group: 'inline' },
    image: { group: 'inline', inline: true, atom: true, attrs: { src: {}, alt: {}, title: { default: null } } }
  } });
  const image = schema.node('image', { src: '/attachment', alt: '说明', title: '标题' });
  const doc = schema.node('doc', null, schema.node('paragraph', null, [schema.text('之前'), image, schema.text('之后')]));
  let state = EditorState.create({ doc, selection: NodeSelection.create(doc, 3), plugins: [history()] });
  const snapshots = [state.doc];
  for (const ratio of [0.4, 0.66, 1]) {
    expect(setImageRatio(ratio)(state, tr => { state = state.apply(tr); })).toBe(true);
    snapshots.push(state.doc);
  }
  for (let index = 2; index >= 0; index--) {
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(snapshots[index])).toBe(true);
  }
  for (let index = 1; index <= 3; index++) {
    expect(redo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(snapshots[index])).toBe(true);
  }
  expect(state.doc.textContent).toBe('之前之后');
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  expect(setImageRatio(0.4)(state)).toBe(false);
});
