import { closestFromEventTarget } from '../../dom/event-target.js';

export function bindAsideContentDoubleClickEvents({ elements, deps }) {
  const { flashStatus, jumpToAttachmentReference, cancelPendingAttachmentJump } = deps;

  elements.asideContent?.addEventListener('dblclick', (event) => {
    const attachmentButton = closestFromEventTarget(event.target, '[data-attachment-id]');
    if (!attachmentButton?.dataset.attachmentId) {
      return;
    }

    cancelPendingAttachmentJump?.();
    if (attachmentButton.dataset.attachmentReferenced === 'true') {
      void jumpToAttachmentReference?.(attachmentButton.dataset.attachmentId, 'previous');
    } else {
      flashStatus(`附件尚未插入正文：${attachmentButton.dataset.attachmentName ?? '未命名附件'}`);
    }
  });
}
