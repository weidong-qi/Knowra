import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  expect(screen.getByText('显示 3 / 3 条标注')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索标注和批注' }), { target: { value: 'ABC' } });
  expect(screen.getByText('显示 1 / 3 条标注')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /定位标注.*另一段/ })).toBeInTheDocument();
  await user.click(within(screen.getByRole('group', { name: '标注筛选' })).getByRole('button', { name: /标注分类/ }));
  await user.click(screen.getByRole('option', { name: '重点' }));
  expect(screen.getByText('没有匹配的标注，请调整或清除筛选。')).toBeInTheDocument();
  expect(screen.queryByText(/选中文字后点一下颜色/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '清除筛选' }));
  expect(screen.getByText('显示 3 / 3 条标注')).toBeInTheDocument();
});
