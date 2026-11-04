import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import { sortPdfAnnotations } from './pdfGeometry';

const escapeText = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]').replace(/\r?\n/g, ' ');

/** 把 PDF 标注按分类汇成一篇笔记的 Markdown：每条带摘录、评论与回到原文对应位置的链接。没有标注时返回 null。 */
export function buildPdfExtractNote(title: string, noteId: string, items: PdfAnnotation[]) {
  const alive = items.filter(item => !item.deletedAt);
  if (!alive.length) return null;
  const heading = title.replace(/\r?\n/g, ' ');
  const sourceLink = `#/materials/notes/${encodeURIComponent(noteId)}`;
  const sections = KIND_OPTIONS.flatMap(option => {
    const group = sortPdfAnnotations(alive.filter(item => item.kind === option.id));
    if (!group.length) return [];
    const entries = group.map(item => {
      const pages = [...new Set(item.segments.map(segment => segment.pageIndex + 1))].join('、');
      const body =
        item.type === 'region'
          ? '区域标注'
          : item.quoteText
              .split('\n')
              .map(line => '> ' + line)
              .join('\n');
      const link = `[第 ${pages} 页](${sourceLink}?pdfAnnotation=${encodeURIComponent(item.id)})`;
      return [body, item.comment.trim(), link].filter(Boolean).join('\n\n');
    });
    return [`## ${option.label}\n\n${entries.join('\n\n')}`];
  });
  // 笔记页已显示标题，正文不再重复一级标题。
  return `来源：[${escapeText(heading)}](${sourceLink})\n\n${sections.join('\n\n')}\n`;
}
