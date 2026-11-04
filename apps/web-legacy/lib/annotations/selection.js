export async function hashNoteContent(markdown) {
  const bytes = new TextEncoder().encode(String(markdown ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function buildAnnotationInputFromSelection({ note, selection, markdown }) {
  if (!selection?.sourceText?.trim()) throw new Error('请先选中正文片段');
  const noteContentHash = await hashNoteContent(markdown);
  return {
    spaceId: note.spaceId, noteId: note.id, quoteText: selection.sourceText,
    headingPath: [], fromPosition: selection.startOffset, toPosition: selection.endOffset,
    prefixText: selection.contextBefore ?? '', suffixText: selection.contextAfter ?? '',
    anchorFingerprint: await hashNoteContent(`${selection.sourceText}\n${selection.contextBefore ?? ''}\n${selection.contextAfter ?? ''}`),
    noteContentHash, idempotencyKey: crypto.randomUUID(), kind: 'important', sourceMode: 'manual'
  };
}
