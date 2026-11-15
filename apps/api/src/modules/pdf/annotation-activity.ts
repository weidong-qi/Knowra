import type { PdfAnnotation } from '@study-accelerator/shared/pdf';

/** 批注与资料共用本次修改时间；同一毫秒内的连续操作也必须推进版本。 */
export function recordPdfAnnotationActivity(
  note: { updatedAt?: unknown },
  annotation: Pick<PdfAnnotation, 'updatedAt' | 'deletedAt'>
) {
  const previous = typeof note.updatedAt === 'string' ? Date.parse(note.updatedAt) : NaN;
  const updatedAt = new Date(
    Math.max(Date.now(), Date.parse(annotation.updatedAt), Number.isFinite(previous) ? previous + 1 : 0)
  ).toISOString();
  note.updatedAt = updatedAt;
  annotation.updatedAt = updatedAt;
  if (annotation.deletedAt) annotation.deletedAt = updatedAt;
}
