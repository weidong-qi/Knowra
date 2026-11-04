import { getData } from '../api-response.js';

export function createAnnotationApi({ requestJson }) {
  return {
    async createAnnotation(input) {
      return getData(await requestJson('/api/knowledge/annotations', { method: 'POST', body: JSON.stringify(input) }));
    },
    async listAnnotations({ noteId, spaceId }) {
      return getData(await requestJson(`/api/knowledge/annotations?noteId=${encodeURIComponent(noteId)}&spaceId=${encodeURIComponent(spaceId ?? '')}`));
    },
    async deleteAnnotation(id) {
      return getData(await requestJson(`/api/knowledge/annotations/${encodeURIComponent(id)}`, { method: 'DELETE' }));
    },
    async restoreAnnotation(id) {
      return getData(await requestJson(`/api/knowledge/annotations/${encodeURIComponent(id)}/restore`, { method: 'POST' }));
    },
    async updateAnnotationAnchor(id, input) {
      return getData(await requestJson(`/api/knowledge/annotations/${encodeURIComponent(id)}/anchor`, { method: 'PATCH', body: JSON.stringify(input) }));
    }
  };
}
