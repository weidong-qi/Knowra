import { createNoteSummary } from '../note-summary.ts';
import { assertCommandSearchOwner, commandSearchInput, commandSearchResults } from '../command-note-search.ts';

import type { NoteListOptions } from '../../infrastructure/note-repository.ts';
import type { KnowledgeSpaceRecord } from '../../infrastructure/knowledge-space-repository.ts';
import type { CommandSearchRequest, CommandSearchNote } from '../command-note-search.ts';
import type { SearchNotesOptions } from '../search-service.ts';

type MaybePromise<Value> = Value | PromiseLike<Value>;
export interface AsyncSearchServiceDependencies<Listed extends CommandSearchNote[]> {
  listNotes: (options: NoteListOptions) => MaybePromise<Listed>;
  findKnowledgeSpace: (spaceId: string) => MaybePromise<Pick<KnowledgeSpaceRecord, 'userId'> | null | undefined>;
}

function normalizeQuery(value: string | null | undefined) {
  return value?.trim().toLowerCase() || '';
}

export function createAsyncSearchService<Listed extends CommandSearchNote[]>({
  listNotes,
  findKnowledgeSpace
}: AsyncSearchServiceDependencies<Listed>) {
  const service = {
    async searchCommandNotes(input: CommandSearchRequest | undefined, ownerId: string | undefined) {
      const scoped = commandSearchInput(input);
      assertCommandSearchOwner(await findKnowledgeSpace(scoped.spaceId), ownerId);
      const notes = await service.searchNotes({ ...scoped, includeDeleted: false, deletedOnly: false });
      return commandSearchResults(notes, scoped);
    },
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
    }: SearchNotesOptions) {
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
      ).filter(note => `${note.title} ${note.plainText}`.toLowerCase().includes(normalizedQuery)) as Listed[number][];
      const start = offset ? Number(offset) : 0;
      if (limit) return results.slice(start, start + Number(limit));
      return start > 0 ? results.slice(start) : results;
    }
  };
  return service;
}

export { createNoteSummary };
