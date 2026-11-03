import { asItems, getData } from '../api-response.js';

export function createNoteApi({ requestJson }) {
  async function getNote(noteId, { includeDeleted = false } = {}) {
    const query = includeDeleted ? '?includeDeleted=true' : '';
    return getData(await requestJson(
      `/api/knowledge/notes/${encodeURIComponent(noteId)}${query}`
    ));
  }

  async function createNote(input) {
    return getData(await requestJson('/api/knowledge/notes', {
      method: 'POST',
      body: JSON.stringify(input)
    }));
  }

  async function importSingleMarkdown(item) {
    return asItems(getData(await requestJson('/api/knowledge/notes/import-markdown', {
      method: 'POST',
      body: JSON.stringify(item)
    })));
  }

  async function importBatchMarkdown(items) {
    return asItems(getData(await requestJson('/api/knowledge/notes/import-markdown-batch', {
      method: 'POST',
      body: JSON.stringify({ items })
    })));
  }

  async function importMarkdownNotes(items) {
    const normalizedItems = Array.isArray(items) ? items : [];
    return normalizedItems.length === 1
      ? importSingleMarkdown(normalizedItems[0])
      : importBatchMarkdown(normalizedItems);
  }

  async function updateNote(noteId, updates) {
    return getData(await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    }));
  }

  async function deleteNote(noteId) {
    return getData(await requestJson(
      `/api/knowledge/notes/${encodeURIComponent(noteId)}`,
      { method: 'DELETE' }
    ));
  }

  async function permanentlyDeleteNote(noteId) {
    return getData(await requestJson(
      `/api/knowledge/notes/${encodeURIComponent(noteId)}/permanent`,
      { method: 'DELETE' }
    ));
  }

  async function restoreNote(noteId) {
    return getData(await requestJson(
      `/api/knowledge/notes/${encodeURIComponent(noteId)}/restore`,
      { method: 'POST' }
    ));
  }

  async function emptyRecycleBin(spaceId) {
    return getData(await requestJson(
      `/api/knowledge/notes/recycle-bin?spaceId=${encodeURIComponent(spaceId ?? '')}`,
      { method: 'DELETE' }
    ));
  }

  async function setNoteFavorite(noteId, favorite) {
    return getData(await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}/favorite`, {
      method: 'POST',
      body: JSON.stringify({ favorite })
    }));
  }

  async function setNoteTags(noteId, tagIds) {
    return getData(await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tagIds })
    }));
  }

  async function removeTagFromNote(noteId, tagId) {
    return getData(await requestJson(
      `/api/knowledge/notes/${encodeURIComponent(noteId)}/tags/${encodeURIComponent(tagId)}`,
      { method: 'DELETE' }
    ));
  }

  return {
    getNote,
    createNote,
    importMarkdownNotes,
    updateNote,
    deleteNote,
    permanentlyDeleteNote,
    restoreNote,
    emptyRecycleBin,
    setNoteFavorite,
    setNoteTags,
    removeTagFromNote
  };
}
