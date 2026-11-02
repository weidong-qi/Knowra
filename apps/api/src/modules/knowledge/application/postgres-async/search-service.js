import { createNoteSummary } from '../note-summary.js';
import { assertCommandSearchOwner, commandSearchInput, commandSearchResults } from '../command-note-search.js';

function normalizeQuery(value) {
  return value?.trim().toLowerCase() || '';
}

export function createAsyncSearchService({ listNotes, findKnowledgeSpace }) {
  const service = {
    async searchCommandNotes(input, ownerId) {
      const scoped = commandSearchInput(input);
      assertCommandSearchOwner(await findKnowledgeSpace(scoped.spaceId), ownerId);
      const notes = await service.searchNotes({ ...scoped, includeDeleted: false, deletedOnly: false });
      return commandSearchResults(notes, scoped);
    },
    /** @param {import("../../infrastructure/note-repository.ts").NoteListOptions & { query?: string }} options */
    async searchNotes({
      query,
      spaceId,
      folderId = null,
      tagId = null,
      tagIds = [],
      tagMatch,
      match,
      sortBy,
      order,
      limit,
      offset,
      includeDeleted,
      deletedOnly,
      favoriteOnly
    }) {
      const normalizedQuery = normalizeQuery(query);
      if (!normalizedQuery) return [];
      const results = (
        await listNotes({
          spaceId,
          folderId,
          tagId,
          tagIds,
          tagMatch: tagMatch ?? match,
          sortBy,
          order,
          includeDeleted,
          deletedOnly,
          favoriteOnly
        })
      ).filter(note => `${note.title} ${note.plainText}`.toLowerCase().includes(normalizedQuery));
      const start = offset ? Number(offset) : 0;
      if (limit) return results.slice(start, start + Number(limit));
      return start > 0 ? results.slice(start) : results;
    }
  };
  return service;
}

export { createNoteSummary };
