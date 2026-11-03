import type { Note } from '@study-accelerator/web-core';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { readRuntimeConfig } from '../../app/runtimeConfig';

/** 局域网 HTTP 页面不是安全上下文，crypto.randomUUID 不可用，退回 getRandomValues 生成 v4 UUID。 */
export function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function pdfHeaders(): Record<string, string> {
  const id = readRuntimeConfig().datasetId;
  return id ? { 'X-Knowra-Dataset': id } : {};
}
export async function pdfRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: new Headers({ ...pdfHeaders(), ...Object.fromEntries(new Headers(options.headers).entries()) })
  });
  const payload = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(payload.error?.message ?? 'PDF 操作失败'), { code: payload.error?.code });
  return payload.data as T;
}
export const pdfFileUrl = (id: string) => `/api/storage/pdf-files/${encodeURIComponent(id)}`;
export const annotationUrl = (noteId: string, id?: string) =>
  `/api/pdf/${encodeURIComponent(noteId)}/annotations${id ? `/${encodeURIComponent(id)}` : ''}`;
export const listPdfAnnotations = (noteId: string) => pdfRequest<PdfAnnotation[]>(annotationUrl(noteId));
export function importPdf(
  file: File,
  metadata: { spaceId: string; folderId: string | null; operationId: string },
  signal: AbortSignal,
  onProgress: (value: number) => void
): Promise<Note> {
  const params = new URLSearchParams({
    spaceId: metadata.spaceId,
    fileName: file.name,
    operationId: metadata.operationId
  });
  if (metadata.folderId) params.set('folderId', metadata.folderId);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const cancel = () => xhr.abort();
    xhr.open('POST', `/api/storage/pdf-imports?${params}`);
    xhr.setRequestHeader('Content-Type', 'application/pdf');
    for (const [name, value] of Object.entries(pdfHeaders())) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.round((100 * event.loaded) / event.total));
    };
    xhr.onload = () => {
      try {
        const value = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300) reject(new Error(value.error?.message ?? 'PDF 导入失败'));
        else resolve(value.data);
      } catch {
        reject(new Error('PDF 导入响应无效，请使用原操作重试'));
      }
    };
    xhr.onerror = () => reject(new Error('PDF 上传中断，请重试'));
    xhr.onabort = () => reject(new DOMException('已取消 PDF 导入', 'AbortError'));
    xhr.onloadend = () => signal.removeEventListener('abort', cancel);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    else xhr.send(file);
  });
}
