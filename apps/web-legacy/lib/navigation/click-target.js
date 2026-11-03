import { closestFromEventTarget } from '../dom/event-target.js';

export function resolveClickTarget(target) {
  const navSection = closestFromEventTarget(target, '[data-nav-section]');
  if (navSection?.dataset.navSection) {
    return { type: 'toggle-section', sectionKey: navSection.dataset.navSection };
  }

  const folderToggle = closestFromEventTarget(target, '[data-folder-toggle]');
  if (folderToggle?.dataset.folderToggle) {
    return { type: 'toggle-folder', folderId: folderToggle.dataset.folderToggle };
  }

  const folderButton = closestFromEventTarget(target, '[data-folder-id]');
  if (folderButton?.dataset.folderId) {
    return { type: 'select-folder', folderId: folderButton.dataset.folderId };
  }

  const noteButton = closestFromEventTarget(target, '[data-note-id]');
  if (noteButton?.dataset.noteId) {
    return { type: 'select-note', noteId: noteButton.dataset.noteId };
  }

  return null;
}
