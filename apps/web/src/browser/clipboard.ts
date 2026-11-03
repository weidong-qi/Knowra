export interface ClipboardReadResult {
  ok: boolean;
  text?: string;
  html?: string;
  reason?: 'unavailable' | 'denied';
}

interface ClipboardOptions {
  navigatorRef?: Navigator;
  documentRef?: Document;
  includeHtml?: boolean;
}

export async function readClipboardText({ navigatorRef = globalThis.navigator, includeHtml = false }: ClipboardOptions = {}): Promise<ClipboardReadResult> {
  if (includeHtml && navigatorRef?.clipboard?.read) {
    try {
      const items = await navigatorRef.clipboard.read();
      const item = items.find(value => value.types.includes('text/plain'));
      if (!item) return { ok: true, text: '', html: '' };
      const text = await (await item.getType('text/plain')).text();
      const html = item.types.includes('text/html') ? await (await item.getType('text/html')).text() : '';
      return { ok: true, text, html };
    } catch { return { ok: false, reason: 'denied' }; }
  }
  if (!navigatorRef?.clipboard?.readText) return { ok: false, reason: 'unavailable' };
  try {
    return { ok: true, text: await navigatorRef.clipboard.readText() };
  } catch {
    return { ok: false, reason: 'denied' };
  }
}

export async function writeClipboardText(text: string, options: ClipboardOptions = {}): Promise<boolean> {
  if (!text) return false;
  const { navigatorRef = globalThis.navigator } = options;
  if (navigatorRef?.clipboard?.writeText) {
    try {
      await navigatorRef.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy browser command.
    }
  }
  return copyTextWithDocumentCommand(text, options);
}

export function runDocumentCommand(command: string, { documentRef = globalThis.document }: ClipboardOptions = {}): boolean {
  if (!documentRef || typeof documentRef.execCommand !== 'function') return false;
  try {
    return Boolean(documentRef.execCommand(command));
  } catch {
    return false;
  }
}

function copyTextWithDocumentCommand(text: string, { documentRef = globalThis.document }: ClipboardOptions): boolean {
  if (!documentRef?.body) return false;
  const textarea = documentRef.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.inset = 'auto auto 100% 100%';
  const previousActiveElement = documentRef.activeElement as HTMLElement | null;
  documentRef.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const copied = runDocumentCommand('copy', { documentRef });
  textarea.remove();
  previousActiveElement?.focus();
  return copied;
}
