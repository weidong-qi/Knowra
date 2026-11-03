import crypto from 'node:crypto';
import { createAppError } from '../../../errors/app-error.js';
import { NoteVersion, calculateContentHash } from '../domain/note-version.ts';
import { parseVersionPageQuery } from '../domain/note-version-page.ts';

function versionId() {
  return `note-version-${crypto.randomUUID()}`;
}

/** @param {import('./service-dependencies.ts').NoteVersionDependencies} dependencies */
export function createNoteVersionService({ repository } = {}) {
  if (!repository) throw new TypeError('NoteVersion repository is required');

  function ensureForNote(note, { createdBy = 'user' } = {}) {
    if (!note?.id) throw createAppError('NOTE_NOT_FOUND', 'Note not found', 404);
    const contentHash = calculateContentHash(note.rawMarkdown);
    const existing = repository.findByNoteIdAndContentHash(note.id, contentHash);
    if (existing) return existing;
    return repository.save(
      new NoteVersion({
        id: versionId(),
        noteId: note.id,
        content: note.rawMarkdown,
        contentHash,
        createdAt: note.updatedAt,
        createdBy
      })
    );
  }

  return {
    ensureForNote,
    getVersion(id, noteId) {
      const version = repository.findById(id);
      if (!version || (noteId && version.noteId !== noteId))
        throw createAppError('NOTE_VERSION_NOT_FOUND', 'NoteVersion not found', 404);
      return version;
    },
    listVersions(options = {}) {
      return repository.list(options);
    },
    listVersionIds(options = {}) {
      return repository.listIds(options);
    },
    listVersionPage(note, query = {}) {
      return repository.listPage({
        ...parseVersionPageQuery(query),
        noteId: note.id,
        currentContentHash: calculateContentHash(note.rawMarkdown)
      });
    }
  };
}

/** @param {import('./service-dependencies.ts').AsyncNoteVersionDependencies} dependencies */
export function createAsyncNoteVersionService({ repository } = {}) {
  if (!repository) throw new TypeError('Async NoteVersion repository is required');

  return {
    async ensureForNote(note, { createdBy = 'user' } = {}) {
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
          createdAt: note.updatedAt,
          createdBy
        })
      );
    },
    async getVersion(id, noteId) {
      const version = await repository.findById(id);
      if (!version || (noteId && version.noteId !== noteId))
        throw createAppError('NOTE_VERSION_NOT_FOUND', 'NoteVersion not found', 404);
      return version;
    },
    listVersions(options = {}) {
      return repository.list(options);
    },
    listVersionIds(options = {}) {
      return repository.listIds(options);
    },
    listVersionPage(note, query = {}) {
      return repository.listPage({
        ...parseVersionPageQuery(query),
        noteId: note.id,
        currentContentHash: calculateContentHash(note.rawMarkdown)
      });
    }
  };
}
