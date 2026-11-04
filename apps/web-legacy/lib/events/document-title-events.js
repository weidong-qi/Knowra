import { closestFromEventTarget } from '../dom/event-target.js';

export function bindDocumentTitleEvents({ state, elements, deps }) {
  const {
    getCurrentNote,
    persistDraft,
    scheduleAutosave,
    flashStatus
  } = deps;

  elements.editorDocumentHead?.addEventListener('input', (event) => {
    const input = closestFromEventTarget(event.target, '[data-document-title-input]');
    if (!input) {
      return;
    }

    state.draftTitle = input.value;
    scheduleAutosave();
  });

  elements.editorDocumentHead?.addEventListener('keydown', (event) => {
    const input = closestFromEventTarget(event.target, '[data-document-title-input]');
    if (!input) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      const note = getCurrentNote();
      state.draftTitle = note?.title ?? '';
      input.value = state.draftTitle;
      input.blur();
    }
  });

  elements.editorDocumentHead?.addEventListener('focusout', (event) => {
    const input = closestFromEventTarget(event.target, '[data-document-title-input]');
    if (!input) {
      return;
    }

    const note = getCurrentNote();
    const nextTitle = input.value.trim();
    if (!nextTitle) {
      state.draftTitle = note?.title ?? '';
      input.value = state.draftTitle;
      flashStatus('标题不能为空，已恢复原标题');
    } else {
      state.draftTitle = nextTitle;
      input.value = nextTitle;
    }

    void persistDraft({ immediate: true });
  });
}
