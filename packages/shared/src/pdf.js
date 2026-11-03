export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const PDF_KINDS = ['important', 'question', 'supplement', 'pitfall', 'temporary'];
export const PDF_IMPORTANCE = ['normal', 'important', 'core'];

export function validatePdfAnnotation(value) {
  const validText = (text, limit) => typeof text === 'string' && text.length <= limit;
  if (
    !value ||
    !['id', 'noteId', 'spaceId', 'attachmentId', 'operationId'].every(
      key => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 200
    ) ||
    !/^[a-f0-9]{64}$/.test(value.sha256 ?? '') ||
    !['highlight', 'region'].includes(value.type) ||
    !PDF_KINDS.includes(value.kind) ||
    !PDF_IMPORTANCE.includes(value.importance) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !validText(value.quoteText, 100000) ||
    !validText(value.comment, 2000) ||
    !Array.isArray(value.segments) ||
    !value.segments.length ||
    value.segments.length > 2000 ||
    value.segments.some(
      segment =>
        !Number.isInteger(segment.pageIndex) ||
        segment.pageIndex < 0 ||
        !Array.isArray(segment.rect) ||
        segment.rect.length !== 4 ||
        segment.rect.some(n => !Number.isFinite(n) || Math.abs(n) > 10000000) ||
        segment.rect[2] <= segment.rect[0] ||
        segment.rect[3] <= segment.rect[1]
    ) ||
    (value.type === 'region' && value.segments.length !== 1) ||
    (value.type === 'highlight' && !value.quoteText.trim()) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    (value.deletedAt != null && !Number.isFinite(Date.parse(value.deletedAt)))
  ) {
    throw new Error('PDF 标注格式无效');
  }
  return value;
}

export function validatePdfRelations(state) {
  const notes = new Map(state.notes.map(note => [note.id, note]));
  const files = new Map(state.attachments.map(file => [file.id, file]));
  for (const note of state.notes) {
    if (note.contentKind !== undefined && !['markdown', 'pdf'].includes(note.contentKind))
      throw new Error('资料类型无效');
    if (note.contentKind !== 'pdf') {
      if (note.pdfSource != null) throw new Error('Markdown 资料不能绑定 PDF 主文件');
      continue;
    }
    const file = files.get(note.pdfSource?.attachmentId);
    if (
      note.rawMarkdown !== '' ||
      !file ||
      file.noteId !== note.id ||
      file.mimeType !== 'application/pdf' ||
      file.sha256 !== note.pdfSource.sha256 ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      file.size <= 0 ||
      file.size > MAX_PDF_BYTES
    ) {
      throw new Error('PDF 主文件引用无效');
    }
  }
  for (const annotation of state.pdfAnnotations ?? []) {
    validatePdfAnnotation(annotation);
    const note = notes.get(annotation.noteId);
    if (
      note?.contentKind !== 'pdf' ||
      note.spaceId !== annotation.spaceId ||
      note.pdfSource.attachmentId !== annotation.attachmentId ||
      note.pdfSource.sha256 !== annotation.sha256
    ) {
      throw new Error('PDF 标注来源无效');
    }
  }
}
