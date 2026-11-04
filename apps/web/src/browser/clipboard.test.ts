import { describe, expect, it, vi } from 'vitest';
import { readClipboardText, runDocumentCommand, writeClipboardText } from './clipboard';

describe('clipboard helpers', () => {
  it('reuses the async clipboard APIs when available', async () => {
    const readText = vi.fn().mockResolvedValue('# pasted');
    const writeText = vi.fn().mockResolvedValue(undefined);
    const navigatorRef = { clipboard: { readText, writeText } } as unknown as Navigator;
    await expect(readClipboardText({ navigatorRef })).resolves.toEqual({ ok: true, text: '# pasted' });
    await expect(writeClipboardText('copied', { navigatorRef })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('copied');
  });

  it('reports denied reads and safely wraps legacy document commands', async () => {
    const navigatorRef = { clipboard: { readText: vi.fn().mockRejectedValue(new Error('denied')) } } as unknown as Navigator;
    await expect(readClipboardText({ navigatorRef })).resolves.toEqual({ ok: false, reason: 'denied' });
    const documentRef = { execCommand: vi.fn().mockReturnValue(true) } as unknown as Document;
    expect(runDocumentCommand('copy', { documentRef })).toBe(true);
    expect(documentRef.execCommand).toHaveBeenCalledWith('copy');
  });

  it('reads HTML and text from the same clipboard item without guessing a carrier from plain text', async () => {
    const navigatorRef = { clipboard: { read: async () => [{ types: ['text/plain', 'text/html'], getType: async (type: string) => ({ text: async () => type === 'text/html' ? '<mark data-knowra-mark="a">b</mark>' : 'b' }) }] } } as unknown as Navigator;
    await expect(readClipboardText({ navigatorRef, includeHtml: true })).resolves.toEqual({ ok: true, text: 'b', html: '<mark data-knowra-mark="a">b</mark>' });
    const readText = vi.fn();
    const denied = { clipboard: { read: async () => { throw new Error('denied'); }, readText } } as unknown as Navigator;
    await expect(readClipboardText({ navigatorRef: denied, includeHtml: true })).resolves.toEqual({ ok: false, reason: 'denied' });
    expect(readText).not.toHaveBeenCalled();
  });
});
