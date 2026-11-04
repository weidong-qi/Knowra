import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENT_BYTES,
  assertInlineImageFile,
  buildAttachmentContentUrl,
  buildAttachmentReferenceUrl,
  formatAttachmentSize,
  isInlineImageAttachment,
  isAttachmentReferenced,
  readAttachmentFile
} from './attachmentFiles';

describe('attachment file helpers', () => {
  it('builds encoded content references and detects markdown usage', () => {
    expect(buildAttachmentContentUrl('file/1')).toBe('/api/storage/attachments/file%2F1/content');
    const url = buildAttachmentReferenceUrl('file/1');
    expect(url).toBe('/api/storage/attachments/file%2F1/content#attachment=file%2F1');
    expect(isAttachmentReferenced(`![图](${url})`, 'file/1')).toBe(false);
    expect(isAttachmentReferenced('[图](/api/storage/attachments/%61ttachment-real/content#attachment=wrong)', 'attachment-real')).toBe(true);
    expect(isAttachmentReferenced('无附件', 'file/1')).toBe(false);
  });

  it('formats sizes and converts a browser file into the upload contract', async () => {
    expect(formatAttachmentSize(2048)).toBe('2.0 KB');
    const input = await readAttachmentFile('note-1', new File(['image'], 'diagram.png', { type: 'image/png' }));
    expect(input).toMatchObject({ noteId: 'note-1', fileName: 'diagram.png', mimeType: 'image/png' });
    expect(input.contentBase64).toBe('aW1hZ2U=');
  });

  it('rejects files that would exceed the JSON upload budget', async () => {
    const oversized = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], 'large.bin');
    await expect(readAttachmentFile('note-1', oversized)).rejects.toThrow('5 MB');
  });

  it('only allows browser-safe inline image formats', () => {
    expect(() => assertInlineImageFile(new File(['png'], 'diagram.png', { type: 'image/png' }))).not.toThrow();
    expect(() => assertInlineImageFile(new File(['svg'], 'diagram.svg', { type: 'image/svg+xml' }))).toThrow(
      'PNG、JPEG、GIF、WebP 或 AVIF'
    );
    expect(isInlineImageAttachment({
      id: 'image-1', noteId: 'note-1', fileName: 'diagram.png', mimeType: 'image/png', size: 1, status: 'ready'
    })).toBe(true);
    expect(isInlineImageAttachment({
      id: 'file-1', noteId: 'note-1', fileName: 'notes.pdf', mimeType: 'application/pdf', size: 1, status: 'ready'
    })).toBe(false);
  });
});
