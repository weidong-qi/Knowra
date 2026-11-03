export function createClearedNoteSideData() {
  return {
    linkedNotes: [],
    attachments: [],
    annotations: [],
    noteVersions: [],
    knowledgeItems: [],
    learningObjectives: [],
    questions: [],
    knowledgeDomainLoadState: 'idle'
  };
}

export function createLocalNoteSideData({ noteId, notes = [], attachments = [] } = {}) {
  if (!noteId) {
    return createClearedNoteSideData();
  }

  const note = notes.find((item) => item.id === noteId);

  return {
    linkedNotes: (note?.internalLinks ?? [])
      .map((linkedId) => notes.find((item) => item.id === linkedId))
      .filter(Boolean),
    attachments: attachments.filter((attachment) => attachment.noteId === noteId),
    annotations: [],
    noteVersions: [],
    knowledgeItems: [],
    learningObjectives: [],
    questions: [],
    knowledgeDomainLoadState: 'idle'
  };
}
