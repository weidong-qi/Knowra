import { replaceNoteInCollection } from '../../../lib/workspace-normalization.js';

export async function ensureNoteDetailLoaded({
  state,
  knowledgeApi,
  note,
  shouldApply = () => true
}) {
  if (state.dataMode !== 'api' || note.contentLoaded !== false) {
    return note;
  }

  const detail = await knowledgeApi.getNote(note.id, {
    includeDeleted: Boolean(note.deleted)
  });
  if (!shouldApply()) {
    return null;
  }
  state.allNotes = replaceNoteInCollection(state.allNotes, {
    ...detail,
    contentLoaded: true
  }, note);

  return state.allNotes.find((item) => item.id === note.id) ?? null;
}
