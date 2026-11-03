export async function readClipboardText({ navigatorRef = globalThis.navigator } = {}) {
  if (!navigatorRef?.clipboard?.readText) {
    return { ok: false, reason: 'unavailable' };
  }

  try {
    const text = await navigatorRef.clipboard.readText();
    return { ok: true, text };
  } catch (error) {
    return { ok: false, reason: 'denied', error };
  }
}

export async function writeClipboardText(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return false;
  }

  const { navigatorRef = globalThis.navigator } = options;
  if (navigatorRef?.clipboard?.writeText) {
    try {
      await navigatorRef.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to the legacy copy command below.
    }
  }

  return copyTextWithExecCommand(text, options);
}

export function runDocumentCommand(command, { documentRef = globalThis.document } = {}) {
  if (!documentRef || typeof documentRef.execCommand !== 'function') {
    return false;
  }

  try {
    return Boolean(documentRef.execCommand(command));
  } catch {
    return false;
  }
}

function copyTextWithExecCommand(text, { documentRef = globalThis.document } = {}) {
  if (!documentRef?.body || typeof documentRef.createElement !== 'function') {
    return false;
  }

  const textarea = documentRef.createElement('textarea');
  if (!textarea) {
    return false;
  }

  textarea.value = text;
  textarea.setAttribute?.('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';

  const previousActiveElement = documentRef.activeElement;
  documentRef.body.appendChild(textarea);
  textarea.focus?.();
  textarea.select?.();
  textarea.setSelectionRange?.(0, text.length);

  const copied = runDocumentCommand('copy', { documentRef });

  textarea.remove?.();
  if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
    previousActiveElement.focus();
  }

  return copied;
}
