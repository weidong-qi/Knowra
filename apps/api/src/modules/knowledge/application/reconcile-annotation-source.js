import {
  followListAnchorChanges,
  listTracking,
  followAnchorChanges,
  calculateContentHash,
  headingPathForSourceOffset
} from '@study-accelerator/content-anchor';

/** @returns {Omit<ReturnType<typeof followAnchorChanges>, 'projection'> & { projection?: ReturnType<typeof followAnchorChanges>['projection'] }} */
export function reconcileAnnotationSource(annotation, note, oldVersion, context) {
  if (
    annotation.anchor?.tracking?.empty &&
    context?.edits?.some(edit => edit.deletedEmptyAnnotationIds?.includes(annotation.id))
  )
    return { status: 'missing', reason: 'sourceDeleted' };
  if (annotation.anchorReason === 'ambiguousMatch') return { status: 'needsReview', reason: 'ambiguousMatch' };
  if (context?.invalidMapping) return { status: 'needsReview', reason: 'mappingMismatch' };
  const before = oldVersion?.content;
  // A missing anchor stays missing unless explicitly rebound. Merely typing the same text must not revive it.
  if (annotation.anchorStatus === 'missing' && !annotation.anchor?.tracking?.cut && !context?.edits?.at(-1)?.history)
    return { status: 'missing', reason: annotation.anchorReason ?? 'sourceDeleted' };
  if (typeof before !== 'string') return { status: 'needsReview', reason: 'sourceVersionMissing' };
  if (annotation.scopeType === 'list') {
    const pendingMatches = annotation.anchor?.pending?.contentHash === calculateContentHash(context?.before ?? '');
    const base = (annotation.anchor?.tracking?.cut || pendingMatches) && context?.before ? context.before : before;
    return followListAnchorChanges(
      base,
      note.rawMarkdown,
      annotation.anchor,
      base === context?.before ? context.edits : null,
      { before: base === context?.before ? context.previousStructure : null, after: note.annotationStructure }
    );
  }
  if (annotation.anchor?.tracking?.cut && context?.before && context.edits)
    return followAnchorChanges(context.before, note.rawMarkdown, annotation.anchor, context.edits);
  return followAnchorChanges(
    before,
    note.rawMarkdown,
    annotation.anchor,
    before === context?.before ? context.edits : null
  );
}
export function reconciledAnnotationFields(annotation, note, version, result) {
  if (result.status !== 'resolved') {
    return {
      noteContentHash: calculateContentHash(note.rawMarkdown),
      anchorStatus: result.status,
      anchorReason: result.reason,
      anchor: {
        ...(result.status === 'missing' && result.anchor?.tracking?.cut ? result.anchor : annotation.anchor),
        pending:
          result.status === 'needsReview' && result.anchor
            ? {
                anchor: result.anchor,
                contentHash: calculateContentHash(note.rawMarkdown),
                reason: result.reason
              }
            : null
      }
    };
  }
  const anchor = result.anchor ?? annotation.anchor;
  const identities =
    note.annotationStructure?.nodes
      ?.filter(node => node.sourceEnd > anchor.sourceStart && node.sourceStart < anchor.sourceEnd)
      .map(node => node.id) ?? [];
  return {
    noteVersionId: version?.id ?? annotation.noteVersionId,
    noteContentHash: calculateContentHash(note.rawMarkdown),
    anchor: {
      ...anchor,
      pending: null,
      noteVersionId: version?.id ?? annotation.noteVersionId,
      tracking: {
        ...anchor.tracking,
        formatVersion: 1,
        structureRevision: note.annotationStructure?.revision ?? 0,
        memberIds: identities,
        ...(anchor.scopeType === 'list' ? listTracking(result.projection, anchor, note.annotationStructure) : {})
      }
    },
    scopeType: anchor.scopeType,
    quoteText: anchor.quoteText,
    fromPosition: anchor.sourceStart,
    toPosition: anchor.sourceEnd,
    headingPath: headingPathForSourceOffset(result.projection, anchor.sourceStart + 1),
    prefixText: anchor.prefixText,
    suffixText: anchor.suffixText,
    resolvedContentHash: calculateContentHash(anchor.quoteText),
    boundaryFingerprint: anchor.list?.memberFingerprint ?? anchor.section?.memberFingerprint ?? null,
    anchorStatus: result.status,
    anchorReason: result.reason
  };
}
