import { syncTableHandleLabels } from '../table/table-buttons.js';

export function attachImageLayoutObserver(host) {
  if (typeof ResizeObserver === 'undefined') {
    return;
  }

  disconnectImageLayoutObserver(host);
  const observedWidth = Math.round(host.root.getBoundingClientRect().width);
  host.imageLayoutLastWidth = observedWidth > 0 ? observedWidth : 0;

  host.imageLayoutObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) {
      return;
    }

    const width = Math.round(entry.contentRect.width);
    if (width <= 0 || width === host.imageLayoutLastWidth) {
      return;
    }

    host.imageLayoutLastWidth = width;
    scheduleImageLayoutRefresh(host);
  });

  host.imageLayoutObserver.observe(host.root);
}

export function disconnectImageLayoutObserver(host) {
  if (host.imageLayoutRefreshFrame) {
    window.cancelAnimationFrame(host.imageLayoutRefreshFrame);
    host.imageLayoutRefreshFrame = 0;
  }

  if (host.imageLayoutObserver) {
    host.imageLayoutObserver.disconnect();
    host.imageLayoutObserver = null;
  }
}

export function scheduleImageLayoutRefresh(host) {
  if (host.imageLayoutRefreshFrame) {
    return;
  }

  host.imageLayoutRefreshFrame = window.requestAnimationFrame(() => {
    host.imageLayoutRefreshFrame = 0;
    refreshImageBlockLayouts(host);
  });
}

export function refreshImageBlockLayouts(host) {
  syncTableHandleLabels(host.root, host);
  const images = host.root.querySelectorAll('.milkdown-image-block img[src]');
  let hasPendingImage = false;
  images.forEach((image) => {
    if (!(image instanceof HTMLImageElement)) {
      return;
    }

    if (!image.complete || image.naturalWidth <= 0) {
      hasPendingImage = true;
      if (image.dataset.layoutPending !== 'true') {
        image.dataset.layoutPending = 'true';
        image.addEventListener('load', () => {
          delete image.dataset.layoutPending;
          image.dispatchEvent(new Event('load'));
          host.scheduleImageLayoutRefresh?.();
        }, { once: true });
      }
      return;
    }

    delete image.dataset.layoutPending;
    image.dispatchEvent(new Event('load'));
  });

  if (hasPendingImage) {
    host.scheduleImageLayoutRefreshBurst?.([32, 96, 240, 480]);
  }
  host.tableHandleController?.queueSyncPinnedHandles();
}
