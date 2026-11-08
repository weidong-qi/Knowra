import type { Note } from '@study-accelerator/web-core';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { readRuntimeConfig } from '../../app/runtimeConfig';

export { randomId } from '../../browser/randomId';
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
