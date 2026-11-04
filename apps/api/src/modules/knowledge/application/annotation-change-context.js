import { calculateContentHash, updateStructure } from '@study-accelerator/content-anchor';
import { createAppError } from '../../../errors/app-error.js';

/**
 * 正文保存的变更上下文：保存前的正文，以及随正文维护的旧结构表（字段留到 I4c 删除）。
 * 不再使用旧编辑映射推导重点；缺少时间戳时仍校验旧客户端提供的正文基线。
 */
export function prepareAnnotationChange(current, markdown, legacyMapping = null) {
  if (legacyMapping && legacyMapping.baseContentHash !== calculateContentHash(current.rawMarkdown)) {
    throw createAppError('NOTE_UPDATE_CONFLICT', '笔记正文已变化，请保留草稿并重新加载', 409);
  }
  return {
    before: current.rawMarkdown,
    structure: updateStructure(current.rawMarkdown, markdown, current.annotationStructure)
  };
}
