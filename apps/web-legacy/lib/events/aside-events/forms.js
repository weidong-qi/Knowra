import { closestFromEventTarget } from '../../dom/event-target.js';
import { isComposingEvent } from '../../dom/composition.js';

export function bindAsideContentFormEvents({ state, elements, deps }) {
  elements.asideContent?.addEventListener('submit', (event) => {
    const renameForm = closestFromEventTarget(event.target, '[data-attachment-rename-form]');
    if (!renameForm?.dataset.attachmentRenameForm) return;
    event.preventDefault();
    const input = renameForm.querySelector?.('[data-attachment-rename-input]');
    void deps.submitAttachmentRename?.(renameForm.dataset.attachmentRenameForm, input?.value ?? '');
  });

  elements.asideContent?.addEventListener('keydown', (event) => {
    const renameInput = closestFromEventTarget(event.target, '[data-attachment-rename-input]');
    if (renameInput && event.key === 'Escape' && !isComposingEvent(event)) {
      event.preventDefault();
      deps.cancelAttachmentRename?.();
      return;
    }
    const tagInput = closestFromEventTarget(event.target, '[data-note-tag-input]');
    if (!tagInput || event.key !== 'Enter' || isComposingEvent(event)) return;
    event.preventDefault();
    void deps.createTagAndAssignToCurrentNote(state.noteTagComposer.draft);
  });
}
