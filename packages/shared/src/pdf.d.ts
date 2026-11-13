export const MAX_PDF_BYTES: number;
export const PDF_KINDS: readonly string[];
export interface PdfSource {
  attachmentId: string;
  sha256: string;
  importRequestHash?: string;
}
export interface PdfSegment {
  pageIndex: number;
  rect: [number, number, number, number];
}
export interface PdfAnnotation {
  id: string;
  noteId: string;
  spaceId: string;
  attachmentId: string;
  sha256: string;
  type: 'highlight' | 'underline' | 'region' | 'note';
  segments: PdfSegment[];
  quoteText: string;
  /** 便签的自定义标题；旧便签缺省显示“便签”。 */
  title?: string;
  kind: string;
  comment: string;
  revision: number;
  operationId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export function validatePdfAnnotation<T extends PdfAnnotation>(value: T): T;
export function validatePdfAnnotation(value: unknown): PdfAnnotation;
export function validatePdfRelations(state: unknown): void;
