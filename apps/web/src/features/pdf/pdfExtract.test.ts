import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { buildPdfExtractNote } from './pdfExtract';

const mark = (id: string, kind: string, page: number, extra: Partial<PdfAnnotation> = {}): PdfAnnotation => ({
  id,
  noteId: 'n1',
  spaceId: 's',
  attachmentId: 'a',
  sha256: 'a'.repeat(64),
  type: 'highlight',
  segments: [{ pageIndex: page, rect: [1, 2, 3, 4] }],
  quoteText: `${id} 原文`,
  kind,
  comment: '',
  revision: 1,
  operationId: 'op',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  deletedAt: null,
  ...extra
});

it('按分类分组，组内按页序，附评论与回到原文的链接，跳过空分类', () => {
  const text = buildPdfExtractNote('论文 [A]', 'n 1', [
    mark('q', 'question', 4, { comment: '为什么？' }),
    mark('b', 'important', 2),
    mark('a', 'important', 0),
    mark('r', 'pitfall', 1, { type: 'region', quoteText: '' })
  ])!;
  expect(text.startsWith('来源：[论文 \\[A\\]](#/materials/notes/n%201)')).toBe(true);
  expect(text.indexOf('## 重点')).toBeLessThan(text.indexOf('## 疑问'));
  expect(text.indexOf('## 疑问')).toBeLessThan(text.indexOf('## 易错'));
  expect(text).not.toContain('## 补充');
  expect(text).not.toContain('## 普通');
  expect(text.indexOf('> a 原文')).toBeLessThan(text.indexOf('> b 原文'));
  expect(text).toContain('为什么？\n\n[第 5 页](#/materials/notes/n%201?pdfAnnotation=q)');
  expect(text).toContain('区域标注\n\n[第 2 页]');
});

it('没有可用标注时返回 null，已删除的不计入', () => {
  expect(buildPdfExtractNote('t', 'n', [])).toBeNull();
  expect(buildPdfExtractNote('t', 'n', [mark('x', 'important', 0, { deletedAt: '2026-01-02' })])).toBeNull();
});

it('便签摘录使用自定义标题，旧便签仍显示默认标题', () => {
  const text = buildPdfExtractNote('论文', 'n1', [
    mark('new', 'important', 0, { type: 'note', title: '待验证的想法', quoteText: '', comment: '验证正文' }),
    mark('old', 'important', 1, { type: 'note', quoteText: '' })
  ])!;
  expect(text).toContain('待验证的想法\n\n验证正文');
  expect(text).toContain('便签\n\n[第 2 页]');
});
