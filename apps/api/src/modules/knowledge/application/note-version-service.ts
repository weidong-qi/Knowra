import crypto from 'node:crypto';
import { createAppError } from '../../../errors/app-error.ts';
import { NoteVersion, calculateContentHash } from '../domain/note-version.ts';
import { parseVersionPageQuery } from '../domain/note-version-page.ts';

import type { NoteRecord } from '../infrastructure/note-repository.ts';
import type { NoteVersionListOptions } from '../infrastructure/note-version-repository.ts';
import type { NoteVersionDependencies, AsyncNoteVersionDependencies } from './service-dependencies.ts';
import type { VersionPageQuery } from '../domain/note-version-page.ts';

export type VersionedNote = Pick<NoteRecord, 'id' | 'rawMarkdown' | 'updatedAt'>;

function versionId() {
  return `note-version-${crypto.randomUUID()}`;
}

export function createNoteVersionService({ repository }: NoteVersionDependencies = {}) {
  if (!repository) throw new TypeError('NoteVersion repository is required');

  function ensureForNote(note: VersionedNote, { createdBy = 'user' }: { createdBy?: string } = {}) {
    if (!note?.id) throw createAppError('NOTE_NOT_FOUND', 'Note not found', 404);
    const contentHash = calculateContentHash(note.rawMarkdown);
    const existing = repository!.findByNoteIdAndContentHash(note.id, contentHash);
    if (existing) return existing;
    return repository!.save(
      new NoteVersion({
        id: versionId(),
        noteId: note.id,
        content: note.rawMarkdown,
        contentHash,
        createdAt: note.updatedAt as string | null | undefined,
        createdBy
      })
    );
  }

  return {
    ensureForNote,
    getVersion(id: string, noteId?: string) {
      const version = repository.findById(id);
      if (!version || (noteId && version.noteId !== noteId))
        throw createAppError('NOTE_VERSION_NOT_FOUND', 'NoteVersion not found', 404);
      return version;
    },
    listVersions(options: NoteVersionListOptions = {}) {
      return repository.list(options);
    },
    listVersionIds(options: NoteVersionListOptions = {}) {
      return repository.listIds(options);
    },
    listVersionPage(note: VersionedNote, query: VersionPageQuery = {}) {
      return repository.listPage({
        ...parseVersionPageQuery(query),
        noteId: note.id,
        currentContentHash: calculateContentHash(note.rawMarkdown)
      });
    }
  };
}

export function createAsyncNoteVersionService({ repository }: AsyncNoteVersionDependencies = {}) {
  if (!repository) throw new TypeError('Async NoteVersion repository is required');

  return {
    async ensureForNote(note: VersionedNote, { createdBy = 'user' }: { createdBy?: string } = {}) {
      if (!note?.id) throw createAppError('NOTE_NOT_FOUND', 'Note not found', 404);
      const contentHash = calculateContentHash(note.rawMarkdown);
      const existing = await repository.findByNoteIdAndContentHash(note.id, contentHash);
      if (existing) return existing;
      return repository.save(
        new NoteVersion({
          id: versionId(),
          noteId: note.id,
          content: note.rawMarkdown,
          contentHash,
          createdAt: note.updatedAt as string | null | undefined,
          createdBy
        })
      );
    },
    async getVersion(id: string, noteId?: string) {
      const version = await repository.findById(id);
      if (!version || (noteId && version.noteId !== noteId))
        throw createAppError('NOTE_VERSION_NOT_FOUND', 'NoteVersion not found', 404);
      return version;
    },
    listVersions(options: { noteId?: string } = {}) {
      return repository.list(options);
    },
    listVersionIds(options: { noteId?: string } = {}) {
      return repository.listIds(options);
    },
    listVersionPage(note: VersionedNote, query: VersionPageQuery = {}) {
      return repository.listPage({
        ...parseVersionPageQuery(query),
        noteId: note.id,
        currentContentHash: calculateContentHash(note.rawMarkdown)
      });
    }
  };
}
