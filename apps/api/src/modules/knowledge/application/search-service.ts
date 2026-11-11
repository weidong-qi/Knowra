import { assertCommandSearchOwner, commandSearchInput, commandSearchResults } from './command-note-search.ts';

import type { NoteListOptions } from '../infrastructure/note-repository.ts';
import type { KnowledgeSpaceRecord } from '../infrastructure/knowledge-space-repository.ts';
import type { CommandSearchRequest, CommandSearchNote } from './command-note-search.ts';

export type SearchNotesOptions = NoteListOptions & { query?: string | null };
export interface SearchServiceDependencies<Listed extends CommandSearchNote[]> {
  listNotes: (options: NoteListOptions) => Listed;
  findKnowledgeSpace: (spaceId: string) => Pick<KnowledgeSpaceRecord, 'userId'> | null | undefined;
}

function normalizeQuery(value: string | null | undefined) {
  return value?.trim().toLowerCase() || '';
}

export function createSearchService<Listed extends CommandSearchNote[]>({
  listNotes,
  findKnowledgeSpace
}: SearchServiceDependencies<Listed>) {
  const service = {
    searchCommandNotes(input: CommandSearchRequest | undefined, ownerId: string | undefined) {
      const scoped = commandSearchInput(input);
      assertCommandSearchOwner(findKnowledgeSpace(scoped.spaceId), ownerId);
      const notes = service.searchNotes({ ...scoped, includeDeleted: false, deletedOnly: false });
      return commandSearchResults(notes, scoped);
    },
    searchNotes({
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
    }: SearchNotesOptions) {
      const normalizedQuery = normalizeQuery(query);

      if (!normalizedQuery) {
        return [];
      }

      const results = listNotes({
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
      }).filter(note => {
        const haystack = `${note.title} ${note.plainText}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      }) as Listed[number][];

      const start = offset ? Number(offset) : 0;

      if (limit) {
        return results.slice(start, start + Number(limit));
      }

      if (start > 0) {
        return results.slice(start);
      }

      return results;
    }
  };
  return service;
}
