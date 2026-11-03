import { describe, it, expect } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { mapAnnotationRange } from './annotationTransactionRanges';
import { appendEdit, buildEditMapping } from './annotationEditJournal';
import { applySourceEdit } from '@study-accelerator/content-anchor';
const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { group:'block',content:'text*' }, code_block: { group: 'block', content: 'text*', code: true }, heading:{group:'block',content:'text*',attrs:{level:{default:1}}}, text:{group:'inline'} } });
const paragraph=(value:string)=>schema.nodes.paragraph.create(null,value?schema.text(value):null);
function state(value='重要文字'){return EditorState.create({schema,doc:schema.nodes.doc.create(null,[paragraph(value)])});}
describe('重点事务映射',()=>{
  it('选区内部扩展，两端插入不吸附',()=>{
    const range={from:2,to:4,scopeType:'selection' as const};
    expect(mapAnnotationRange(range,state().tr.insertText('新增',3))).toMatchObject({from:2,to:6});
    expect(mapAnnotationRange(range,state().tr.insertText('新增',2))).toMatchObject({from:4,to:6});
    expect(mapAnnotationRange(range,state().tr.insertText('新增',4))).toMatchObject({from:2,to:4});
  });
  it('完整替换继承，完整删除标记 missing',()=>{
    const range={from:1,to:5,scopeType:'selection' as const};
    expect(mapAnnotationRange(range,state().tr.insertText('新内容',1,5))).toMatchObject({from:1,to:4});
    expect(mapAnnotationRange(range,state().tr.delete(1,5)).missing).toBe(true);
  });
  it('整块末尾输入继承、清空仍保留块、混合合并退为选区',()=>{
    const range={from:1,to:5,scopeType:'blocks' as const};
    expect(mapAnnotationRange(range,state().tr.insertText('新增',5))).toMatchObject({from:1,to:7,scopeType:'blocks'});
    expect(mapAnnotationRange(range,state().tr.delete(1,5))).toMatchObject({from:1,to:1,scopeType:'blocks'});
    const doc=schema.nodes.doc.create(null,[paragraph('重要文字'),paragraph('其他')]);
    const current=EditorState.create({schema,doc});
    expect(mapAnnotationRange(range,current.tr.join(6))).toMatchObject({from:1,to:5,scopeType:'selection'});
  });
  it('段落中间拆分继承，末尾新段落不继承',()=>{
    const range={from:1,to:5,scopeType:'blocks' as const};
    expect(mapAnnotationRange(range,state().tr.split(3))).toMatchObject({from:1,to:7,scopeType:'blocks'});
    expect(mapAnnotationRange(range,state().tr.split(5))).toMatchObject({from:1,to:5,scopeType:'blocks'});
  });
  it('保存映射保留删除后重输过程，不折叠成相同正文',()=>{
    const entries=appendEdit(appendEdit([],'文字',''),'','文字');
    const mapping=buildEditMapping('文字','文字',entries)!;
    expect(mapping.edits).toHaveLength(2);
    expect(mapping.edits.reduce(applySourceEdit,'文字')).toBe('文字');
  });
  it('序列化末尾换行和内部编辑分开记录',()=>{
    const mapping=buildEditMapping('重要文字','重新增要文字\n',appendEdit([],'重要文字','重新增要文字\n'))!;
    expect(mapping.edits).toHaveLength(2);
    expect(mapping.edits[0]).toMatchObject({from:1,to:1,text:'新增'});
  });
});

it('整段代码选区保留scope并继承末尾输入，部分代码仍排他，清空不复活', () => {
  const doc = schema.nodes.doc.create(null, [schema.nodes.code_block.create(null, schema.text('甲\n乙'))]);
  const current = EditorState.create({ schema, doc });
  const full = { from: 1, to: 4, scopeType: 'selection' as const };
  expect(mapAnnotationRange(full, current.tr.insertText('\n新增', 4))).toMatchObject({ from: 1, to: 7, scopeType: 'selection' });
  expect(mapAnnotationRange({ ...full, from: 3 }, current.tr.insertText('\n新增', 4))).toMatchObject({ from: 3, to: 4 });
  expect(mapAnnotationRange(full, current.tr.delete(1, 4)).missing).toBe(true);
});
