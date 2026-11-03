import { ApiRequestError, createApiClient, createTaskWorkspaceApi, type MutationResult, type UploadAttachmentResult } from '@study-accelerator/web-core';
export const taskWorkspaceApi = createTaskWorkspaceApi(createApiClient().requestJson);
export function createEpochTaskWorkspaceApi(datasetEpoch: string | null) { return createTaskWorkspaceApi(createApiClient().requestJson, { datasetEpoch: () => datasetEpoch }); }
export async function uploadWorkspaceImage(input: { workspaceId: string; documentId: string; datasetEpoch: string; expectedRevision: number; operationId: string; file: File }): Promise<UploadAttachmentResult> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(input.file.type) || input.file.size > 5 * 1024 * 1024) throw new Error('仅支持不超过 5 MiB 的 PNG、JPEG 或 WebP。');
  const body = new FormData();
  body.append('file', input.file);
  body.append('operationId', input.operationId);
  body.append('expectedRevision', String(input.expectedRevision));
  const response = await fetch(`/api/task-workspaces/${encodeURIComponent(input.workspaceId)}/documents/${encodeURIComponent(input.documentId)}/attachments`, { method: 'POST', headers: { 'X-Task-Workspace-Epoch': input.datasetEpoch }, body });
  if (!response.ok) throw new ApiRequestError('图片上传未完成。', { status: response.status });
  const payload = await response.json() as { data: MutationResult<UploadAttachmentResult> };
  return payload.data.data;
}
