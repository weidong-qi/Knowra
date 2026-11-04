import { closestFromEventTarget } from '../../dom/event-target.js';
import { isComposingEvent } from '../../dom/composition.js';

export function bindAsideContentInputEvents({ elements, deps }) {
  elements.asideContent?.addEventListener('input', (event) => {
    const attachmentRenameInput = closestFromEventTarget(event.target, '[data-attachment-rename-input]');
    if (attachmentRenameInput && !isComposingEvent(event)) {
      deps.updateAttachmentRenameDraft?.(attachmentRenameInput.value);
      return;
    }
    const tagDraft = closestFromEventTarget(event.target, '[data-note-tag-input]');
    if (!tagDraft || isComposingEvent(event)) {
      return;
    }

    deps.updateNoteTagDraft?.(tagDraft.value);
  });
}
