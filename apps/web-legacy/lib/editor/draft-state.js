export function resolveDraftSaveState({ note, markdown, title }) {
  if (!note) {
    return {
      changed: false,
      nextMarkdown: '',
      nextTitle: ''
    };
  }

  const nextMarkdown = markdown ?? '';
  const nextTitle = String(title ?? '').trim() || note.title;

  return {
    changed: note.rawMarkdown !== nextMarkdown || note.title !== nextTitle,
    nextMarkdown,
    nextTitle
  };
}

export function createLocalDraftNote({ note, markdown, title, timestamp = new Date().toISOString() }) {
  return {
    ...note,
    title,
    rawMarkdown: markdown,
    updatedAt: timestamp
  };
}
