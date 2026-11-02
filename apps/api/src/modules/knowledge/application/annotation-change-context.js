import { updateStructure } from '@study-accelerator/content-anchor';

/**
 * 正文保存的变更上下文：保存前的正文，以及随正文维护的旧结构表（字段留到 I4c 删除）。
 * 重点内联化 I4b 起不再使用客户端的编辑映射与编辑器身份快照，旧客户端带来的 annotationMapping 直接忽略。
 */
export function prepareAnnotationChange(current, markdown) {
  return {
    before: current.rawMarkdown,
    structure: updateStructure(current.rawMarkdown, markdown, current.annotationStructure)
  };
}
