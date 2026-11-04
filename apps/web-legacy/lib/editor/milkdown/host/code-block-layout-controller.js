function syncCodeBlockPlaceholder(placeholder) {
  const code = placeholder.querySelector('code');
  if (!code) {
    return;
  }

  const text = code.textContent ?? '';
  placeholder.dataset.trailingNewline = text.endsWith('\n') ? 'true' : 'false';
}

export function syncCodeBlockPlaceholderLayouts(root) {
  if (!root?.querySelectorAll) {
    return;
  }

  root.querySelectorAll('.milkdown-code-block-placeholder').forEach(syncCodeBlockPlaceholder);
}

export function attachCodeBlockPlaceholderObserver(root) {
  syncCodeBlockPlaceholderLayouts(root);

  if (!root) {
    return null;
  }

  const view = root.ownerDocument?.defaultView ?? globalThis;
  const MutationObserverConstructor = view.MutationObserver ?? globalThis.MutationObserver;
  const observer = typeof MutationObserverConstructor === 'function'
    ? new MutationObserverConstructor(() => {
      scheduleSync();
    })
    : null;
  let fallbackSyncTimer = 0;
  let scheduledFrame = 0;
  const pendingTimers = new Set();

  function flush() {
    syncCodeBlockPlaceholderLayouts(root);
  }

  function runFallbackSync() {
    flush();
    fallbackSyncTimer = view.setTimeout(runFallbackSync, 250);
  }

  function scheduleSync() {
    if (scheduledFrame || !view.requestAnimationFrame) {
      if (!scheduledFrame) {
        flush();
      }
      return;
    }

    scheduledFrame = view.requestAnimationFrame(() => {
      scheduledFrame = 0;
      flush();
      [0, 50, 200].forEach((delay) => {
        const timerId = view.setTimeout(() => {
          pendingTimers.delete(timerId);
          flush();
        }, delay);
        pendingTimers.add(timerId);
      });
    });
  }

  observer?.observe(root, {
    childList: true,
    characterData: true,
    subtree: true
  });
  const onDocumentScroll = () => scheduleSync();
  root.ownerDocument?.addEventListener('scroll', onDocumentScroll, true);
  if (!observer && typeof view.setTimeout === 'function') {
    fallbackSyncTimer = view.setTimeout(runFallbackSync, 250);
  }
  scheduleSync();

  return {
    disconnect() {
      observer?.disconnect();
      root.ownerDocument?.removeEventListener('scroll', onDocumentScroll, true);
      if (scheduledFrame && view.cancelAnimationFrame) {
        view.cancelAnimationFrame(scheduledFrame);
      }
      pendingTimers.forEach((timerId) => view.clearTimeout(timerId));
      pendingTimers.clear();
      if (fallbackSyncTimer) {
        view.clearTimeout(fallbackSyncTimer);
      }
      scheduledFrame = 0;
    }
  };
}
