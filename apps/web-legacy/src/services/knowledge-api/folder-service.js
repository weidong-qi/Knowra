import { getData } from '../api-response.js';

export function createFolderApi({ requestJson }) {
  async function createFolder(input) {
    return getData(await requestJson('/api/knowledge/folders', {
      method: 'POST',
      body: JSON.stringify(input)
    }));
  }

  async function updateFolder(folderId, updates) {
    return getData(await requestJson(`/api/knowledge/folders/${encodeURIComponent(folderId)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    }));
  }

  async function deleteFolder(folderId) {
    return getData(await requestJson(
      `/api/knowledge/folders/${encodeURIComponent(folderId)}`,
      { method: 'DELETE' }
    ));
  }

  return {
    createFolder,
    updateFolder,
    deleteFolder
  };
}
