import { getData } from '../api-response.js';

export function createTagApi({ requestJson }) {
  async function createTag(input) {
    return getData(await requestJson('/api/knowledge/tags', {
      method: 'POST',
      body: JSON.stringify(input)
    }));
  }

  async function deleteTag(tagId) {
    return getData(await requestJson(
      `/api/knowledge/tags/${encodeURIComponent(tagId)}`,
      { method: 'DELETE' }
    ));
  }

  return {
    createTag,
    deleteTag
  };
}
