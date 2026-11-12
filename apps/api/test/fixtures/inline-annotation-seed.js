import { inlineAnnotationId } from '../../src/modules/knowledge/application/inline-annotations.ts';

/**
 * 重点内联化后，重点只能写在正文标记里：测试用带标记的正文建笔记或保存正文，由服务端派生重点行。
 * markText 生成选区重点标记；annotationOf 按标记 ID 取回派生出的重点行。
 */
export const markText = (text, id, importance = null) =>
  `<mark data-k="${id}" data-t="key"${importance ? ` data-l="${importance}"` : ''}>${text}</mark>`;

export const annotationOf = (knowledge, noteId, markId) =>
  knowledge.contentAnnotationService.getAnnotation(inlineAnnotationId(noteId, markId));

/** 给笔记按空行分出的第 index 段加选区重点并保存；marks 为 [index, importance, id?] 列表，返回保存后的笔记。 */
export function markParagraphs(knowledge, note, marks) {
  const paragraphs = note.rawMarkdown.split('\n\n');
  for (const [index, importance, id = `p${index}`] of marks)
    paragraphs[index] = markText(paragraphs[index], id, importance);
  return knowledge.noteService.updateNote(note.id, { rawMarkdown: paragraphs.join('\n\n') });
}
