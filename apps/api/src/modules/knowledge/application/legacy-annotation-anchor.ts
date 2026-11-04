import {
  anchorForListItem,
  anchorForSection,
  anchorForSourceRange,
  projectMarkdown,
  resolveAnchor,
  type AnchorSegment,
  type ContentAnchor
} from '@study-accelerator/content-anchor';
import { knowraMarkSpans, stripKnowraMarksMapped } from '@study-accelerator/shared/knowra-marks';

/** 将去标记后的范围映回当前正文，拆开穿过标记语法的区间。 */
function sourceSegments(markdown: string, segments: AnchorSegment[]): AnchorSegment[] {
  const spans = [...knowraMarkSpans(markdown), { start: markdown.length, end: markdown.length }];
  return segments.flatMap(segment => {
    const result: AnchorSegment[] = [];
    let source = 0;
    let clean = 0;
    for (const span of spans) {
      const length = span.start - source;
      const start = Math.max(segment.start, clean);
      const end = Math.min(segment.end, clean + length);
      if (start < end) result.push({ ...segment, start: source + start - clean, end: source + end - clean });
      clean += length;
      source = span.end;
    }
    return result;
  });
}

/** 来源版本自身已有标记时，去标记会改变 Markdown 节点路径；只用同一位置和完整摘录重建路径。 */
function rebuildCleanAnchor(
  source: ReturnType<typeof stripKnowraMarksMapped>,
  anchor: ContentAnchor
): ContentAnchor | null {
  const projection = projectMarkdown(source.markdown);
  let rebuilt: ContentAnchor;
  if (anchor.scopeType === 'section' && anchor.section) {
    const start = source.toClean(anchor.section.sourceStart);
    const end = source.toClean(anchor.section.sourceEnd);
    const index = projection.sections.findIndex(section => section.sourceStart === start && section.sourceEnd === end);
    if (index < 0) return null;
    rebuilt = anchorForSection(projection, index);
    if (
      rebuilt.section?.headingLevel !== anchor.section.headingLevel ||
      rebuilt.section?.title !== anchor.section.title ||
      rebuilt.section?.endBoundaryLevel !== anchor.section.endBoundaryLevel ||
      rebuilt.section?.endBoundaryTitle !== anchor.section.endBoundaryTitle
    )
      return null;
  } else if (anchor.scopeType === 'list' && anchor.list) {
    const start = source.toClean(anchor.sourceStart);
    const end = source.toClean(anchor.sourceEnd);
    const item = projection.listItems.find(candidate => candidate.sourceStart === start && candidate.sourceEnd === end);
    if (!item) return null;
    rebuilt = anchorForListItem(projection, item.path, Boolean(anchor.tracking?.empty));
    if (
      rebuilt.list?.depth !== anchor.list.depth ||
      rebuilt.list?.ordered !== anchor.list.ordered ||
      rebuilt.list?.childCount !== anchor.list.childCount
    )
      return null;
  } else if (anchor.scopeType === 'selection' || anchor.scopeType === 'blocks') {
    rebuilt = anchorForSourceRange(projection, source.toClean(anchor.sourceStart), source.toClean(anchor.sourceEnd), {
      scopeType: anchor.scopeType
    });
  } else return null;
  if (
    rebuilt.quoteText !== anchor.quoteText ||
    rebuilt.sourceStart !== source.toClean(anchor.sourceStart) ||
    rebuilt.sourceEnd !== source.toClean(anchor.sourceEnd)
  )
    return null;
  return { ...rebuilt, tracking: anchor.tracking };
}

/**
 * 旧锚点的偏移属于其不可变来源版本。只换算 Knowra 标记本身，不按文字搜索或跟随编辑重定位。
 * 原版本不存在时沿用原有的固定偏移校验；原版本无法验证时保守要求核对。
 */
export function resolveLegacyAnnotationAnchor(
  markdown: string,
  anchor: ContentAnchor,
  sourceMarkdown?: string | null
): ReturnType<typeof resolveAnchor> {
  if (typeof sourceMarkdown !== 'string') return resolveAnchor(markdown, anchor);
  const original = resolveAnchor(sourceMarkdown, anchor);
  if (original.status !== 'resolved' || original.quoteText !== anchor.quoteText)
    return { ...original, status: 'needsReview', reason: 'legacySourceUnverified' };

  const source = stripKnowraMarksMapped(sourceMarkdown);
  let cleanAnchor: ContentAnchor = {
    ...anchor,
    sourceStart: source.toClean(anchor.sourceStart),
    sourceEnd: source.toClean(anchor.sourceEnd),
    segments: anchor.segments.map(segment => ({
      ...segment,
      start: source.toClean(segment.start),
      end: source.toClean(segment.end)
    })),
    ...(anchor.section && {
      section: {
        ...anchor.section,
        sourceStart: source.toClean(anchor.section.sourceStart),
        sourceEnd: source.toClean(anchor.section.sourceEnd)
      }
    })
  };
  let baseline: ReturnType<typeof resolveAnchor> | null = null;
  try {
    baseline = resolveAnchor(source.markdown, cleanAnchor);
  } catch {
    // 去标记后原节点可能消失，仍可尝试在同一偏移重建节点路径。
  }
  if (!baseline || baseline.status !== 'resolved' || baseline.quoteText !== anchor.quoteText) {
    try {
      const rebuilt = rebuildCleanAnchor(source, anchor);
      if (!rebuilt) return { ...original, status: 'needsReview', reason: 'legacySourceUnverified' };
      cleanAnchor = rebuilt;
      baseline = resolveAnchor(source.markdown, cleanAnchor);
    } catch {
      return { ...original, status: 'needsReview', reason: 'legacySourceUnverified' };
    }
  }
  if (baseline.status !== 'resolved' || baseline.quoteText !== anchor.quoteText)
    return { ...baseline, status: 'needsReview', reason: 'legacySourceUnverified' };

  const current = stripKnowraMarksMapped(markdown);
  const resolved = resolveAnchor(current.markdown, cleanAnchor);
  if (resolved.status !== 'resolved') return resolved;
  return { ...resolved, segments: sourceSegments(markdown, resolved.segments ?? []) };
}
