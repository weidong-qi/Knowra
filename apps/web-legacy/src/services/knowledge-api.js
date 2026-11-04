import { apiClient } from './api-client.js';
import { createAttachmentApi } from './knowledge-api/attachment-service.js';
import { createFolderApi } from './knowledge-api/folder-service.js';
import { createAnnotationApi } from './knowledge-api/annotation-service.js';
import { createNoteApi } from './knowledge-api/note-service.js';
import { createNoteSideApi } from './knowledge-api/note-side-service.js';
import { createTagApi } from './knowledge-api/tag-service.js';
import { createWorkspaceApi } from './knowledge-api/workspace-service.js';
import { createKnowledgeDomainApi } from './knowledge-api/knowledge-domain-service.js';

export function createKnowledgeApi({ requestJson = apiClient.requestJson } = {}) {
  return {
    ...createWorkspaceApi({ requestJson }),
    ...createNoteSideApi({ requestJson }),
    ...createFolderApi({ requestJson }),
    ...createNoteApi({ requestJson }),
    ...createTagApi({ requestJson }),
    ...createAnnotationApi({ requestJson }),
    ...createKnowledgeDomainApi({ requestJson }),
    ...createAttachmentApi({ requestJson })
  };
}

export const knowledgeApi = createKnowledgeApi();
