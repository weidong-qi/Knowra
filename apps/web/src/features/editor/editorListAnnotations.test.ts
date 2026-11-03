import { describe, it, expect } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { projectMarkdown } from '@study-accelerator/content-anchor';
import { editorListAnchor, listItemAt, resolveEditorListRange } from './editorListAnnotations';
import { mapAnnotationRange } from './annotationTransactionRanges';
import { getAnnotationSelection } from './editorAnnotations';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { content: 'text*', group: 'block' }, text: {},
  bullet_list: { content: 'list_item+', group: 'block' }, ordered_list: { content: 'list_item+', group: 'block' },
  list_item: { content: 'paragraph block*', attrs: { checked: { default: null } } }
} });
const paragraph = (text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
const item = (text: string, child?: ReturnType<typeof paragraph>) => schema.nodes.list_item.create(null, [paragraph(text), ...(child ? [child] : [])]);
const list = (...items: ReturnType<typeof item>[]) => schema.nodes.bullet_list.create(null, items);
function fixture() {
  const doc = schema.nodes.doc.create(null, [list(item('父项', list(item('子项'))), item('相邻'))]);
  const positions: number[] = [];
  doc.descendants((node, pos) => { if (node.type.name === 'list_item') positions.push(pos); });
  return { doc, positions, projection: projectMarkdown('- 父项\n  - 子项\n- 相邻') };
}
describe('独立列表标记', () => {
  it('祖先查找选择最近的列表项，任务项不可创建', () => {
    const { doc, positions } = fixture();
    expect(listItemAt(doc, positions[1] + 2)?.position).toBe(positions[1]);
    const task = schema.nodes.doc.create(null, [list(schema.nodes.list_item.create({ checked: false }, [paragraph('任务')]))]);
    expect(editorListAnchor(task, projectMarkdown('- [ ] 任务'), 3)).toBeNull();
  });
  it('父项覆盖子树，子项不覆盖父项或相邻项', () => {
    const { doc, positions, projection } = fixture();
    const parent = editorListAnchor(doc, projection, positions[0] + 2)!;
    const child = editorListAnchor(doc, projection, positions[1] + 2)!;
    expect(parent.quoteText).toBe('父项\n子项'); expect(child.quoteText).toBe('子项');
    expect(parent.scopeType).toBe('list'); expect(parent.list?.childCount).toBe(1);
    expect(resolveEditorListRange(doc, child.structurePath!, child.quoteText)?.from).toBe(positions[1] + 1);
  });
  it('完整列表范围经命令生成，不使用块或选区类型', () => {
    const { doc, positions } = fixture();
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, positions[0] + 2) });
    const editor = { ctx: { get: () => ({ state }) } } as unknown as Parameters<typeof getAnnotationSelection>[0];
    const selected = getAnnotationSelection(editor, '- 父项\n  - 子项\n- 相邻', 'list');
    expect(selected?.scopeType).toBe('list'); expect(selected?.quoteText).toBe('父项\n子项');
  });
  it('在根项末尾编辑实时扩展，重复项严格按路径定位', () => {
    const { doc, positions } = fixture(), state = EditorState.create({ doc });
    const root = listItemAt(doc, positions[0] + 2)!;
    const range = { from: root.from, to: root.to, scopeType: 'list' as const };
    const mapped = mapAnnotationRange(range, state.tr.insertText('新增', positions[0] + 4));
    expect(mapped.needsReview).toBeFalsy(); expect(mapped.to).toBe(root.to + 2);
    const repeated = schema.nodes.doc.create(null, [list(item('重复'), item('重复'))]);
    const first = resolveEditorListRange(repeated, '0.0', '重复')!;
    const second = resolveEditorListRange(repeated, '0.1', '重复')!;
    expect(second.from).toBeGreaterThan(first.from);
  });
});
