import { closestFromEventTarget } from '../../dom/event-target.js';

export function bindAsideContentContextMenuEvents({ elements, deps }) {
  const { openContextMenu } = deps;

  elements.asideContent?.addEventListener('contextmenu', (event) => {
    const attachmentButton = closestFromEventTarget(event.target, '[data-attachment-id]');
    if (!attachmentButton?.dataset.attachmentId) {
      return;
    }

    event.preventDefault();
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      targetKind: 'attachment',
      targetId: attachmentButton.dataset.attachmentId
    });
  });
}
