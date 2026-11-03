import { useEffect, useRef, useState } from 'react';
import type { DocumentDTO, TaskWorkspaceApi } from '@study-accelerator/web-core';
import { WorkspaceDocumentEditor } from './WorkspaceDocumentEditor';
import { uploadWorkspaceImage } from './taskWorkspaceClient';
import { taskError } from './taskPresentation';
export function WorkspaceDocumentPane({ api, workspaceId, documentId, versionId, datasetId, datasetEpoch, archived, onChanged }: {
  api: TaskWorkspaceApi; workspaceId: string; documentId: string; versionId?: string;
  datasetId: string; datasetEpoch: string; archived: boolean; onChanged(): void;
}) {
  const [document, setDocument] = useState<DocumentDTO | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    const ticket = ++generation.current;
    void api.getFullDocument({ workspaceId, documentId, versionId }).then(value => { if (alive.current && ticket === generation.current) setDocument(value); }).catch(error => { if (alive.current && ticket === generation.current) setError(taskError(error)); });
    return () => { alive.current = false; ++generation.current; };
  }, [api, workspaceId, documentId, versionId]);
  if (error) return <p role="alert">{error}</p>;
  if (!document) return <p role="status">正在加载文档…</p>;
  return <WorkspaceDocumentEditor document={document} datasetId={datasetId} datasetEpoch={datasetEpoch} readOnly={archived || Boolean(versionId)}
    onReload={() => api.getFullDocument({ workspaceId, documentId, versionId })}
    onSave={async draft => {
      const result = await api.updateDocument({ workspaceId, documentId, operationId: crypto.randomUUID(), expectedRevision: draft.baseRevision, title: draft.title, markdown: draft.markdown });
      const saved = { ...result.data.document, markdown: draft.markdown, start: 0, end: draft.markdown.length, hasMore: false };
      if (alive.current) onChanged(); return saved;
    }}
    onUpload={async (file, expectedRevision) => {
      const result = await uploadWorkspaceImage({ workspaceId, documentId, datasetEpoch, operationId: crypto.randomUUID(), expectedRevision, file });
      if (alive.current) onChanged(); return result;
    }} />;
}
