import { followListAnchor, followSectionAnchor, relocateAnchor } from '@study-accelerator/content-anchor';

/** 旧来源范围不再有效是可恢复的标注状态；其他程序或存储错误继续上抛。
 * @returns {Omit<ReturnType<typeof relocateAnchor>, 'projection'> & { projection?: ReturnType<typeof relocateAnchor>['projection'] }}
 */
export function resolveStoredAnnotation(markdown, annotation) {
  if (annotation.anchor?.pending) return { status: 'needsReview', reason: annotation.anchor.pending.reason };
  try {
    if (annotation.scopeType === 'list') return followListAnchor(markdown, annotation.anchor);
    return annotation.scopeType === 'section'
      ? followSectionAnchor(markdown, annotation.anchor)
      : relocateAnchor(markdown, annotation.anchor);
  } catch (error) {
    if (
      !(error instanceof RangeError) ||
      /** @type {Error & Partial<Pick<import('../../../errors/app-error.ts').AppError, 'code'>>} */ (error).code !==
        'ANNOTATION_RANGE_INVALID'
    )
      throw error;
    return { status: 'needsReview', reason: 'invalidStoredAnchor' };
  }
}
