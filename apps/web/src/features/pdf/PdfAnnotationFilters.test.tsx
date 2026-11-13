import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { EMPTY_PDF_FILTER, filterPdfAnnotations } from './PdfAnnotationFilters';
import { PdfSidePanel } from './PdfSidePanel';
const items = [
  {
    id: 'one',
    kind: 'important',
    quoteText: 'Scaling Laws',
    comment: '',
    segments: [{ pageIndex: 0, rect: [1, 1, 10, 10] }]
  },
  {
    id: 'two',
    kind: 'question',
    quoteText: '另一段',
    comment: '需要复习的 ABC',
    segments: [
      { pageIndex: 0, rect: [1, 1, 10, 10] },
      { pageIndex: 2, rect: [1, 1, 10, 10] }
    ]
  },
  {
    id: 'three',
    kind: 'question',
    quoteText: '另一个',
    comment: '  ',
    segments: [{ pageIndex: 1, rect: [1, 1, 10, 10] }]
  }
] as PdfAnnotation[];
afterEach(cleanup);

it('搜索覆盖自定义便签标题，也能找到缺省标题的旧便签', () => {
  const notes = [
    { ...items[0], id: 'custom', type: 'note' as const, quoteText: '', title: '我的 ABC 猜想' },
    { ...items[0], id: 'legacy', type: 'note' as const, quoteText: '' }
  ];
  expect(filterPdfAnnotations(notes, { ...EMPTY_PDF_FILTER, query: 'ａｂｃ' }).map(item => item.id)).toEqual([
    'custom'
  ]);
  expect(filterPdfAnnotations(notes, { ...EMPTY_PDF_FILTER, query: '便签' }).map(item => item.id)).toEqual(['legacy']);
});

async function chooseFilter(user: ReturnType<typeof userEvent.setup>, group: '标注分类' | '批注状态', label: string) {
  await user.click(screen.getByRole('button', { name: /^筛选标注/ }));
  const dialog = screen.getByRole('dialog', { name: '筛选标注' });
  await user.click(within(within(dialog).getByRole('group', { name: group })).getByRole('button', { name: label }));
  await user.keyboard('{Escape}');
}

function renderEditablePanel(comment = '') {
  const changed = vi.fn();
  function ControlledPanel() {
    const [marks, setMarks] = useState(items.map(item => (item.id === 'one' ? { ...item, comment } : item)));
    return (
      <PdfSidePanel
        tab="marks"
        onTab={() => undefined}
        items={marks}
        outline={[]}
        selected="one"
        canWrite
        onClose={() => undefined}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onOutlineItem={() => undefined}
        onChange={(id, fields) => {
          changed(id, fields);
          setMarks(current => current.map(item => (item.id === id ? { ...item, ...fields } : item)));
        }}
      />
    );
  }
  render(<ControlledPanel />);
  return changed;
}
it('摘录与批注都可搜索，不区分大小写及全角字符，按跨页坐标匹配页码', () => {
  expect(filterPdfAnnotations(items, { ...EMPTY_PDF_FILTER, query: 'ｓｃａｌｉｎｇ' }).map(x => x.id)).toEqual(['one']);
  expect(
    filterPdfAnnotations(items, { query: 'abc', kind: 'question', page: '3', comment: 'with' }).map(x => x.id)
  ).toEqual(['two']);
  expect(
    filterPdfAnnotations(items, { ...EMPTY_PDF_FILTER, kind: 'question', comment: 'without' }).map(x => x.id)
  ).toEqual(['three']);
  expect(filterPdfAnnotations([{ ...items[0], deletedAt: 'removed' }], EMPTY_PDF_FILTER)).toEqual([]);
});
it('侧栏可组合筛选、显示数量并清除，空结果不会伪装为没有标注', async () => {
  const user = userEvent.setup();
  render(
    <PdfSidePanel
      tab="marks"
      onTab={() => undefined}
      items={items}
      outline={[]}
      selected={null}
      canWrite
      onClose={() => undefined}
      onSelect={() => undefined}
      onChange={() => undefined}
      onDelete={() => undefined}
      onOutlineItem={() => undefined}
    />
  );
  expect(screen.getByText('3 条标注')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: '标注分类' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索标注和批注' }), { target: { value: 'ABC' } });
  expect(screen.getByText('1 条标注')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /定位标注.*另一段/ })).toBeInTheDocument();
  await chooseFilter(user, '标注分类', '重点');
  expect(screen.getByText('没有匹配的标注，请调整或清除筛选。')).toBeInTheDocument();
  expect(screen.queryByText(/选中文字后点一下颜色/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '清除筛选' }));
  expect(screen.getByText('3 条标注')).toBeInTheDocument();

  await user.type(screen.getByRole('searchbox'), 'ABC');
  await user.click(screen.getByRole('button', { name: '筛选标注' }));
  const dialog = screen.getByRole('dialog', { name: '筛选标注' });
  await user.click(
    within(within(dialog).getByRole('group', { name: '标注分类' })).getByRole('button', { name: '疑问' })
  );
  expect(dialog).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: /标注页码/ }));
  await user.click(screen.getByRole('option', { name: '第 3 页' }));
  await user.click(
    within(within(dialog).getByRole('group', { name: '批注状态' })).getByRole('button', { name: '有批注' })
  );
  await user.keyboard('{Escape}');
  expect(screen.getByText('1 条标注')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: '筛选标注，已启用 3 项' })).toHaveFocus());

  await user.click(screen.getByRole('button', { name: /^移除 第 3 页/ }));
  expect(screen.getByRole('button', { name: '筛选标注，已启用 2 项' })).toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toHaveValue('ABC');
  await user.click(screen.getByRole('button', { name: /^筛选标注/ }));
  await user.click(screen.getByRole('button', { name: '重置筛选条件' }));
  await user.keyboard('{Escape}');
  expect(screen.getByRole('searchbox')).toHaveValue('ABC');
  expect(screen.getByText('1 条标注')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^移除 / })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '清除筛选' }));
  expect(screen.getByRole('searchbox')).toHaveValue('');
  expect(screen.getByText('3 条标注')).toBeInTheDocument();
});

it('无批注筛选下连续输入与清空评论，保留同一个编辑器和焦点', async () => {
  const user = userEvent.setup();
  const changed = renderEditablePanel();
  await chooseFilter(user, '批注状态', '无批注');
  const field = screen.getByRole('textbox', { name: '评论' });
  await user.click(field);
  await user.keyboard('h');
  expect(screen.getByRole('textbox', { name: '评论' })).toBe(field);
  expect(field).toHaveFocus();
  expect(screen.getByText('当前选中标注不符合筛选，仍可继续编辑。')).toBeInTheDocument();
  await user.keyboard('ello');
  expect(field).toHaveValue('hello');
  expect(changed).toHaveBeenLastCalledWith('one', { comment: 'hello' });
  await user.clear(field);
  expect(screen.getByRole('textbox', { name: '评论' })).toBe(field);
  expect(field).toHaveFocus();
  expect(field).toHaveValue('');
  expect(screen.queryByText('当前选中标注不符合筛选，仍可继续编辑。')).not.toBeInTheDocument();
});

it.each(['有批注', '关键词'])('%s筛选中修改评论至不匹配再恢复，编辑器持续挂载', async filter => {
  const user = userEvent.setup();
  const changed = renderEditablePanel('hello');
  if (filter === '关键词') {
    await user.type(screen.getByRole('searchbox', { name: '搜索标注和批注' }), 'hello');
  } else {
    await chooseFilter(user, '批注状态', '有批注');
  }
  const field = screen.getByRole('textbox', { name: '评论' }) as HTMLTextAreaElement;
  await user.click(field);
  field.setSelectionRange(0, field.value.length);
  await user.keyboard(filter === '关键词' ? 'world' : '{Backspace}');
  expect(screen.getByRole('textbox', { name: '评论' })).toBe(field);
  expect(field).toHaveFocus();
  expect(screen.getByText('当前选中标注不符合筛选，仍可继续编辑。')).toBeInTheDocument();
  field.setSelectionRange(0, field.value.length);
  await user.keyboard('hello');
  expect(screen.getByRole('textbox', { name: '评论' })).toBe(field);
  expect(field).toHaveFocus();
  expect(field).toHaveValue('hello');
  expect(changed).toHaveBeenLastCalledWith('one', { comment: 'hello' });
  expect(screen.queryByText('当前选中标注不符合筛选，仍可继续编辑。')).not.toBeInTheDocument();
});
