import { asArray } from '../api-response.js';

export function createNoteSideApi({ requestJson }) {
  async function loadNoteSideData({ noteId, spaceId }) {
    const encodedNoteId = encodeURIComponent(noteId ?? '');
    const encodedSpaceId = encodeURIComponent(spaceId ?? '');
    const [
      linkedPayload,
      attachmentsPayload,
      annotationsPayload,
      noteVersions,
      knowledgeItems,
      learningObjectives,
      questions
    ] = await Promise.all([
      requestJson(`/api/knowledge/notes/${encodedNoteId}/links`),
      requestJson(`/api/storage/attachments?noteId=${encodedNoteId}`),
      requestJson(`/api/knowledge/annotations?spaceId=${encodedSpaceId}&noteId=${encodedNoteId}`),
      requestJson(`/api/knowledge/notes/${encodedNoteId}/versions`),
      requestJson(`/api/knowledge/items?includeArchived=true&noteId=${encodedNoteId}`),
      requestJson('/api/knowledge/learning-objectives?includeArchived=true'),
      requestJson('/api/knowledge/questions?includeArchived=true')
    ]);

    return {
      linkedNotes: asArray(linkedPayload.data),
      attachments: asArray(attachmentsPayload.data),
      annotations: asArray(annotationsPayload.data),
      noteVersions: asArray(noteVersions.data),
      knowledgeItems: asArray(knowledgeItems.data),
      learningObjectives: asArray(learningObjectives.data),
      questions: asArray(questions.data),
      knowledgeDomainLoadState: 'loaded'
    };
  }

  return { loadNoteSideData };
}
